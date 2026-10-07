import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CAVEMAN_TOOL_OUTPUT_QUESTIONS,
  cavemanToolOutputRouterEnabled,
  cavemanToolOutputRouterMinChars,
  installCavemanToolOutputRouter,
  routeToolOutput,
  routeSemanticToolOutput,
  readSemanticGoalSummary,
  SEMANTIC_CONTEXT_ROUTING_QUESTIONS,
  type CavemanPiExtension,
  type CavemanToolOutputContent,
  type CavemanToolOutputEvent,
  type JevToolOutputDecision,
} from './tool-output-router';

function event(
  toolName: string,
  text: string,
  input: Record<string, unknown> = {},
  isError = false,
): CavemanToolOutputEvent {
  return {
    toolName,
    input,
    isError,
    content: [{ type: 'text', text }],
  };
}

function decision(choice: string, confidence = 0.98): JevToolOutputDecision {
  return {
    answers: {
      route: {
        type: 'choice',
        choice,
        confidence,
        probabilities: { preserve: choice === 'preserve' ? 1 : 0, compact_repeated: choice === 'compact_repeated' ? 1 : 0, structural_code: choice === 'structural_code' ? 1 : 0 },
      },
    },
  };
}

function semanticDecision(choice: string, probabilities?: Record<string, number>): JevToolOutputDecision {
  const distribution = probabilities || { preserve: choice === 'preserve' ? 1 : 0, condense: choice === 'condense' ? 1 : 0, discard: choice === 'discard' ? 1 : 0 };
  return { answers: { disposition: { type: 'choice', choice, confidence: Math.max(...Object.values(distribution)), probabilities: distribution } } };
}

