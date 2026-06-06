/**
 * Integration tests for analyze-test-failures.ts
 * Tests parsing, classification, and summary generation
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

interface TestCase {
  name: string;
  baselineLog: string;
  workingLog: string;
  expectedNewlyIntroduced: number;
  expectedPreExisting: number;
  expectedFixed: number;
}

interface AnalysisResult {
  summary: {
    total_newly_introduced: number;
    total_pre_existing: number;
    total_fixed: number;
  };
}

const repoRoot = path.resolve(__dirname, '..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

const testCases: TestCase[] = [
  {
    name: 'No changes all pass',
    baselineLog: `
✓ should return correct result
✓ should handle edge case
Tests: 2 passed, 0 failed
    `,
    workingLog: `
✓ should return correct result
✓ should handle edge case
Tests: 2 passed, 0 failed
    `,
    expectedNewlyIntroduced: 0,
    expectedPreExisting: 0,
    expectedFixed: 0,
  },
  {
    name: 'New failure introduced',
    baselineLog: `
✓ should return correct result
✓ should handle edge case
Tests: 2 passed, 0 failed
    `,
    workingLog: `
✓ should return correct result
✗ should handle edge case
Tests: 1 passed, 1 failed
    `,
    expectedNewlyIntroduced: 1,
    expectedPreExisting: 0,
    expectedFixed: 0,
  },
  {
    name: 'Pre-existing failure remains',
    baselineLog: `
✓ should return correct result
✗ should handle edge case
Tests: 1 passed, 1 failed
    `,
    workingLog: `
✓ should return correct result
✗ should handle edge case
Tests: 1 passed, 1 failed
    `,
    expectedNewlyIntroduced: 0,
    expectedPreExisting: 1,
    expectedFixed: 0,
  },
  {
    name: 'Fixed failure',
    baselineLog: `
✓ should return correct result
✗ should handle edge case
Tests: 1 passed, 1 failed
    `,
    workingLog: `
✓ should return correct result
✓ should handle edge case
Tests: 2 passed, 0 failed
    `,
    expectedNewlyIntroduced: 0,
    expectedPreExisting: 0,
    expectedFixed: 1,
  },
  {
    name: 'Mixed changes',
    baselineLog: `
✓ should parse correctly
✗ should validate input
✓ should format output
✗ should handle error
Tests: 2 passed, 2 failed
    `,
    workingLog: `
✓ should parse correctly
✗ should validate input
✓ should format output
✓ should handle error
✗ should reject null
Tests: 3 passed, 2 failed
    `,
    expectedNewlyIntroduced: 1,
    expectedPreExisting: 1,
    expectedFixed: 1,
  },
  {
    name: 'Vitest PASS FAIL format',
    baselineLog: `
✓ src/module.test.ts (3)
  PASS  should parse correctly
  PASS  should validate input
  FAIL  should handle error
Test Files: 1 passed (1)
Tests: 2 passed, 1 failed
    `,
    workingLog: `
✓ src/module.test.ts (3)
  PASS  should parse correctly
  FAIL  should validate input
  FAIL  should handle error
Test Files: 1 passed (1)
Tests: 1 passed, 2 failed
    `,
    expectedNewlyIntroduced: 1,
    expectedPreExisting: 1,
    expectedFixed: 0,
  },
];

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-test-failures-integration-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runAnalyzer(
  baselineLog: string,
  workingLog: string,
  outputFile: string
): AnalysisResult {
  const baselineFile = `${outputFile}.baseline`;
  const workingFile = `${outputFile}.working`;

  fs.writeFileSync(baselineFile, baselineLog);
  fs.writeFileSync(workingFile, workingLog);

  execFileSync(
    tsxBin,
    [
      path.join(repoRoot, 'src', 'analyze-test-failures.ts'),
      baselineFile,
      workingFile,
      outputFile,
    ],
    { cwd: repoRoot }
  );

  return JSON.parse(fs.readFileSync(outputFile, 'utf8')) as AnalysisResult;
}

describe('analyze-test-failures integration', () => {
  it.each(testCases)(
    'classifies test failure changes for $name',
    ({
      baselineLog,
      workingLog,
      expectedNewlyIntroduced,
      expectedPreExisting,
      expectedFixed,
    }) => {
      const outputFile = path.join(tmpDir, 'test-baseline-comparison.json');

      const result = runAnalyzer(baselineLog, workingLog, outputFile);

      expect(result.summary.total_newly_introduced).toBe(expectedNewlyIntroduced);
      expect(result.summary.total_pre_existing).toBe(expectedPreExisting);
      expect(result.summary.total_fixed).toBe(expectedFixed);
    }
  );
});
