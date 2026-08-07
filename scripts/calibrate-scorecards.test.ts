import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calibrate } from './calibrate-scorecards';

describe('calibrate-scorecards', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-calibration-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('reports an empty directory without invalid statistics', () => {
    expect(calibrate(root)).toMatchObject({
      runs: 0,
      invalid_files: [],
      dimension_discrimination: {},
    });
  });

  test('uses sample standard deviation and requires multiple values for discrimination', () => {
    const scores = [70, 76];
    scores.forEach((score, index) => {
      const directory = path.join(root, String(index));
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'run-scorecard.json'), JSON.stringify({
        overall_score: score,
        dimensions: [{ id: 'quality', normalized_score: score }],
      }));
    });

    expect(calibrate(root).dimension_discrimination).toEqual({
      quality: { range: 6, standard_deviation: 4.24, low_discrimination: true },
    });
  });

  test('records malformed scorecards rather than throwing', () => {
    const file = path.join(root, 'run-scorecard.json');
    fs.writeFileSync(file, '{not JSON');

    expect(calibrate(root)).toMatchObject({ runs: 0, invalid_files: [file] });
  });
});