describe('Caveman tool-output routing', () => {
  it('does not call JEV for short results', async () => {
    const classify = jest.fn(async () => decision('compact_repeated'));
    const original = event('bash', 'ok');

    const result = await routeToolOutput(original, classify, { minChars: 20 });

    expect(classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: false, transformed: false, reason: 'below_minimum_size' });
    expect(result.content).toBe(original.content);
  });

  it('enables metadata routing at levels 2 and 3 with a more eager level-3 threshold', () => {
    expect(cavemanToolOutputRouterEnabled({})).toBe(true);
    expect(cavemanToolOutputRouterEnabled({ KASEKI_CAVEMAN: '0' })).toBe(false);
    expect(cavemanToolOutputRouterEnabled({ KASEKI_CAVEMAN_LEVEL: '1' })).toBe(false);
    expect(cavemanToolOutputRouterEnabled({ KASEKI_CAVEMAN_ROUTER: 'off' })).toBe(false);
    expect(cavemanToolOutputRouterMinChars({ KASEKI_CAVEMAN_LEVEL: '2' })).toBe(6000);
    expect(cavemanToolOutputRouterMinChars({ KASEKI_CAVEMAN_LEVEL: '3' })).toBe(3000);
    expect(cavemanToolOutputRouterMinChars({ KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '1200' })).toBe(1200);
  });

  it('installs a Pi hook that records routing metrics without payload text', async () => {
    const resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-router-'));
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const pi: CavemanPiExtension = {
      on: (name, registered) => { handlers[name] = registered as (...args: never[]) => unknown; },
    };
    const env = {
      KASEKI_CAVEMAN: '1',
      KASEKI_CAVEMAN_LEVEL: '2',
      KASEKI_CAVEMAN_ROUTER: 'jev',
      KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '100',
      KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD: '0.86',
      KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED: '1',
      KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS: '100',
      KASEKI_INFERENCE_PHASE: 'coding',
      KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS: '20',
      KASEKI_RESULTS_DIR: resultsDirectory,
    } as NodeJS.ProcessEnv;

    try {
      installCavemanToolOutputRouter(pi, async () => semanticDecision('condense'), env);
      const repeatedLine = `private-looking-output-${'x'.repeat(100)}`;
      const output = Array.from({ length: 20 }, (_, index) => `${repeatedLine}-${index}\n`.repeat(2)).join('');
      const result = await (handlers.tool_result as (value: CavemanToolOutputEvent) => Promise<{ content: CavemanToolOutputContent[] } | undefined>)(event('bash', output));
      const diagnostics = fs.readFileSync(path.join(resultsDirectory, 'caveman-routing.jsonl'), 'utf8');
      const record = JSON.parse(diagnostics.trim()) as Record<string, unknown>;

      expect(result?.content[0]).toMatchObject({ type: 'text' });
      expect(diagnostics).toContain('jev_selected_condense_caveman_transform');
      expect(diagnostics).toContain('saved_chars');
      expect(diagnostics).toContain('jev_evaluated');
      expect(diagnostics).toContain('estimated_tokens_saved');
      expect(record).toMatchObject({
        jev_evaluated: true,
        deterministic_bypass: false,
        disposition: 'condense',
        tool_name: 'bash',
        category: 'command_output',
        caveman_reduction_triggered: true,
        semantic_router_enabled: true,
      });
      expect(record.estimated_input_tokens).toBeGreaterThan(record.estimated_output_tokens as number);
      expect(diagnostics).not.toContain(repeatedLine);
    } finally {
      fs.rmSync(resultsDirectory, { recursive: true, force: true });
    }
  });

  it('does not route large non-code reads or partial source reads', async () => {
    const classify = jest.fn(async () => decision('structural_code'));
    const text = 'long file content '.repeat(500);

    const markdown = await routeToolOutput(event('read', text, { path: 'README.md' }), classify, { minChars: 100 });
    const partial = await routeToolOutput(event('read', text, { path: 'src/file.ts', offset: 20 }), classify, { minChars: 100 });

    expect(classify).not.toHaveBeenCalled();
    expect(markdown.reason).toBe('tool_not_eligible');
    expect(partial.reason).toBe('tool_not_eligible');
  });

  it('sends only small payload metadata to JEV, never tool output or command text', async () => {
    const secretLikeOutput = `TOKEN_VALUE=${'x'.repeat(7000)}`;
    const classify = jest.fn(async () => decision('preserve'));

    await routeToolOutput(event('bash', secretLikeOutput, { command: 'cat /run/secrets/private-key' }), classify, { minChars: 100 });

    const [state, questions] = classify.mock.calls[0] as unknown as [Record<string, unknown>, typeof CAVEMAN_TOOL_OUTPUT_QUESTIONS];
    expect(state).toMatchObject({ toolName: 'bash', resultKind: 'command_output', characters: secretLikeOutput.length });
    expect(JSON.stringify(state)).not.toContain('TOKEN_VALUE');
    expect(JSON.stringify(state)).not.toContain('/run/secrets');
    expect(questions).toBe(CAVEMAN_TOOL_OUTPUT_QUESTIONS);
  });

  it('keeps original tool output when JEV fails or confidence is below threshold', async () => {
    const original = event('bash', `${'repeated diagnostic\n'.repeat(500)}`);
    const failed = await routeToolOutput(original, async () => { throw new Error('network failure'); }, { minChars: 100 });
    const uncertain = await routeToolOutput(original, async () => decision('compact_repeated', 0.7), { minChars: 100, confidenceThreshold: 0.86 });

    expect(failed).toMatchObject({ transformed: false, reason: 'jev_unavailable' });
    expect(uncertain).toMatchObject({ transformed: false, reason: 'low_confidence', route: 'preserve' });
    expect(failed.content).toBe(original.content);
    expect(uncertain.content).toBe(original.content);
  });

  it('compacts repeated successful command output while retaining exact line text and repeat count', async () => {
    const repeatedLine = `test case passed: ${'x'.repeat(120)}`;
    const original = `${repeatedLine}\n`.repeat(40);
    const result = await routeToolOutput(event('bash', original, { command: 'npm test' }), async () => decision('compact_repeated'), { minChars: 100 });

    expect(result).toMatchObject({ transformed: true, route: 'compact_repeated' });
    expect(result.outputChars).toBeLessThan(result.inputChars / 2);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain(repeatedLine);
    expect((result.content[0] as { text: string }).text).toContain('repeated 39 additional times');
  });

  it('does not compress failed tool output even when JEV asks for it', async () => {
    const original = event('bash', `${'ERROR: preserve exact diagnostic\n'.repeat(100)}`, {}, true);
    const classify = jest.fn(async () => decision('compact_repeated'));

    const result = await routeToolOutput(original, classify, { minChars: 100 });

    expect(classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: false, transformed: false, reason: 'tool_error' });
    expect(result.content).toBe(original.content);
  });

  it('uses structural summaries only for full TS/JS reads and keeps an exact reread path', async () => {
    const sourcePath = 'src/generated-large.ts';
    const source = Array.from({ length: 80 }, (_, index) =>
      `export function operation${index}(input: string): string {\n  const detail = input + ${JSON.stringify(`implementation detail ${index} ${'padding '.repeat(12)}`)};\n  return detail.trim();\n}\n`,
    ).join('\n');
    const result = await routeToolOutput(event('read', source, { path: sourcePath }), async () => decision('structural_code'), { minChars: 100 });

    expect(result).toMatchObject({ transformed: true, route: 'structural_code' });
    const summary = (result.content[0] as { text: string }).text;
    expect(summary).toContain(JSON.stringify(sourcePath));
    expect(summary).toContain('operation0');
    expect(summary).toContain('implementation details are omitted');
    expect(summary.length).toBeLessThan(source.length / 2);
    expect(summary).not.toContain('padding padding padding');
  });

  it('preserves partial reads and unsupported source files even when JEV selects structural summary', async () => {
    const source = `export function execute() { return '${'detail '.repeat(700)}'; }`;
    const partial = await routeToolOutput(event('read', source, { path: 'src/file.ts', offset: 10 }), async () => decision('structural_code'), { minChars: 100 });
    const unsupported = await routeToolOutput(event('read', source, { path: 'src/file.go' }), async () => decision('structural_code'), { minChars: 100 });

    expect(partial).toMatchObject({ transformed: false, reason: 'tool_not_eligible' });
    expect(unsupported).toMatchObject({ transformed: false, reason: 'tool_not_eligible' });
    expect(partial.content[0]).toMatchObject({ text: source });
    expect(unsupported.content[0]).toMatchObject({ text: source });
  });

  it('does not compact when the selected transform would save too little', async () => {
    const original = event('bash', `unique one\nunique two\n${'short repeat\n'.repeat(4)}`);
    const result = await routeToolOutput(original, async () => decision('compact_repeated'), { minChars: 10 });

    expect(result).toMatchObject({ transformed: false, reason: 'route_not_applicable_or_insufficient_savings' });
    expect(result.content).toBe(original.content);
  });
});

