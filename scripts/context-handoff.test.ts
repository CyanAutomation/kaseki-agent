import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextHandoff, strings, unique } from './context-handoff.js';

describe('context-handoff', () => {
  const withResultsDirectory = (run: (directory: string) => void) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-test-'));
    try {
      run(directory);
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

  it('deduplicates task, artifact, and retry requirements', () => withResultsDirectory(directory => {
    fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({ objective: 'Add stable handoff' }));
    fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({ requirements: ['ADD STABLE HANDOFF'] }));

    const handoff = buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {
      TASK_PROMPT_VALUE: ' Add   stable handoff ',
      RETRY_FEEDBACK_VALUE: 'Fix retry delta\nfix RETRY delta',
    });

    expect(handoff.requirements).toEqual(['Add stable handoff', 'Fix retry delta']);
    expect(JSON.stringify(handoff)).not.toContain('complete prior context');
  }));

  it('extracts nested constraint fields and anti-patterns', () => withResultsDirectory(directory => {
    fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({
      constraints: { technical: ['Use deterministic output'], do_not_modify: ['Never edit generated files'] },
      anti_patterns: ['Do not discard nested criteria'],
    }));
    fs.writeFileSync(path.join(directory, 'scouting.json'), '{}');

    const handoff = buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {});

    expect(handoff.constraints).toEqual([
      'Use deterministic output',
      'Never edit generated files',
      'Do not discard nested criteria',
    ]);
  }));

  it('deduplicates changed files and validation progress', () => withResultsDirectory(directory => {
    fs.writeFileSync(path.join(directory, 'changed-files.txt'), 'a.sh\na.sh\n');
    fs.writeFileSync(path.join(directory, 'validation-timings.tsv'), [
      'command\tduration\texit_code',
      'unit test\t1\t0',
      'unit test\t1\t0',
      '',
    ].join('\n'));

    const handoff = buildContextHandoff(directory, 'coding', 'Evaluate the remaining delta.', {});

    expect(handoff.changed_files).toEqual(['a.sh']);
    expect(handoff.validation_outcomes).toEqual(['unit test: exit 0 (1s)']);
  }));

  it('writes bounded handoff and diagnostics from artifacts and environment', () => {
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

      const handoff = buildContextHandoff(directory, 'coding', 'Run focused tests', {
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
});
