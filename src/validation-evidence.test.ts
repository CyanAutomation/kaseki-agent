import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectValidationEvidence } from './validation-evidence';
import { latestValidationResults } from './validation-results';

describe('latestValidationResults', () => {
  it('merges timing details for the latest invocation and ignores other phases', () => {
    const rows = latestValidationResults(
      [
        { command: 'npm test', exit_code: 1, invocation: 1 },
        { command: 'npm test', exit_code: 0, invocation: 2, stage: 'validation', status: 'passed' },
        { command: 'pi coding agent', exit_code: 0, invocation: 2, stage: 'coding' },
        { command: 'manual check', exit_code: 0 },
      ],
      [{ command: 'npm test', exit_code: 0, invocation: 2, elapsed_seconds: 12 }],
    );

    expect(rows).toEqual([
      expect.objectContaining({ command: 'npm test', invocation: 2, elapsed_seconds: 12, status: 'passed' }),
      expect.objectContaining({ command: 'manual check', exit_code: 0 }),
    ]);
  });

  it('preserves repeated command occurrences within a single source', () => {
    const rows = latestValidationResults([
      { command: 'npm test', exit_code: 0 },
      { command: 'npm test', exit_code: 0 },
    ]);

    expect(rows).toHaveLength(2);
  });
});

describe('collectValidationEvidence', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync('/tmp/kaseki-validation-evidence-');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('uses timings and pre-validation evidence when final validation.log is absent', () => {
    fs.writeFileSync(path.join(directory, 'validation-timings.tsv'), 'command\texit_code\n npm run test:unit\t0\n');
    fs.writeFileSync(path.join(directory, 'pre-validation.log'), 'npm run check\nexit_code=0\n');

    const evidence = collectValidationEvidence(directory);

    expect(evidence.sources).toEqual(['validation-timings.tsv', 'pre-validation.log']);
    expect(evidence.text).toContain('npm run test:unit');
    expect(evidence.text).toContain('exit_code=0');
  });

  test('includes machine-readable validation results and the finalized timings manifest', () => {
    fs.writeFileSync(path.join(directory, 'validation-results.json'), JSON.stringify([
      { command: 'npm test', status: 'passed', exit_code: 0 },
    ]));
    fs.writeFileSync(path.join(directory, 'timings-manifest.json'), JSON.stringify({
      validation_timings: [{ command: 'npm test', exit_code: 0, elapsed_seconds: 11 }],
    }));

    const evidence = collectValidationEvidence(directory);

    expect(evidence.sources).toEqual(['validation-results.json', 'timings-manifest.json']);
    expect(evidence.text).toContain('npm test');
    expect(evidence.text).toContain('elapsed_seconds');
  });

  test('does not claim evidence for empty or missing artifacts', () => {
    fs.writeFileSync(path.join(directory, 'validation.log'), '\n');

    expect(collectValidationEvidence(directory)).toEqual({ text: '', sources: [] });
  });
});
