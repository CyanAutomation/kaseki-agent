import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContextHandoff, strings, unique } from './context-handoff.js';

describe('context-handoff', () => {
  it('deduplicates case-insensitively and respects item and character limits', () => {
    expect(unique([' Alpha  beta ', 'alpha beta', '', 'gamma'], 2, 20)).toEqual(['Alpha beta', 'gamma']);
    expect(unique(['abcdef'], 10, 3)).toEqual(['abc']);
  });

  it('recursively extracts matching nested strings without leaking unrelated fields', () => {
    expect(strings({ requirements: ['one', { criteria: 'two' }], metadata: { requirements: ['three'] } }, name => name === 'requirements'))
      .toEqual(['one', 'two', 'three']);
    expect(strings({ unrelated: 'nope' }, name => name === 'requirements')).toEqual([]);
  });

  it('writes bounded handoff and diagnostics from artifacts and environment', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'context-handoff-test-'));
    try {
      fs.writeFileSync(path.join(directory, 'goal-setting.json'), JSON.stringify({ objective: 'Build handoff', constraints: { technical: ['deterministic'] } }));
      fs.writeFileSync(path.join(directory, 'scouting.json'), JSON.stringify({ requirements: ['Build handoff'], relevant_files: [{ path: 'b.ts', reason: 'b' }, { path: 'a.ts', facts: ['a'] }], unresolved_questions: [{ question: 'Which schema?' }] }));
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
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'context-handoff.json'), 'utf8'))).toEqual(handoff);
      expect(fs.readFileSync(path.join(directory, 'prompt-section-diagnostics.jsonl'), 'utf8')).toContain('"artifact":"context-handoff.json"');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
