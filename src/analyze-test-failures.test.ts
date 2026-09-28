/**
 * Tests for analyze-test-failures.ts
 *
 * Coverage targets:
 * - parseTestResults: Jest output formats (✓/✗, PASS/FAIL, [PASS]/[FAIL])
 * - classifyTests: test status transitions (pre-existing, newly-introduced, fixed)
 * - generateSummary: summary statistics calculation
 * - extractExitCode: exit code detection from logs
 */

import { analyzeTestLogs, parseTestResults, classifyTests, generateSummary, extractExitCode } from './analyze-test-failures';

describe('analyze-test-failures', () => {
  describe('parseTestResults', () => {
    it('should parse ✓/✗ format (checkmark/cross)', () => {
      const log = `
        ✓ test 1
        ✗ test 2 (50ms)
        ✓ test 3 (100ms)
      `;
      const result = parseTestResults(log, 1);

      expect(result['test 1']).toEqual({ status: 'passed' });
      expect(result['test 2']).toEqual({ status: 'failed' });
      expect(result['test 3']).toEqual({ status: 'passed' });
    });

    it('parses Node test-runner failure markers', () => {
      const result = parseTestResults('✖ OpenAPI contract is valid (33.2ms)\n✖ failing tests:', 1);

      expect(result['OpenAPI contract is valid']).toEqual({ status: 'failed' });
      expect(result['failing tests:']).toBeUndefined();
    });

    it('parses Node test-runner success markers and counts the individual cases', () => {
      const result = parseTestResults('✔ helper returns a stable path (0.8ms)\n✔ helper handles an empty list (1.1ms)\nℹ tests 2', 0);

      expect(result).toEqual({
        'helper returns a stable path': { status: 'passed' },
        'helper handles an empty list': { status: 'passed' },
      });
    });

    it('should parse PASS/FAIL format', () => {
      const log = `
        PASS test 1
        FAIL test 2 (100ms)
        PASS test 3
      `;
      const result = parseTestResults(log, 1);

      expect(result['test 1']).toEqual({ status: 'passed' });
      expect(result['test 2']).toEqual({ status: 'failed' });
      expect(result['test 3']).toEqual({ status: 'passed' });
    });

    it('should parse [PASS]/[FAIL] format (brackets)', () => {
      const log = `
        [PASS] test 1
        [FAIL] test 2
        [PASS] test 3
      `;
      const result = parseTestResults(log, 0);

      expect(result['test 1']).toEqual({ status: 'passed' });
      expect(result['test 2']).toEqual({ status: 'failed' });
      expect(result['test 3']).toEqual({ status: 'passed' });
    });

    it('should skip duplicate tests (keep first occurrence)', () => {
      const log = `
        ✓ test 1
        ✗ test 1
      `;
      const result = parseTestResults(log, 1);

      expect(Object.keys(result)).toHaveLength(1);
      expect(result['test 1']).toEqual({ status: 'passed' });
    });

    it('should handle mixed formats', () => {
      const log = `
        ✓ test 1
        FAIL test 2
        [PASS] test 3
      `;
      const result = parseTestResults(log, 0);

      expect(result['test 1']).toEqual({ status: 'passed' });
      expect(result['test 2']).toEqual({ status: 'failed' });
      expect(result['test 3']).toEqual({ status: 'passed' });
    });

    it('should infer overall status from exit code when no individual tests found', () => {
      const log = 'Some output without test patterns';

      const resultPass = parseTestResults(log, 0);
      expect(resultPass['overall']).toEqual({ status: 'passed' });

      const resultFail = parseTestResults(log, 1);
      expect(resultFail['overall']).toEqual({ status: 'failed' });
    });

    it('should skip header lines and empty lines', () => {
      const log = `
        Test Results:
        PASS test: foo

        Files: 1
        ✓ test 1
      `;
      const result = parseTestResults(log, 0);

      expect(result['test: foo']).toEqual({ status: 'passed' });
      expect(result['test 1']).toEqual({ status: 'passed' });
      expect(result['Test Results']).toBeUndefined();
    });

    it('should handle test names with special characters', () => {
      const log = `
        ✓ my-test/with.special(chars)
        ✗ test[with](brackets)
      `;
      const result = parseTestResults(log, 1);

      expect(result['my-test/with.special(chars)']).toEqual({ status: 'passed' });
      expect(result['test[with](brackets)']).toEqual({ status: 'failed' });
    });
  });

  describe('classifyTests', () => {
    it('should classify test as pre-existing (failed in both)', () => {
      const baseline = { 'test 1': { status: 'failed' as const } };
      const working = { 'test 1': { status: 'failed' as const } };

      const result = classifyTests(baseline, working);

      expect(result['test 1']).toEqual({
        baseline_status: 'failed',
        working_status: 'failed',
        category: 'pre-existing',
      });
    });

    it('should classify test as newly-introduced (passed baseline, failed working)', () => {
      const baseline = { 'test 1': { status: 'passed' as const } };
      const working = { 'test 1': { status: 'failed' as const } };

      const result = classifyTests(baseline, working);

      expect(result['test 1']).toEqual({
        baseline_status: 'passed',
        working_status: 'failed',
        category: 'newly-introduced',
      });
    });

    it('should classify test as newly-introduced (skipped baseline, failed working)', () => {
      const baseline = {};
      const working = { 'test 1': { status: 'failed' as const } };

      const result = classifyTests(baseline, working);

      expect(result['test 1']).toEqual({
        baseline_status: 'skipped',
        working_status: 'failed',
        category: 'newly-introduced',
      });
    });

    it('should classify test as fixed (failed baseline, passed working)', () => {
      const baseline = { 'test 1': { status: 'failed' as const } };
      const working = { 'test 1': { status: 'passed' as const } };

      const result = classifyTests(baseline, working);

      expect(result['test 1']).toEqual({
        baseline_status: 'failed',
        working_status: 'passed',
        category: 'fixed',
      });
    });

    it('should skip new passing tests (passed in baseline, skipped in working)', () => {
      const baseline = {};
      const working = { 'test 1': { status: 'passed' as const } };

      const result = classifyTests(baseline, working);

      expect(result['test 1']).toBeUndefined();
    });

    it('should handle multiple tests with mixed classifications', () => {
      const baseline = {
        'test 1': { status: 'failed' as const },
        'test 2': { status: 'passed' as const },
        'test 3': { status: 'failed' as const },
      };
      const working = {
        'test 1': { status: 'failed' as const },
        'test 2': { status: 'failed' as const },
        'test 3': { status: 'passed' as const },
      };

      const result = classifyTests(baseline, working);

      expect(result['test 1'].category).toBe('pre-existing');
      expect(result['test 2'].category).toBe('newly-introduced');
      expect(result['test 3'].category).toBe('fixed');
    });

    it('should include all tests with failed status in either baseline or working', () => {
      const baseline = {
        'test 1': { status: 'passed' as const },
        'test 2': { status: 'skipped' as const },
      };
      const working = {
        'test 3': { status: 'passed' as const },
      };

      const result = classifyTests(baseline, working);

      // Only tests with failed status should be included
      expect(Object.keys(result).length).toBe(0);
    });
  });

  describe('generateSummary', () => {
    it('should count pre-existing failures correctly', () => {
      const classification = {
        'test 1': {
          baseline_status: 'failed' as const,
          working_status: 'failed' as const,
          category: 'pre-existing' as const,
        },
        'test 2': {
          baseline_status: 'failed' as const,
          working_status: 'failed' as const,
          category: 'pre-existing' as const,
        },
      };

      const summary = generateSummary(classification);

      expect(summary.total_pre_existing).toBe(2);
      expect(summary.total_newly_introduced).toBe(0);
      expect(summary.total_fixed).toBe(0);
      expect(summary.total_tests).toBe(2);
    });

    it('should count newly-introduced failures correctly', () => {
      const classification = {
        'test 1': {
          baseline_status: 'passed' as const,
          working_status: 'failed' as const,
          category: 'newly-introduced' as const,
        },
        'test 2': {
          baseline_status: 'skipped' as const,
          working_status: 'failed' as const,
          category: 'newly-introduced' as const,
        },
      };

      const summary = generateSummary(classification);

      expect(summary.total_pre_existing).toBe(0);
      expect(summary.total_newly_introduced).toBe(2);
      expect(summary.total_fixed).toBe(0);
      expect(summary.total_tests).toBe(2);
    });

    it('should count fixed failures correctly', () => {
      const classification = {
        'test 1': {
          baseline_status: 'failed' as const,
          working_status: 'passed' as const,
          category: 'fixed' as const,
        },
      };

      const summary = generateSummary(classification);

      expect(summary.total_pre_existing).toBe(0);
      expect(summary.total_newly_introduced).toBe(0);
      expect(summary.total_fixed).toBe(1);
      expect(summary.total_tests).toBe(1);
    });

    it('should handle mixed classifications', () => {
      const classification = {
        'test 1': {
          baseline_status: 'failed' as const,
          working_status: 'failed' as const,
          category: 'pre-existing' as const,
        },
        'test 2': {
          baseline_status: 'passed' as const,
          working_status: 'failed' as const,
          category: 'newly-introduced' as const,
        },
        'test 3': {
          baseline_status: 'failed' as const,
          working_status: 'passed' as const,
          category: 'fixed' as const,
        },
      };

      const summary = generateSummary(classification);

      expect(summary.total_pre_existing).toBe(1);
      expect(summary.total_newly_introduced).toBe(1);
      expect(summary.total_fixed).toBe(1);
      expect(summary.total_tests).toBe(3);
    });
  });

  describe('extractExitCode', () => {
    it('should extract exit code with equals sign', () => {
      const log = 'Some output\nexit_code=42\nMore output';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(42);
    });

    it('should extract exit code with colon', () => {
      const log = 'exit-code: 1';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(1);
    });

    it('should extract exit code case-insensitive', () => {
      const log = 'Exit-Code=5';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(5);
    });

    it('should infer 1 from FAIL keyword', () => {
      const log = 'FAIL: some tests failed';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(1);
    });

    it('should infer 1 from "failed" keyword', () => {
      const log = 'Some tests failed';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(1);
    });

    it('returns unknown when no exit code or test failure marker is present', () => {
      const log = 'Everything is fine';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBeNull();
    });

    it('should prioritize explicit exit code over FAIL keyword', () => {
      const log = 'exit_code=0\nFAIL: test failed';
      const exitCode = extractExitCode(log);

      expect(exitCode).toBe(0);
    });

    it('uses the final command exit code when a validation log contains several commands', () => {
      const log = '==> npm run build\nexit_code=0\n==> npm run test\nexit_code=1';

      expect(extractExitCode(log)).toBe(1);
    });
  });

  describe('Integration: full analysis workflow', () => {
    it('should correctly analyze baseline vs working logs', () => {
      const baselineLog = `
        ✓ test 1 (50ms)
        ✓ test 2 (60ms)
        ✗ test 3 (70ms)
        exit_code=1
      `;
      const workingLog = `
        ✓ test 1 (55ms)
        ✗ test 2 (65ms)
        ✗ test 3 (75ms)
        ✓ test 4 (80ms)
        exit_code=1
      `;

      const baselineResults = parseTestResults(baselineLog, 1);
      const workingResults = parseTestResults(workingLog, 1);
      const classification = classifyTests(baselineResults, workingResults);
      const summary = generateSummary(classification);

      // test 1: passed baseline, passed working - should not be in classification
      expect(classification['test 1']).toBeUndefined();

      // test 2: passed baseline, failed working - newly-introduced
      expect(classification['test 2'].category).toBe('newly-introduced');

      // test 3: failed baseline, failed working - pre-existing
      expect(classification['test 3'].category).toBe('pre-existing');

      // test 4: new test, passing - should not be in classification
      expect(classification['test 4']).toBeUndefined();

      expect(summary.total_newly_introduced).toBe(1);
      expect(summary.total_pre_existing).toBe(1);
      expect(summary.total_fixed).toBe(0);
      expect(summary.total_tests).toBe(2);
    });

    it('does not infer a pass or fixed tests when the working validation log is empty', () => {
      const result = analyzeTestLogs('FAIL existing test\nexit_code=1\n', '');

      expect(result.baseline_comparison_reliable).toBe(false);
      expect(result.working_validation_exit_code).toBeNull();
      expect(result.working_test_results).toEqual({ overall: { status: 'skipped' } });
      expect(result.classification).toEqual({});
      expect(result.summary).toEqual({
        total_pre_existing: 0,
        total_newly_introduced: 0,
        total_fixed: 0,
        total_tests: 0,
      });
      expect(result.baseline_comparison_warning).toMatch(/working.*missing|empty/i);
    });

    it('does not classify command-not-found exit 127 as a test failure or a fix', () => {
      const result = analyzeTestLogs(
        'bash: go: command not found\nexit_code=127\n',
        'bash: go: command not found\nexit_code=127\n',
      );

      expect(result.baseline_comparison_reliable).toBe(false);
      expect(result.baseline_test_results).toEqual({ overall: { status: 'skipped' } });
      expect(result.working_test_results).toEqual({ overall: { status: 'skipped' } });
      expect(result.classification).toEqual({});
      expect(result.summary.total_fixed).toBe(0);
      expect(result.baseline_comparison_warning).toMatch(/127/);
    });

    it('still classifies reliable baseline failures fixed by a passing working run', () => {
      const result = analyzeTestLogs('FAIL existing test\nexit_code=1\n', 'PASS existing test\nexit_code=0\n');

      expect(result.baseline_comparison_reliable).toBe(true);
      expect(result.summary.total_fixed).toBe(1);
    });
  });
});
