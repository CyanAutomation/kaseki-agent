import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from './run-scorecard-cli';

describe('run-scorecard CLI metadata validation', () => {
  let directory: string;
  let previousResultsDir: string | undefined;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-scorecard-cli-'));
    previousResultsDir = process.env.KASEKI_RESULTS_DIR;
    process.env.KASEKI_RESULTS_DIR = directory;
  });

  afterEach(() => {
    if (previousResultsDir === undefined) delete process.env.KASEKI_RESULTS_DIR;
    else process.env.KASEKI_RESULTS_DIR = previousResultsDir;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test.each([
    ['missing', undefined],
    ['malformed', '{not-json'],
  ])('rejects %s metadata when no timing evidence is available', (_label, metadata) => {
    if (metadata !== undefined) fs.writeFileSync(path.join(directory, 'metadata.json'), metadata);

    expect(() => main()).toThrow('insufficient metadata or timing evidence');
    expect(fs.existsSync(path.join(directory, 'run-scorecard.json'))).toBe(false);
  });
});
