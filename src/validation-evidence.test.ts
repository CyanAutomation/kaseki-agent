import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectValidationEvidence } from './validation-evidence';

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

  test('does not claim evidence for empty or missing artifacts', () => {
    fs.writeFileSync(path.join(directory, 'validation.log'), '\n');

    expect(collectValidationEvidence(directory)).toEqual({ text: '', sources: [] });
  });
});