describe('Semantic context routing', () => {
  it('deterministically condenses highly repetitive output before calling JEV', async () => {
    const classify = jest.fn(async () => semanticDecision('preserve'));
    const line = `routine successful output ${'x'.repeat(120)}`;
    const output = `${line}\n`.repeat(100);
    const result = await routeSemanticToolOutput(event('bash', output), classify, { minTokens: 1 });

    expect(classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: false, transformed: true, disposition: 'condense', reason: 'deterministic_repeated_output' });
  });

  it('keeps the legacy router when disabled and does not add semantic calls to other phases', async () => {
    const repeated = `legacy line ${'x'.repeat(100)}\n`.repeat(50);
    const resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-phase-scope-'));
    try {
      let handler: ((value: CavemanToolOutputEvent) => Promise<{ content: CavemanToolOutputContent[] } | undefined>) | undefined;
      const pi: CavemanPiExtension = { on: (_name, registered) => { handler = registered; } };
      const legacyClassify = jest.fn(async () => decision('compact_repeated'));
      installCavemanToolOutputRouter(pi, legacyClassify, {
        KASEKI_CAVEMAN_LEVEL: '2', KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED: '0',
        KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '100', KASEKI_INFERENCE_PHASE: 'coding',
        KASEKI_RESULTS_DIR: path.join(resultsRoot, 'disabled'),
      } as NodeJS.ProcessEnv);
      const legacyResult = await handler?.(event('bash', repeated));
      expect(legacyResult?.content[0]).toMatchObject({ type: 'text' });
      expect(legacyClassify.mock.calls[0]?.[1]).not.toBe(SEMANTIC_CONTEXT_ROUTING_QUESTIONS);
      expect(fs.readFileSync(path.join(resultsRoot, 'disabled', 'caveman-routing.jsonl'), 'utf8')).toContain('"semantic_router_enabled":false');

      let phaseHandler: typeof handler;
      const phasePi: CavemanPiExtension = { on: (_name, registered) => { phaseHandler = registered; } };
      const phaseClassify = jest.fn(async () => decision('preserve'));
      installCavemanToolOutputRouter(phasePi, phaseClassify, {
        KASEKI_CAVEMAN_LEVEL: '2', KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED: '1',
        KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '100', KASEKI_INFERENCE_PHASE: 'scouting',
        KASEKI_RESULTS_DIR: path.join(resultsRoot, 'scouting'),
      } as NodeJS.ProcessEnv);
      await phaseHandler?.(event('bash', repeated));
      expect(phaseClassify.mock.calls[0]?.[1]).not.toBe(SEMANTIC_CONTEXT_ROUTING_QUESTIONS);
    } finally {
      fs.rmSync(resultsRoot, { recursive: true, force: true });
    }
  });

  it('bypasses JEV for small output and preserves protected evidence even when large', async () => {
    const classify = jest.fn(async () => semanticDecision('discard'));
    const small = await routeSemanticToolOutput(event('bash', 'ok'), classify, { minTokens: 10 });
    const failure = await routeSemanticToolOutput(event('bash', 'ERROR: failing validation\n'.repeat(500), {}, false), classify, { minTokens: 1 });

    expect(classify).not.toHaveBeenCalled();
    expect(small).toMatchObject({ disposition: 'preserve', reason: 'below_minimum_size' });
    expect(failure).toMatchObject({ disposition: 'preserve', reason: 'protected_evidence' });
  });

  it('sends a bounded goal and operation envelope to JEV for large ambiguous output', async () => {
    const classify = jest.fn(async () => semanticDecision('preserve'));
    const payload = Array.from({ length: 600 }, (_, index) => `routine output ${index}`).join('\n');
    await routeSemanticToolOutput(event('bash', payload, { command: 'npm test -- --runInBand' }), classify, {
      minTokens: 1,
      phase: 'coding',
      goalSummary: 'Fix parser token=supersecretvalue',
    });
    const [state, questions] = classify.mock.calls[0] as unknown as [Record<string, unknown>, typeof SEMANTIC_CONTEXT_ROUTING_QUESTIONS];

    expect(state).toMatchObject({ phase: 'coding', toolName: 'bash', operation: 'package_quality_check', goalSummary: 'Fix parser token=[REDACTED_SECRET]' });
    expect(questions).toBe(SEMANTIC_CONTEXT_ROUTING_QUESTIONS);
    expect(JSON.stringify(state)).not.toContain('routine output');
    expect(JSON.stringify(state)).not.toContain('npm test');
  });

  it('preserves original representation for preserve, JEV failure, and invalid probabilities', async () => {
    const original = event('bash', Array.from({ length: 600 }, (_, index) => `routine ${index}`).join('\n'));
    const keep = await routeSemanticToolOutput(original, async () => semanticDecision('preserve'), { minTokens: 1 });
    const failure = await routeSemanticToolOutput(original, async () => { throw new Error('offline'); }, { minTokens: 1 });
    const invalid = await routeSemanticToolOutput(original, async () => semanticDecision('discard', { preserve: 0.2, condense: 0.2, discard: 0.2 }), { minTokens: 1 });
    const unexpectedShape = await routeSemanticToolOutput(original, async () => undefined as unknown as JevToolOutputDecision, { minTokens: 1 });

    expect(keep).toMatchObject({ disposition: 'preserve', transformed: false });
    expect(failure).toMatchObject({ disposition: 'preserve', reason: 'jev_unavailable' });
    expect(invalid).toMatchObject({ disposition: 'preserve', reason: 'invalid_jev_probabilities' });
    expect(unexpectedShape).toMatchObject({ disposition: 'preserve', reason: 'invalid_jev_answer' });
    expect(keep.content).toBe(original.content);
    expect(failure.content).toBe(original.content);
    expect(invalid.content).toBe(original.content);
    expect(unexpectedShape.content).toBe(original.content);
  });

  it('uses Caveman for condense and requires the configured conservative discard threshold', async () => {
    const source = Array.from({ length: 80 }, (_, index) => `export function operation${index}(input: string): string {\n  const detail = input + ${JSON.stringify(`detail ${index} ${'padding '.repeat(12)}`)};\n  return detail.trim();\n}`).join('\n');
    const ambiguous = Array.from({ length: 600 }, (_, index) => `result line ${index}`).join('\n');
    const condensed = await routeSemanticToolOutput(event('read', source, { path: 'src/large.ts' }), async () => semanticDecision('condense'), { minTokens: 1 });
    const condenseAtBoundary = await routeSemanticToolOutput(event('read', source, { path: 'src/large.ts' }), async () => semanticDecision('condense', { preserve: 0.29, condense: 0.7, discard: 0.01 }), { minTokens: 1, condenseThreshold: 0.7 });
    const belowBoundary = await routeSemanticToolOutput(event('bash', ambiguous), async () => semanticDecision('discard', { preserve: 0.01, condense: 0.01, discard: 0.98 }), { minTokens: 1, discardThreshold: 0.99 });
    const atBoundary = await routeSemanticToolOutput(event('bash', ambiguous), async () => semanticDecision('discard', { preserve: 0.01, condense: 0.01, discard: 0.98 }), { minTokens: 1, discardThreshold: 0.98 });
    const discarded = await routeSemanticToolOutput(event('bash', ambiguous), async () => semanticDecision('discard'), { minTokens: 1 });

    expect(condensed).toMatchObject({ disposition: 'condense', transformed: true, reason: 'jev_selected_condense_caveman_transform' });
    expect(condenseAtBoundary).toMatchObject({ disposition: 'condense', transformed: true });
    expect(belowBoundary).toMatchObject({ disposition: 'preserve', reason: 'below_disposition_threshold' });
    expect(atBoundary).toMatchObject({ disposition: 'discard' });
    expect(discarded).toMatchObject({ disposition: 'discard', route: 'discard', transformed: true });
    expect(discarded.decision).toMatchObject({ discardProbability: 1, disposition: 'discard' });
    expect((discarded.content[0] as { text: string }).text).toContain('estimated_tokens=');
    expect((discarded.content[0] as { text: string }).text).not.toContain('result line');
    expect(condensed.estimatedInputTokens).toBeGreaterThan(condensed.estimatedOutputTokens || 0);
  });

  it('preserves state-changing operation output and reads a redacted bounded goal summary', async () => {
    const classify = jest.fn(async () => semanticDecision('discard'));
    const changed = await routeSemanticToolOutput(event('bash', 'updated 1 file\n'.repeat(500), { command: 'git checkout feature' }), classify, { minTokens: 1 });
    const protectedStateOutputs = await Promise.all([
      routeSemanticToolOutput(event('bash', 'pushed branch\n'.repeat(500), { command: 'git push origin main' }), classify, { minTokens: 1 }),
      routeSemanticToolOutput(event('bash', 'working tree state\n'.repeat(500), { command: 'git status --short' }), classify, { minTokens: 1 }),
      routeSemanticToolOutput(event('bash', 'pull request state\n'.repeat(500), { command: 'gh pr view' }), classify, { minTokens: 1 }),
      routeSemanticToolOutput(event('bash', 'remote mutation\n'.repeat(500), { command: 'curl -X POST https://example.invalid/api' }), classify, { minTokens: 1 }),
    ]);
    const results = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-goal-'));
    try {
      fs.writeFileSync(path.join(results, 'goal-setting.json'), JSON.stringify({ upgraded_goal: `Implement token=privatevalue ${'bounded '.repeat(200)}` }));
      expect(readSemanticGoalSummary(results)).toContain('token=[REDACTED_SECRET]');
      expect(readSemanticGoalSummary(results)?.length).toBeLessThanOrEqual(1200);
    } finally {
      fs.rmSync(results, { recursive: true, force: true });
    }
    expect(classify).not.toHaveBeenCalled();
    expect(changed).toMatchObject({ disposition: 'preserve', reason: 'protected_evidence' });
    expect(protectedStateOutputs).toHaveLength(4);
    expect(protectedStateOutputs.every(result => result.reason === 'protected_evidence')).toBe(true);
  });

  it('rewrites a large stale read after a same-path edit and records reevaluation without content', async () => {
    const resultsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-reevaluation-'));
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const pi: CavemanPiExtension = {
      on: (name, registered) => { handlers[name] = registered as (...args: never[]) => unknown; },
    };
    const source = `export function beforeEdit() { return '${'detail '.repeat(1500)}'; }`;

    try {
      installCavemanToolOutputRouter(pi, async () => semanticDecision('preserve'), {
        KASEKI_CAVEMAN_LEVEL: '2',
        KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED: '1',
        KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED: '1',
        KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS: '100',
        KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '100',
        KASEKI_INFERENCE_PHASE: 'coding',
        KASEKI_RESULTS_DIR: resultsDirectory,
      } as NodeJS.ProcessEnv);

      await (handlers.tool_result as (value: CavemanToolOutputEvent) => Promise<unknown>)(
        { ...event('read', source, { path: 'src/router.ts' }), toolCallId: 'read-router' },
      );
      (handlers.tool_result as (value: CavemanToolOutputEvent) => Promise<unknown>)(
        { ...event('edit', 'updated', { path: 'src/router.ts' }), toolCallId: 'edit-router' },
      );
      const context = (handlers.context as (value: { messages: Array<Record<string, unknown>> }) => { messages: Array<Record<string, unknown>> } | undefined)(
        { messages: [{ role: 'toolResult', toolCallId: 'read-router', content: [{ type: 'text', text: source }] }] },
      );
      const diagnostics = fs.readFileSync(path.join(resultsDirectory, 'caveman-routing.jsonl'), 'utf8');
      const reevaluationRecord = JSON.parse(diagnostics.split('\n').find(line => line.includes('"event_type":"event_reevaluation"')) || '{}') as Record<string, unknown>;

      expect(context?.messages[0].content).toEqual([{ type: 'text', text: expect.stringContaining('stale after a successful file edit') }]);
      expect(diagnostics).toContain('"event_type":"event_reevaluation"');
      expect(diagnostics).toContain('"trigger":"successful_same_path_file_edit"');
      expect(reevaluationRecord).toMatchObject({ stale_items: 1, rewritten_messages: 1, newly_reevaluated: 1 });
      expect(reevaluationRecord.estimated_input_tokens).toBeGreaterThan(reevaluationRecord.estimated_output_tokens as number);
      expect(diagnostics).not.toContain('beforeEdit');
      expect(diagnostics).not.toContain(source.slice(0, 80));
      expect(diagnostics).not.toContain('src/router.ts');
    } finally {
      fs.rmSync(resultsDirectory, { recursive: true, force: true });
    }
  });

  it('does not register the context reevaluation hook when that feature is disabled', () => {
    const handlers: Record<string, (...args: never[]) => unknown> = {};
    const pi: CavemanPiExtension = {
      on: (name, registered) => { handlers[name] = registered as (...args: never[]) => unknown; },
    };

    installCavemanToolOutputRouter(pi, async () => semanticDecision('preserve'), {
      KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED: '1',
      KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED: '0',
      KASEKI_INFERENCE_PHASE: 'coding',
    } as NodeJS.ProcessEnv);

    expect(handlers.tool_result).toBeDefined();
    expect(handlers.context).toBeUndefined();
  });
});
