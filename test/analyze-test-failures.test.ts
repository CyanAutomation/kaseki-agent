#!/usr/bin/env node

/**
 * Integration tests for analyze-test-failures.ts
 * Tests parsing, classification, and summary generation
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface TestCase {
  name: string;
  baselineLog: string;
  workingLog: string;
  expectedNewlyIntroduced: number;
  expectedPreExisting: number;
  expectedFixed: number;
}

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

async function runAnalyzer(
  baselineLog: string,
  workingLog: string,
  outputFile: string
): Promise<any> {
  const baselineFile = outputFile + '.baseline';
  const workingFile = outputFile + '.working';

  try {
    fs.writeFileSync(baselineFile, baselineLog);
    fs.writeFileSync(workingFile, workingLog);

    // Run the analyzer
    execSync(
      `node src/analyze-test-failures.ts "${baselineFile}" "${workingFile}" "${outputFile}"`,
      { cwd: '/workspaces/kaseki-agent' }
    );

    const result = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    return result;
  } finally {
    // Cleanup
    try {
      fs.unlinkSync(baselineFile);
    } catch (e) {
      // ignore
    }
    try {
      fs.unlinkSync(workingFile);
    } catch (e) {
      // ignore
    }
  }
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  const tmpDir = '/tmp/analyze-test-failures-integration';

  // Ensure tmp dir exists
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  console.log('\n=== Integration Tests for analyze-test-failures.ts ===\n');

  for (const testCase of testCases) {
    try {
      const outputFile = path.join(tmpDir, `${testCase.name.replace(/\s+/g, '-')}.json`);

      const result = await runAnalyzer(testCase.baselineLog, testCase.workingLog, outputFile);

      const { total_newly_introduced, total_pre_existing, total_fixed } = result.summary;

      const newlyIntroducedMatch = total_newly_introduced === testCase.expectedNewlyIntroduced;
      const preExistingMatch = total_pre_existing === testCase.expectedPreExisting;
      const fixedMatch = total_fixed === testCase.expectedFixed;

      if (newlyIntroducedMatch && preExistingMatch && fixedMatch) {
        console.log(`✓ PASS: ${testCase.name}`);
        console.log(
          `  newly_introduced=${total_newly_introduced}, pre_existing=${total_pre_existing}, fixed=${total_fixed}`
        );
        passed++;
      } else {
        console.log(`✗ FAIL: ${testCase.name}`);
        console.log(`  Expected: newly_introduced=${testCase.expectedNewlyIntroduced}, pre_existing=${testCase.expectedPreExisting}, fixed=${testCase.expectedFixed}`);
        console.log(
          `  Got:      newly_introduced=${total_newly_introduced}, pre_existing=${total_pre_existing}, fixed=${total_fixed}`
        );
        failed++;
      }

      // Cleanup output file
      try {
        fs.unlinkSync(outputFile);
      } catch (e) {
        // ignore
      }
    } catch (error) {
      console.log(`✗ ERROR: ${testCase.name}`);
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  console.log('\n=== Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);

  if (failed === 0) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed');
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
