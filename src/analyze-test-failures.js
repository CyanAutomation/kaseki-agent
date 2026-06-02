#!/usr/bin/env node
'use strict';
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
  function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
  return new (P || (P = Promise))(function (resolve, reject) {
    function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
    function rejected(value) { try { step(generator['throw'](value)); } catch (e) { reject(e); } }
    function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('fs');
const path = require('path');
/**
 * Parse test results from validation log using common patterns
 */
function parseTestResults(logContent, exitCode) {
  const results = {};
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
function classifyTests(baselineResults, workingResults) {
  const classification = {};
  const baselineKeys = Object.keys(baselineResults);
  const workingKeys = Object.keys(workingResults);
  const allTestNamesSet = {};
  // Combine all test names
  baselineKeys.forEach((k) => {
    allTestNamesSet[k] = true;
  });
  workingKeys.forEach((k) => {
    allTestNamesSet[k] = true;
  });
  const allTestNames = Object.keys(allTestNamesSet);
  allTestNames.forEach((testName) => {
    var _a, _b;
    const baselineStatus = ((_a = baselineResults[testName]) === null || _a === void 0 ? void 0 : _a.status) || 'skipped';
    const workingStatus = ((_b = workingResults[testName]) === null || _b === void 0 ? void 0 : _b.status) || 'skipped';
    let category;
    if (workingStatus === 'failed' && baselineStatus === 'failed') {
      category = 'pre-existing';
    }
    else if (workingStatus === 'failed' && baselineStatus === 'passed') {
      category = 'newly-introduced';
    }
    else if (workingStatus === 'passed' && baselineStatus === 'failed') {
      category = 'fixed';
    }
    else if (workingStatus !== baselineStatus) {
      category = 'changed';
    }
    else {
      // Both same status - only include if failed
      if (workingStatus === 'failed') {
        category = 'pre-existing'; // Both failed
      }
      else {
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
function generateSummary(classification) {
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
function extractExitCode(logContent) {
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
function main() {
  return __awaiter(this, void 0, void 0, function* () {
    const args = process.argv.slice(2);
    const baselineLogPath = args[0];
    const workingLogPath = args[1];
    const outputFile = args[2];
    const resultsDir = args[3] || '/results';
    if (!baselineLogPath || !workingLogPath || !outputFile) {
      console.error('Usage: analyze-test-failures.ts <baseline-log> <working-log> <output-file> [results-dir]');
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
      const result = {
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
      console.log(`Analysis complete: ${summary.total_newly_introduced} newly-introduced, ${summary.total_pre_existing} pre-existing, ${summary.total_fixed} fixed (total ${summary.total_tests})`);
      process.exit(0);
    }
    catch (error) {
      console.error('Error analyzing test failures:', error);
      fs.writeFileSync(path.join(resultsDir, 'test-failure-analysis.log'), `Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });
}
main();
