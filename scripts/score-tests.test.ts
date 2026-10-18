import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getAllTestFiles,
  scoreAssertionQuality,
  scoreBehavioralRelevance,
  scoreCostCoverage,
  scoreIntentClarity,
} from './score-tests';

describe('test quality scorer', () => {
  test('counts semantic shell assertions instead of requiring Jest syntax', () => {
    const shellTest = `
      assert_contains "api exposes the expected status" "$body" '"status":"ok"'
      if ! grep -Fq 'job-1' "$response"; then exit 1; fi
      [[ "$status" == "202" ]]
    `;

    expect(scoreAssertionQuality(shellTest, 'sh')).toBe(2);
    expect(scoreCostCoverage(shellTest, 'sh')).toBe(2);
    expect(scoreAssertionQuality('# expect(true).toBe(true)\necho "test file"', 'sh')).toBe(0);
    expect(scoreAssertionQuality('if [[ "$status" == 202 ]]; then exit 1; fi', 'sh')).toBe(1);
    expect(scoreAssertionQuality("assert.match(output, /OK/)\nassert.deepEqual(result, expected)", 'mjs')).toBe(2);
    expect(scoreIntentClarity('test_preserves_job_status() { :; }', 'x.test.sh', 'sh')).toBe(2);
    expect(scoreIntentClarity('#!/usr/bin/env bash\n# Preserves the output error line after filtering', 'x.test.sh', 'sh')).toBe(1);
    expect(scoreIntentClarity('[[ "$status" == 200 ]]', 'write-run-metadata.test.sh', 'sh')).toBe(1);
    expect(scoreIntentClarity("test('returns the saved job after restart', async () => {})", 'x.test.mjs', 'mjs')).toBe(2);
    expect(scoreIntentClarity("test('workflow checks ignore unrelated values', () => {})", 'x.test.mjs', 'mjs')).toBe(2);
    expect(scoreIntentClarity("test('works', () => {})", 'x.test.mjs', 'mjs')).toBe(0);
    expect(scoreAssertionQuality('function assertContract() { if (actual !== expected) throw new Error("mismatch"); }', 'ts')).toBe(1);
  });

  test('requires an issue or spec identifier for full behavioral relevance', () => {
    expect(scoreBehavioralRelevance('// Spec: preserve retry behavior')).toBe(1);
    expect(scoreBehavioralRelevance('// Regression: GH#2789')).toBe(2);
  });

  test('discovers tests in hidden source directories and skips generated or dependency trees', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-tests-inventory-'));
    try {
      const testFiles = [
        '.github/actions/check.test.mjs',
        'src/unit.test.ts',
        'tests/package.test.sh',
      ];
      for (const relativePath of testFiles) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
      }
      for (const relativePath of [
        'node_modules/dependency/dependency.test.js',
        'dist/generated.test.js',
        '.git/objects/example.test.js',
        'src/not-a-test.ts',
      ]) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
      }

      expect(getAllTestFiles(root).map((file) => path.relative(root, file))).toEqual(
        testFiles.sort(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
