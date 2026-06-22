#!/usr/bin/env node

/**
 * Analyze test failures to distinguish pre-existing failures from newly-introduced ones.
 *
 * Compares test results from baseline (main branch) vs working branch to classify failures:
 * - pre-existing: Failed in both baseline and working (or baseline only)
 * - newly-introduced: Passed in baseline, failed in working
 * - fixed: Failed in baseline, passed in working
 *
 * Usage:
 *   node analyze-test-failures.ts <baseline-log> <working-log> <output-file> [results-dir]
 *
 * Inputs:
 *   - baseline-log: Path to baseline validation.log
 *   - working-log: Path to working validation.log
 *   - output-file: Path to write test-baseline-comparison.json
 *   - results-dir: Path to results directory (default: /results)
 *
 * Outputs:
 *   - JSON file with test classification and summary
 */

import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  status: 'passed' | 'failed' | 'skipped';
  command?: string;
}

interface TestClassification {
  baseline_status: 'passed' | 'failed' | 'skipped';
  working_status: 'passed' | 'failed' | 'skipped';
  category: 'pre-existing' | 'newly-introduced' | 'fixed' | 'changed';
}

interface AnalysisResult {
  baseline_validation_exit_code: number;
  working_validation_exit_code: number;
  baseline_test_results: Record<string, TestResult>;
  working_test_results: Record<string, TestResult>;
  classification: Record<string, TestClassification>;
  summary: {
    total_pre_existing: number;
    total_newly_introduced: number;
    total_fixed: number;
    total_tests: number;
  };
  baseline_comparison_reliable: boolean;
  baseline_comparison_warning?: string;
  timestamp: string;
}

/**
 * Parse test results from validation log using common patterns
 */
export function parseTestResults(logContent: string, exitCode: number): Record<string, TestResult> {
  const results: Record<string, TestResult> = {};

  // Split into lines for processing
  const lines = logContent.split('\n');

  // Track which test names we've already seen to avoid duplicates
  const seenTests = new Set<string>();

  for (const line of lines) {
    // Skip empty lines and header lines
    if (!line.trim() || /^(Test|PASS|FAIL|Tests|Files):/.test(line.trim())) {
      continue;
    }

    // Pattern 1: ✓ test name or ✗ test name
    let match = line.match(/^\s*✓\s+(.+?)(?:\s+\(\d+ms\))?$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'passed' };
        seenTests.add(testName);
        continue;
      }
    }

    match = line.match(/^\s*✗\s+(.+?)(?:\s+\(\d+ms\))?$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'failed' };
        seenTests.add(testName);
        continue;
      }
    }

    // Pattern 2: PASS test name or FAIL test name
    match = line.match(/^\s*PASS\s+(.+?)(?:\s+\(\d+ms\))?$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'passed' };
        seenTests.add(testName);
        continue;
      }
    }

    match = line.match(/^\s*FAIL\s+(.+?)(?:\s+\(\d+ms\))?$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'failed' };
        seenTests.add(testName);
        continue;
      }
    }

    // Pattern 3: [PASS] test name or [FAIL] test name
    match = line.match(/^\s*\[PASS\]\s+(.+?)$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'passed' };
        seenTests.add(testName);
        continue;
      }
    }

    match = line.match(/^\s*\[FAIL\]\s+(.+?)$/);
    if (match) {
      const testName = match[1].trim();
      if (testName && !seenTests.has(testName)) {
        results[testName] = { status: 'failed' };
        seenTests.add(testName);
        continue;
      }
    }
  }

  // If no individual tests found, infer overall status from exit code
  if (Object.keys(results).length === 0) {
    results['overall'] = { status: exitCode === 0 ? 'passed' : 'failed' };
  }

  return results;
}

/**
 * Classify test results by comparing baseline and working
 */
