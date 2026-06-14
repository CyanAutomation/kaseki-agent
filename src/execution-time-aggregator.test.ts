/**
 * execution-time-aggregator.test.ts
 *
 * TDD tests for tracking API time vs tool execution time.
 * Measures wall time spent in Pi API calls vs external tool execution (git, npm, bash).
 */

import { ExecutionTimeAggregator } from './execution-time-aggregator';

describe('ExecutionTimeAggregator', () => {
  let aggregator: ExecutionTimeAggregator;

  beforeEach(() => {
    aggregator = new ExecutionTimeAggregator();
  });

  describe('initialization', () => {
    test('starts with zero times', () => {
      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(0);
      expect(summary.tool_time_seconds).toBe(0);
      expect(summary.total_time_seconds).toBe(0);
      expect(summary.api_percent).toBe(0);
      expect(summary.tool_percent).toBe(0);
    });
  });

  describe('API time tracking', () => {
    test('records single API call duration', () => {
      aggregator.recordApiCall('pi-agent', 5.5);
      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(5.5);
      expect(summary.total_time_seconds).toBe(5.5);
    });

    test('accumulates multiple API calls', () => {
      aggregator.recordApiCall('pi-agent', 3.0);
      aggregator.recordApiCall('pi-scouting', 2.5);
      aggregator.recordApiCall('pi-goal-check', 1.5);

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(7.0);
    });

    test('tracks per-API call statistics', () => {
      aggregator.recordApiCall('pi-agent', 5.0);
      aggregator.recordApiCall('pi-agent', 3.0);
      aggregator.recordApiCall('pi-scouting', 2.0);

      const stats = aggregator.getApiStats();
      expect(stats['pi-agent']).toEqual({
        calls: 2,
        total_seconds: 8.0,
      });
      expect(stats['pi-scouting']).toEqual({
        calls: 1,
        total_seconds: 2.0,
      });
    });
  });

  describe('tool execution time tracking', () => {
    test('records single tool execution', () => {
      aggregator.recordToolExecution('npm test', 12.3);
      const summary = aggregator.getSummary();
      expect(summary.tool_time_seconds).toBe(12.3);
      expect(summary.total_time_seconds).toBe(12.3);
    });

    test('accumulates multiple tool executions', () => {
      aggregator.recordToolExecution('git clone', 5.0);
      aggregator.recordToolExecution('npm ci', 8.0);
      aggregator.recordToolExecution('npm test', 15.0);

      const summary = aggregator.getSummary();
      expect(summary.tool_time_seconds).toBe(28.0);
    });

    test('tracks per-tool statistics', () => {
      aggregator.recordToolExecution('npm test', 10.0);
      aggregator.recordToolExecution('npm test', 8.0);
      aggregator.recordToolExecution('git diff', 1.5);

      const stats = aggregator.getToolStats();
      expect(stats['npm test']).toEqual({
        calls: 2,
        total_seconds: 18.0,
      });
      expect(stats['git diff']).toEqual({
        calls: 1,
        total_seconds: 1.5,
      });
    });
  });

  describe('mixed API and tool time', () => {
    test('calculates correct percentages with both time types', () => {
      aggregator.recordApiCall('pi-agent', 10.0);
      aggregator.recordToolExecution('npm test', 30.0);
      aggregator.recordToolExecution('git clone', 10.0);

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(10.0);
      expect(summary.tool_time_seconds).toBe(40.0);
      expect(summary.total_time_seconds).toBe(50.0);
      expect(summary.api_percent).toBe(20);
      expect(summary.tool_percent).toBe(80);
    });

    test('handles zero total time gracefully', () => {
      const summary = aggregator.getSummary();
      expect(summary.api_percent).toBe(0);
      expect(summary.tool_percent).toBe(0);
    });

    test('rounds percentages to 2 decimal places', () => {
      // 1/3 = 33.333...%
      aggregator.recordApiCall('pi-agent', 10.0);
      aggregator.recordToolExecution('npm test', 20.0);

      const summary = aggregator.getSummary();
      expect(summary.api_percent).toBe(33.33);
      expect(summary.tool_percent).toBe(66.67);
    });
  });

  describe('getSummary()', () => {
    test('returns API, tool, total, and percentage values after recording durations', () => {
      aggregator.recordApiCall('pi-agent', 5.0);
      aggregator.recordToolExecution('npm test', 10.0);

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(5.0);
      expect(summary.tool_time_seconds).toBe(10.0);
      expect(summary.total_time_seconds).toBe(15.0);
      expect(summary.api_percent).toBe(33.33);
      expect(summary.tool_percent).toBe(66.67);
    });
  });

  describe('edge cases', () => {
    test('handles zero-duration calls', () => {
      aggregator.recordApiCall('pi-agent', 0);
      aggregator.recordToolExecution('npm test', 0);

      const summary = aggregator.getSummary();
      expect(summary.total_time_seconds).toBe(0);
    });

    test('handles very small durations', () => {
      aggregator.recordApiCall('pi-agent', 0.001);
      aggregator.recordToolExecution('npm test', 0.002);

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBeCloseTo(0.001);
      expect(summary.tool_time_seconds).toBeCloseTo(0.002);
    });

    test('handles very large durations', () => {
      aggregator.recordApiCall('pi-agent', 3600); // 1 hour
      aggregator.recordToolExecution('npm test', 7200); // 2 hours

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(3600);
      expect(summary.tool_time_seconds).toBe(7200);
      expect(summary.total_time_seconds).toBe(10800);
    });
  });

  describe('multiple execution phases', () => {
    test('tracks time across different Pi phases', () => {
      // Scouting phase
      aggregator.recordApiCall('pi-scouting', 2.0);
      aggregator.recordToolExecution('npm test', 5.0);

      // Main agent phase
      aggregator.recordApiCall('pi-agent', 8.0);
      aggregator.recordToolExecution('npm build', 10.0);

      // Goal check phase
      aggregator.recordApiCall('pi-goal-check', 1.5);
      aggregator.recordToolExecution('npm test', 3.0);

      const summary = aggregator.getSummary();
      expect(summary.api_time_seconds).toBe(11.5); // 2 + 8 + 1.5
      expect(summary.tool_time_seconds).toBe(18.0); // 5 + 10 + 3
      expect(summary.total_time_seconds).toBe(29.5);
    });
  });
});
