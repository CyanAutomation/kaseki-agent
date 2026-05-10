/**
 * Example: Using per-test log suppression utilities
 *
 * This example demonstrates how to use the log suppression utilities
 * when you need to capture or debug logs in specific tests.
 */

import {
  suppressLogs,
  restoreLogs,
  getCapturedLogs,
  getCapturedLogByEventType,
  getCapturedLogsByEventType,
  clearCapturedLogs,
  withSuppressedLogs,
} from '../test-utils/log-suppression';

describe('Log Suppression Utilities Example', () => {
  afterEach(() => {
    // Good practice: clear captured logs between tests
    clearCapturedLogs();
  });

  it('example 1: manual suppress/restore', () => {
    suppressLogs();
    // Your code that would normally print logs
    console.log('This will be suppressed');
    console.log(JSON.stringify({
      timestamp: '2026-05-10T20:00:03.721Z',
      component: 'job-scheduler',
      event_type: 'job_started',
    }));
    restoreLogs();

    // Now you can inspect what was logged
    const captured = getCapturedLogs();
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toContain('job_started');
  });

  it('example 2: query captured logs by event type', () => {
    suppressLogs();
    console.log(JSON.stringify({
      timestamp: '2026-05-10T20:00:03.721Z',
      component: 'job-scheduler',
      event_type: 'job_started',
      jobId: 'kaseki-1',
    }));
    console.log(JSON.stringify({
      timestamp: '2026-05-10T20:00:04.721Z',
      component: 'job-scheduler',
      event_type: 'job_completed',
      jobId: 'kaseki-1',
    }));
    restoreLogs();

    // Query specific event types
    const startEvent = getCapturedLogByEventType('job_started');
    expect(startEvent?.jobId).toBe('kaseki-1');

    const allCompletionEvents = getCapturedLogsByEventType('job_completed');
    expect(allCompletionEvents).toHaveLength(1);
  });

  it('example 3: withSuppressedLogs helper', async () => {
    // This helper automatically handles suppress/restore
    await withSuppressedLogs(async () => {
      console.log(JSON.stringify({
        timestamp: '2026-05-10T20:00:03.721Z',
        component: 'job-scheduler',
        event_type: 'job_started',
      }));
      // You can use await here if needed
      await Promise.resolve();
    });

    // After withSuppressedLogs returns, logs are automatically restored
    const captured = getCapturedLogs();
    expect(captured.length).toBeGreaterThan(0);
  });

  it('example 4: globals suppression (default behavior)', () => {
    // By default, all tests have logs suppressed globally (unless KASEKI_SUPPRESS_LOGS=0)
    // This test demonstrates that JSON logs don't appear even without explicit calls
    console.log(JSON.stringify({
      timestamp: '2026-05-10T20:00:03.721Z',
      component: 'job-scheduler',
      event_type: 'job_started',
    }));
    console.log('Non-JSON output still prints');

    // If we capture at the end, we should have one log
    // (Note: global capture only works if jest.setup.ts enables it)
  });

  it('example 5: non-JSON console.log passes through', () => {
    suppressLogs();
    // This non-JSON output should NOT be suppressed
    console.log('Regular string output');
    console.log({ some: 'object' });
    restoreLogs();

    // These pass through because they're not valid JSON event logs
    // They would appear in test output
  });
});