export function classifyTests(
  baselineResults: Record<string, TestResult>,
  workingResults: Record<string, TestResult>
): Record<string, TestClassification> {
  const classification: Record<string, TestClassification> = {};
  const baselineKeys = Object.keys(baselineResults);
  const workingKeys = Object.keys(workingResults);
  const allTestNamesSet: { [key: string]: boolean } = {};

  // Combine all test names
  baselineKeys.forEach((k) => {
    allTestNamesSet[k] = true;
  });
  workingKeys.forEach((k) => {
    allTestNamesSet[k] = true;
  });
  const allTestNames = Object.keys(allTestNamesSet);

  allTestNames.forEach((testName) => {
    const baselineStatus = baselineResults[testName]?.status || 'skipped';
    const workingStatus = workingResults[testName]?.status || 'skipped';

    let category: TestClassification['category'];

    // Determine classification based on status transitions
    if (workingStatus === 'failed' && baselineStatus === 'failed') {
      // Same test, still failing
      category = 'pre-existing';
    } else if (workingStatus === 'failed' && (baselineStatus === 'passed' || baselineStatus === 'skipped')) {
      // Either was passing and now failing, or is new and failing
      category = 'newly-introduced';
    } else if (workingStatus === 'passed' && baselineStatus === 'failed') {
      // Was failing, now passing
      category = 'fixed';
    } else if (workingStatus === 'passed' && baselineStatus === 'skipped') {
      // New test but passing - don't include in report
      return;
    } else if (workingStatus === 'skipped' || baselineStatus === 'skipped') {
      // Test disappeared or was never run - classify as changed but may skip reporting
      category = 'changed';
    } else {
      // Fallback for any other case
      category = 'changed';
    }

    // Only include failed tests and transitions between failed/passed states
    if (workingStatus === 'failed' || baselineStatus === 'failed') {
      classification[testName] = {
        baseline_status: baselineStatus,
        working_status: workingStatus,
        category,
      };
    }
  });

  return classification;
}

/**
 * Generate summary statistics
 */
export function generateSummary(classification: Record<string, TestClassification>) {
  const summary = {
    total_pre_existing: 0,
    total_newly_introduced: 0,
    total_fixed: 0,
    total_tests: 0,
  };

  for (const [, result] of Object.entries(classification)) {
    if (result.working_status === 'failed' || result.baseline_status === 'failed') {
      summary.total_tests++;
    }

    switch (result.category) {
    case 'pre-existing':
      summary.total_pre_existing++;
      break;
    case 'newly-introduced':
      summary.total_newly_introduced++;
      break;
    case 'fixed':
      summary.total_fixed++;
      break;
    }
  }

  return summary;
}

/**
 * Extract exit codes from validation logs (if present)
 */
export function extractExitCode(logContent: string): number {
  const exitMatch = logContent.match(/exit[_-]?code[=:]\s*(\d+)/i);
  if (exitMatch) {
    return parseInt(exitMatch[1], 10);
  }
  // Check for "FAIL" in summary
  if (logContent.includes('FAIL') || logContent.includes('failed')) {
    return 1;
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const baselineLogPath = args[0];
  const workingLogPath = args[1];
  const outputFile = args[2];
  const resultsDir = args[3] || '/results';

  if (!baselineLogPath || !workingLogPath || !outputFile) {
    console.error(
      'Usage: analyze-test-failures.ts <baseline-log> <working-log> <output-file> [results-dir]'
    );
    process.exit(1);
  }

  try {
    // Read logs
    const baselineLog = fs.existsSync(baselineLogPath)
      ? fs.readFileSync(baselineLogPath, 'utf8')
      : '';
    const workingLog = fs.existsSync(workingLogPath)
      ? fs.readFileSync(workingLogPath, 'utf8')
      : '';

    // Parse test results
    const baselineExitCode = extractExitCode(baselineLog);
    const workingExitCode = extractExitCode(workingLog);

    const baselineResults = parseTestResults(baselineLog, baselineExitCode);
    const workingResults = parseTestResults(workingLog, workingExitCode);

    // Classify tests
    const classification = classifyTests(baselineResults, workingResults);
    const summary = generateSummary(classification);
    const baselineComparisonReliable = baselineExitCode === 0 || baselineExitCode === 1;
    const baselineComparisonWarning = baselineComparisonReliable
      ? undefined
      : `Baseline validation exited ${baselineExitCode}; test failure classification may be incomplete because baseline results were not produced normally.`;

    // Build result object
    const result: AnalysisResult = {
      baseline_validation_exit_code: baselineExitCode,
      working_validation_exit_code: workingExitCode,
      baseline_test_results: baselineResults,
      working_test_results: workingResults,
      classification,
      summary,
      baseline_comparison_reliable: baselineComparisonReliable,
      ...(baselineComparisonWarning ? { baseline_comparison_warning: baselineComparisonWarning } : {}),
      timestamp: new Date().toISOString(),
    };

    // Write result
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
    console.log(
      `Analysis complete: ${summary.total_newly_introduced} newly-introduced, ${summary.total_pre_existing} pre-existing, ${summary.total_fixed} fixed (total ${summary.total_tests})`
    );

    process.exit(0);
  } catch (error) {
    console.error('Error analyzing test failures:', error);
    fs.writeFileSync(
      path.join(resultsDir, 'test-failure-analysis.log'),
      `Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

// Only run main if this is being executed directly (not imported as a module)
if (require.main === module) {
  main();
}
