import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextHandoff, strings, unique } from './context-handoff.js';

describe('context-handoff', () => {
  const withResultsDirectory = async (run: (directory: string) => Promise<void>) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-test-'));
    try {
      await run(directory);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  it('normalizes JSON strings and respects item and character limits', () => {
    expect(unique([' Alpha  beta ', 'alpha beta', '', 'gamma'], 2, 20)).toEqual(['Alpha beta', 'gamma']);
    expect(unique(['abcdef'], 10, 3)).toEqual(['abc']);
  });

  it('recursively extracts matching nested strings without leaking unrelated fields', () => {
    expect(strings({ requirements: ['one', { criteria: 'two' }], metadata: { requirements: ['three'] } }, name => name === 'requirements'))
      .toEqual(['one', 'two', 'three']);
    expect(strings({ unrelated: 'nope' }, name => name === 'requirements')).toEqual([]);
  });

  it('deduplicates task, artifact, and retry requirements', async () => withResultsDirectory(async directory => {
    fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({ objective: 'Add stable handoff' }));
    fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({ requirements: ['ADD STABLE HANDOFF'] }));

    const handoff = await buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {
      TASK_PROMPT_VALUE: ' Add   stable handoff ',
      RETRY_FEEDBACK_VALUE: 'Fix retry delta\nfix RETRY delta',
    });

    expect(handoff.requirements).toEqual(['Add stable handoff', 'Fix retry delta']);
    expect(JSON.stringify(handoff)).not.toContain('complete prior context');
  }));

  it('extracts nested constraint fields and anti-patterns', async () => withResultsDirectory(async directory => {
    fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({
      constraints: { technical: ['Use deterministic output'], do_not_modify: ['Never edit generated files'] },
      anti_patterns: ['Do not discard nested criteria'],
    }));
    fs.writeFileSync(path.join(directory, 'scouting.json'), '{}');

    const handoff = await buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {});

    expect(handoff.constraints).toEqual([
      'Use deterministic output',
      'Never edit generated files',
      'Do not discard nested criteria',
    ]);
  }));

  it('deduplicates changed files and validation progress', async () => withResultsDirectory(async directory => {
    fs.writeFileSync(path.join(directory, 'changed-files.txt'), 'a.sh\na.sh\n');
    fs.writeFileSync(path.join(directory, 'validation-timings.tsv'), [
      'command\tduration\texit_code',
      'unit test\t1\t0',
      'unit test\t1\t0',
      '',
    ].join('\n'));

    const handoff = await buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {});

    expect(handoff.changed_files).toEqual(['a.sh']);
    expect(handoff.validation_outcomes).toEqual(['unit test: exit 0 (1s)']);
  }));

  it('writes bounded handoff and diagnostics from artifacts and environment', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-test-'));
    try {
      fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({ objective: 'Build handoff', constraints: { technical: ['deterministic'] } }));
      fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({
        requirements: ['Build handoff'],
        observations: ['Readiness response has three undocumented provider fields'],
        plan: ['Update public/openapi/v1.yaml with the missing provider fields'],
        critical_change_expectations: { required_files: ['public/openapi/v1.yaml'] },
        relevant_files: [{ path: 'b.ts', reason: 'b' }, { path: 'a.ts', facts: ['a'] }],
        unresolved_questions: [{ question: 'Which schema?' }],
      }));
      fs.writeFileSync(path.join(directory, 'changed-files.txt'), 'b.ts\na.ts\na.ts\n');
      fs.writeFileSync(path.join(directory, 'validation-timings.tsv'), 'command\tduration\texit_code\nnpm test\t2\t0\n');

      const handoff = await buildContextHandoff(directory, 'coding', 'Run focused tests', {
        TASK_PROMPT_VALUE: 'Build handoff\nKeep output bounded', RETRY_FEEDBACK_VALUE: 'Fix retry', UNRESOLVED_VALUE: 'Open question',
      });

      expect(handoff.requirements).toEqual(['Build handoff', 'Keep output bounded', 'deterministic', 'Fix retry']);
      expect(handoff.constraints).toEqual(['deterministic', 'Keep output bounded']);
      expect(handoff.inspected_files.map(file => file.path)).toEqual(['a.ts', 'b.ts']);
      expect(handoff.changed_files).toEqual(['a.ts', 'b.ts']);
      expect(handoff.validation_outcomes).toEqual(['npm test: exit 0 (2s)']);
      expect(handoff.unresolved_questions).toEqual(['Which schema?', 'Open question']);
      expect(handoff.implementation_brief).toEqual(expect.objectContaining({
        observations: ['Readiness response has three undocumented provider fields'],
        plan: ['Update public/openapi/v1.yaml with the missing provider fields'],
        required_files: ['public/openapi/v1.yaml'],
      }));
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'context-handoff.json'), 'utf8'))).toEqual(handoff);
      expect(fs.readFileSync(path.join(directory, 'prompt-section-diagnostics.jsonl'), 'utf8')).toContain('"artifact":"context-handoff.json"');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('semantically routes scouting facts only when transferring into coding and preserves requirements', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-semantic-'));
    try {
      fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({
        relevant_files: [
          { path: 'README.md', reason: 'General repository information' },
          { path: 'src/router.ts', reason: 'Contains target route' },
        ],
        observations: ['The route uses shared validation'],
        plan: ['Update the route'],
        critical_change_expectations: { required_files: ['src/router.ts'] },
      }));
      const classify = jest.fn(async (state: Record<string, unknown>) => {
        const candidates = state.candidates as Array<{ id: string; path?: string }>;
        return { answers: Object.fromEntries(candidates.map(candidate => [candidate.id, {
          type: 'choice',
          choice: candidate.path === 'README.md' ? 'discard' : 'preserve',
          confidence: 0.99,
          probabilities: candidate.path === 'README.md'
            ? { preserve: 0.01, condense: 0.01, discard: 0.98 }
            : { preserve: 1, condense: 0, discard: 0 },
        }])) };
      });

      const handoff = await buildContextHandoff(directory, 'scouting', 'Implement the route', {
        TASK_PROMPT_VALUE: 'Implement src/router.ts',
      }, { enabled: true, classify });

      expect(classify).toHaveBeenCalledTimes(1);
      expect(handoff.requirements).toContain('Implement src/router.ts');
      expect(handoff.inspected_files.map(file => file.path)).toEqual(['src/router.ts']);
      expect(handoff.semantic_transfer).toMatchObject({ evaluated_items: 3, discarded_items: 1, protected_items: 1 });
      expect(handoff.semantic_transfer.estimated_tokens_saved).toBeGreaterThan(0);
      expect(fs.readFileSync(path.join(directory, 'caveman-routing.jsonl'), 'utf8')).not.toContain('General repository information');

      const noJev = jest.fn();
      await buildContextHandoff(directory, 'coding', 'Run goal check', {}, { enabled: true, classify: noJev });
      expect(noJev).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('leaves the handoff contract unchanged when semantic phase transfer is disabled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-disabled-'));
    try {
      fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({
        relevant_files: [{ path: 'src/router.ts', reason: 'Relevant route' }],
        test_impact: [{ path: 'test/router.test.ts', reason: 'Route coverage' }],
      }));
      const classify = jest.fn();

      const handoff = await buildContextHandoff(directory, 'scouting', 'Implement the route', {
        KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED: '0',
      }, { classify });

      expect(classify).not.toHaveBeenCalled();
      expect(handoff.semantic_transfer).toBeUndefined();
      expect(handoff.implementation_brief).not.toHaveProperty('test_impact');
      expect(handoff.inspected_files).toEqual([{ path: 'src/router.ts', facts: ['Relevant route'] }]);
      expect(fs.readFileSync(path.join(directory, 'caveman-routing.jsonl'), 'utf8')).toContain('"status":"disabled"');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves all scouting facts if the semantic routing layer throws unexpectedly', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-router-error-'));
    try {
      const scouting = {
        relevant_files: [{ path: 'src/router.ts', reason: 'Relevant route' }],
        observations: ['The route shares validation'],
        test_impact: [{ path: 'test/router.test.ts', reason: 'Route coverage' }],
      };
      fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify(scouting));

      const handoff = await buildContextHandoff(directory, 'scouting', 'Implement the route', {}, {
        enabled: true,
        redact: () => { throw new Error('redaction unavailable'); },
      });

      expect(handoff.inspected_files).toEqual([{ path: 'src/router.ts', facts: ['Relevant route'] }]);
      expect(handoff.implementation_brief.observations).toEqual(['The route shares validation']);
      expect(handoff.implementation_brief.test_impact).toEqual(scouting.test_impact);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
