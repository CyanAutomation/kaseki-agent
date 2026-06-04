/**
 * tool-reliability-aggregator.test.ts
 *
 * TDD tests for tracking tool call success/failure rates.
 * Uses error pattern detection to classify tool calls as successful or failed.
 */

import { ToolReliabilityAggregator } from './tool-reliability-aggregator';

describe('ToolReliabilityAggregator', () => {
  let aggregator: ToolReliabilityAggregator;

  beforeEach(() => {
    aggregator = new ToolReliabilityAggregator();
  });

  describe('initialization', () => {
    test('starts with zero counts', () => {
      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(0);
      expect(summary.successful_tool_calls).toBe(0);
      expect(summary.failed_tool_calls).toBe(0);
      expect(summary.success_rate_percent).toBe(0);
    });
  });

  describe('recording tool start events', () => {
    test('increments tool call count when start+end recorded', () => {
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Successfully read file');
      expect(aggregator.getSummary().total_tool_calls).toBe(1);
    });

    test('tracks multiple tool calls', () => {
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('execute_bash');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('git_diff');
      aggregator.recordToolEnd('Success');
      expect(aggregator.getSummary().total_tool_calls).toBe(3);
    });
  });

  describe('recording tool end events with success', () => {
    test('marks tool as successful when no error patterns detected', () => {
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Successfully read file src/index.ts');

      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(1);
      expect(summary.successful_tool_calls).toBe(1);
      expect(summary.failed_tool_calls).toBe(0);
      expect(summary.success_rate_percent).toBe(100);
    });

    test('tracks multiple successful tools', () => {
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Read 100 lines');

      aggregator.recordToolStart('execute_bash');
      aggregator.recordToolEnd('npm test passed');

      const summary = aggregator.getSummary();
      expect(summary.successful_tool_calls).toBe(2);
      expect(summary.success_rate_percent).toBe(100);
    });
  });

  describe('recording tool end events with failure', () => {
    test('marks tool as failed when error patterns detected', () => {
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Error: file not found src/missing.ts');

      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(1);
      expect(summary.successful_tool_calls).toBe(0);
      expect(summary.failed_tool_calls).toBe(1);
      expect(summary.success_rate_percent).toBe(0);
    });

    test('detects various error patterns', () => {
      const errorMessages = [
        'Error: cannot parse JSON',
        'FAILED: assertion failed',
        'Tool failed to execute',
        'Exception: invalid input',
        'Cannot access file',
        'Unable to delete directory',
        'Invalid syntax detected',
        'undefined is not callable',
        'null reference',
        'File not found',
        'Directory does not exist',
        'Process exited with code 1',
      ];

      errorMessages.forEach((msg, idx) => {
        aggregator.recordToolStart(`tool_${idx}`);
        aggregator.recordToolEnd(msg);
      });

      const summary = aggregator.getSummary();
      expect(summary.failed_tool_calls).toBe(errorMessages.length);
      expect(summary.success_rate_percent).toBe(0);
    });
  });

  describe('mixed success/failure', () => {
    test('calculates correct success rate for mixed outcomes', () => {
      // 3 successes
      aggregator.recordToolStart('tool1');
      aggregator.recordToolEnd('Success: completed');
      aggregator.recordToolStart('tool2');
      aggregator.recordToolEnd('All systems operational');
      aggregator.recordToolStart('tool3');
      aggregator.recordToolEnd('Finished without issues');

      // 2 failures
      aggregator.recordToolStart('tool4');
      aggregator.recordToolEnd('Error: operation failed');
      aggregator.recordToolStart('tool5');
      aggregator.recordToolEnd('Failed: timeout exceeded');

      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(5);
      expect(summary.successful_tool_calls).toBe(3);
      expect(summary.failed_tool_calls).toBe(2);
      expect(summary.success_rate_percent).toBe(60);
    });
  });

  describe('tool-level tracking', () => {
    test('provides per-tool success rates', () => {
      // Tool A: 2 successes, 1 failure
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('read_file');
      aggregator.recordToolEnd('Error: file not found');

      // Tool B: 1 success, 1 failure
      aggregator.recordToolStart('execute_bash');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('execute_bash');
      aggregator.recordToolEnd('Error: timeout');

      const toolStats = aggregator.getToolStats();
      expect(toolStats.read_file).toEqual({
        total: 3,
        successful: 2,
        failed: 1,
        success_rate_percent: 66.67,
      });
      expect(toolStats.execute_bash).toEqual({
        total: 2,
        successful: 1,
        failed: 1,
        success_rate_percent: 50,
      });
    });

    test('handles tools with all successes', () => {
      aggregator.recordToolStart('git_diff');
      aggregator.recordToolEnd('Changes detected');
      aggregator.recordToolStart('git_diff');
      aggregator.recordToolEnd('No changes');

      const toolStats = aggregator.getToolStats();
      expect(toolStats.git_diff.success_rate_percent).toBe(100);
    });

    test('handles tools with all failures', () => {
      aggregator.recordToolStart('delete_file');
      aggregator.recordToolEnd('Error: permission denied');
      aggregator.recordToolStart('delete_file');
      aggregator.recordToolEnd('Error: file locked');

      const toolStats = aggregator.getToolStats();
      expect(toolStats.delete_file.success_rate_percent).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('handles missing tool start (direct end)', () => {
      // Record end without a matching start
      aggregator.recordToolEnd('Some output');
      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(1);
      expect(summary.successful_tool_calls).toBe(1);
    });

    test('handles empty tool end message', () => {
      aggregator.recordToolStart('tool1');
      aggregator.recordToolEnd('');

      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(1);
      expect(summary.successful_tool_calls).toBe(1); // Empty is not error
    });

    test('handles null/undefined tool end message', () => {
      aggregator.recordToolStart('tool1');
      aggregator.recordToolEnd(null as any);
      aggregator.recordToolStart('tool2');
      aggregator.recordToolEnd(undefined as any);

      const summary = aggregator.getSummary();
      expect(summary.total_tool_calls).toBe(2);
      expect(summary.successful_tool_calls).toBe(2);
    });

    test('case-insensitive error detection', () => {
      aggregator.recordToolStart('tool1');
      aggregator.recordToolEnd('ERROR: something failed');
      aggregator.recordToolStart('tool2');
      aggregator.recordToolEnd('Error: another issue');
      aggregator.recordToolStart('tool3');
      aggregator.recordToolEnd('error: lowercase error');

      const summary = aggregator.getSummary();
      expect(summary.failed_tool_calls).toBe(3);
    });
  });

  describe('getSummary()', () => {
    test('returns all required summary fields', () => {
      aggregator.recordToolStart('test');
      aggregator.recordToolEnd('Success');

      const summary = aggregator.getSummary();
      expect(summary).toHaveProperty('total_tool_calls');
      expect(summary).toHaveProperty('successful_tool_calls');
      expect(summary).toHaveProperty('failed_tool_calls');
      expect(summary).toHaveProperty('success_rate_percent');
    });

    test('rounds success rate to 2 decimal places', () => {
      // 1 success, 2 failures = 33.333...%
      aggregator.recordToolStart('t1');
      aggregator.recordToolEnd('Success');
      aggregator.recordToolStart('t2');
      aggregator.recordToolEnd('Error: fail');
      aggregator.recordToolStart('t3');
      aggregator.recordToolEnd('Error: fail');

      const summary = aggregator.getSummary();
      expect(summary.success_rate_percent).toBe(33.33);
    });
  });
});
