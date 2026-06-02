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
  timestamp: string;
}

/**
 * Parse test results from validation log using common patterns
 */
function parseTestResults(logContent: string, exitCode: number): Record<string, TestResult> {
  const results: Record<string, TestResult> = {};

  // Pattern 1: Jest/Vitest format
  // ✓ test name or PASS test name
  // ✗ test name or FAIL test name
  const testPatterns = [
    /✓\s+(.+?)(?:\s+\(\d+ms\))?$/gm,
    /✗\s+(.+?)(?:\s+\(\d+ms\))?$/gm,
    /PASS\s+(.+?)(?:\s+\(\d+ms\))?$/gm,
    /FAIL\s+(.+?)(?:\s+\(\d+ms\))?$/gm,
  ];

  // Extract passed tests
  const passedRegex = /✓\s+(.+?)(?:\s+\(\d+ms\))?$/gm;
  let match;
  while ((match = passedRegex.exec(logContent)) !== null) {
    const testName = match[1].trim();
    if (testName && !results[testName]) {
      results[testName] = { status: 'passed' };
    }
  }

  // Extract failed tests
  const failedRegex = /✗\s+(.+?)(?:\s+\(\d+ms\))?$/gm;
  while ((match = failedRegex.exec(logContent)) !== null) {
    const testName = match[1].trim();
    if (testName) {
      results[testName] = { status: 'failed' };
    }
  }

  // Pattern 2: Generic PASS/FAIL lines
  const passTestRegex = /(?:PASS|✓|\[PASS\])\s+(.+?)(?:\s+|$)/gm;
  while ((match = passTestRegex.exec(logContent)) !== null) {
    const testName = match[1].trim();
    if (testName && testName.length > 3 && !results[testName]) {
      results[testName] = { status: 'passed' };
    }
  }

  const failTestRegex = /(?:FAIL|✗|\[FAIL\])\s+(.+?)(?:\s+|$)/gm;
  while ((match = failTestRegex.exec(logContent)) !== null) {
    const testName = match[1].trim();
    if (testName && testName.length > 3) {
      results[testName] = { status: 'failed' };
    }
  }

  // Pattern 3: "X tests passed, Y failed" summary
  const summaryMatch = logContent.match(/(\d+)\s+(?:test|spec)s?\s+(?:passed|skipped)/i);
  if (summaryMatch && Object.keys(results).length === 0) {
    // If no individual tests found, infer overall status from exit code
    // (helpful as fallback for frameworks that don't emit per-test lines)
    results['overall'] = { status: exitCode === 0 ? 'passed' : 'failed' };
  }

  return results;
}

/**
 * Classify test results by comparing baseline and working
 */
function classifyTests(
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
    if (workingStatus === 'failed' && baselineStatus === 'failed') {
      category = 'pre-existing';
    } else if (workingStatus === 'failed' && baselineStatus === 'passed') {
      category = 'newly-introduced';
    } else if (workingStatus === 'passed' && baselineStatus === 'failed') {
      category = 'fixed';
    } else if (workingStatus !== baselineStatus) {
      category = 'changed';
    } else {
      // Both same status - only include if failed
      if (workingStatus === 'failed') {
        category = 'pre-existing'; // Both failed
      } else {
        return; // Both passed or skipped - skip including in report
      }
    }

    classification[testName] = {
      baseline_status: baselineStatus,
      working_status: workingStatus,
      category,
    };
  });

  return classification;
}

/**
 * Generate summary statistics
 */
function generateSummary(classification: Record<string, TestClassification>) {
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
function extractExitCode(logContent: string): number {
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

    // Build result object
    const result: AnalysisResult = {
      baseline_validation_exit_code: baselineExitCode,
      working_validation_exit_code: workingExitCode,
      baseline_test_results: baselineResults,
      working_test_results: workingResults,
      classification,
      summary,
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

main();
