import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CAVEMAN_TOOL_OUTPUT_QUESTIONS,
  cavemanToolOutputRouterEnabled,
  cavemanToolOutputRouterMinChars,
  installCavemanToolOutputRouter,
  routeToolOutput,
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
    let handler: ((value: CavemanToolOutputEvent) => Promise<{ content: CavemanToolOutputContent[] } | undefined>) | undefined;
    const pi: CavemanPiExtension = {
      on: (_name, registered) => { handler = registered; },
    };
    const env = {
      KASEKI_CAVEMAN: '1',
      KASEKI_CAVEMAN_LEVEL: '2',
      KASEKI_CAVEMAN_ROUTER: 'jev',
      KASEKI_CAVEMAN_ROUTER_MIN_CHARS: '100',
      KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD: '0.86',
      KASEKI_INFERENCE_PHASE: 'coding',
      KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS: '20',
      KASEKI_RESULTS_DIR: resultsDirectory,
    } as NodeJS.ProcessEnv;

    try {
      installCavemanToolOutputRouter(pi, async () => decision('compact_repeated'), env);
      const repeatedLine = `private-looking-output-${'x'.repeat(100)}`;
      const result = await handler?.(event('bash', `${repeatedLine}\n`.repeat(20)));
      const diagnostics = fs.readFileSync(path.join(resultsDirectory, 'caveman-routing.jsonl'), 'utf8');

      expect(result?.content[0]).toMatchObject({ type: 'text' });
      expect(diagnostics).toContain('jev_selected_high_confidence_transform');
      expect(diagnostics).toContain('saved_chars');
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
