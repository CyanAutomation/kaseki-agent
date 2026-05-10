/**
 * Test Utilities: Log Suppression Helpers
 *
 * Provides per-test control over log suppression when you need to debug
 * specific tests or capture logs for assertions.
 *
 * Example usage:
 *   import { suppressLogs, restoreLogs, getCapturedLogs } from '@src/test-utils/log-suppression';
 *
 *   it('should test something with logging', () => {
 *     suppressLogs();
 *     // ... test code that would normally print logs
 *     restoreLogs();
 *     const logs = getCapturedLogs();
 *     // ... assertions on captured logs
 *   });
 */

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace NodeJS {
    interface Global {
      __kasekiCapturedLogs?: string[];
      __kasekiOriginalLog?: typeof console.log;
      __kasekiLogsEnabled?: boolean;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

/**
 * Suppress JSON event logs for the current test.
 * Logs are still captured in __kasekiCapturedLogs and can be retrieved.
 */
export function suppressLogs(): void {
  if ((global as any).__kasekiLogsEnabled === false) {
    return; // Already suppressed
  }

  // Store the current console.log
  (global as any).__kasekiOriginalLog = console.log;

  // Replace with suppressing version
  console.log = (...args: any[]): void => {
    const filteredArgs = args
      .map((arg) => {
        if (typeof arg === 'string' && isJsonEventLog(arg)) {
          (global as any).__kasekiCapturedLogs?.push(arg);
          return null;
        }
        return arg;
      })
      .filter((arg) => arg !== null);

    if (filteredArgs.length > 0) {
      (global as any).__kasekiOriginalLog?.(...filteredArgs);
    }
  };

  (global as any).__kasekiLogsEnabled = false;
}

/**
 * Restore console.log to its original state, allowing all logs to print.
 */
export function restoreLogs(): void {
  if ((global as any).__kasekiLogsEnabled === true || (global as any).__kasekiOriginalLog === undefined) {
    return; // Already restored or nothing to restore
  }

  console.log = (global as any).__kasekiOriginalLog;
  (global as any).__kasekiLogsEnabled = true;
}

/**
 * Get all JSON event logs that were suppressed/captured since the last clearCapturedLogs() call.
 * Useful for asserting on log output without printing it during test execution.
 *
 * @returns Array of JSON event log strings
 */
export function getCapturedLogs(): string[] {
  return (global as any).__kasekiCapturedLogs ?? [];
}

/**
 * Clear the captured logs buffer. Call this between tests if you need a fresh slate.
 */
export function clearCapturedLogs(): void {
  (global as any).__kasekiCapturedLogs = [];
}

/**
 * Get a specific captured log by event type.
 *
 * @param eventType - The event_type field to search for (e.g., 'job_started')
 * @returns The first matching log object or undefined
 */
export function getCapturedLogByEventType(eventType: string): Record<string, any> | undefined {
  const logs = getCapturedLogs();
  for (const logStr of logs) {
    try {
      const log = JSON.parse(logStr);
      if (log.event_type === eventType) {
        return log;
      }
    } catch {
      // Skip invalid JSON
    }
  }
  return undefined;
}

/**
 * Get all captured logs of a specific event type.
 *
 * @param eventType - The event_type field to search for
 * @returns Array of matching log objects
 */
export function getCapturedLogsByEventType(eventType: string): Record<string, any>[] {
  const logs = getCapturedLogs();
  const matches: Record<string, any>[] = [];

  for (const logStr of logs) {
    try {
      const log = JSON.parse(logStr);
      if (log.event_type === eventType) {
        matches.push(log);
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return matches;
}

/**
 * Check if a JSON event log is valid (has required fields).
 * This is the same check used in jest.setup.ts.
 */
function isJsonEventLog(str: string): boolean {
  try {
    const obj = JSON.parse(str);
    const isEventLog =
      typeof obj === 'object' &&
      obj !== null &&
      'timestamp' in obj &&
      'component' in obj &&
      ('event_type' in obj || 'level' in obj || 'message' in obj);
    return isEventLog;
  } catch {
    return false;
  }
}

/**
 * Run a test function with logs suppressed, automatically cleaning up.
 * Convenient wrapper for tests that just need suppression without explicit restore.
 *
 * @param testFn - The test function to run with suppressed logs
 */
export function withSuppressedLogs(testFn: () => void | Promise<void>): void | Promise<void> {
  suppressLogs();
  try {
    const result = testFn();
    if (result instanceof Promise) {
      return result.finally(() => restoreLogs());
    }
    restoreLogs();
    return result;
  } catch (error) {
    restoreLogs();
    throw error;
  }
}
