/**
 * Jest Setup File: Global console output suppression for JSON event logs
 * 
 * This setup file intercepts console.log() calls during tests and suppresses
 * JSON event logs while preserving legitimate console output. This drastically
 * reduces test output noise from the logger's emitEvent() calls.
 * 
 * Suppression can be controlled via:
 * - KASEKI_SUPPRESS_LOGS environment variable (defaults to '1' = enabled)
 * - KASEKI_SUPPRESS_LOGS=0 npm run test  (disable suppression)
 * - Per-test control via src/test-utils/log-suppression.ts helpers
 */

// Initialize captured logs storage
(global as any).__kasekiCapturedLogs = [];

// Determine if suppression should be enabled
const shouldSuppressLogs = () => {
  const envValue = process.env.KASEKI_SUPPRESS_LOGS;
  // Default to '1' (suppress), unless explicitly set to '0'
  return envValue === undefined || envValue !== '0';
};

// Determine if in CI environment (preserve logs for debugging CI failures)
const isCI = process.env.CI === 'true' || process.env.CI === '1';

// Check if a string is a valid JSON event log from emitEvent()
const isJsonEventLog = (str: string): boolean => {
  try {
    const obj = JSON.parse(str);
    // Must have these fields to be a valid event log
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
};

// Store original console.log
const originalLog = console.log;

// Override console.log with filtering logic
console.log = (...args: any[]): void => {
  const shouldSuppress = shouldSuppressLogs() && !isCI;

  // Process each argument
  const filteredArgs = args
    .map((arg) => {
      // If it's a string that looks like JSON event log, suppress it
      if (typeof arg === 'string' && shouldSuppress && isJsonEventLog(arg)) {
        // Capture it for potential debugging
        (global as any).__kasekiCapturedLogs?.push(arg);
        return null; // Signal to skip this argument
      }
      return arg;
    })
    .filter((arg) => arg !== null);

  // Only call original log if we have non-suppressed arguments
  if (filteredArgs.length > 0) {
    originalLog(...filteredArgs);
  }
};

// Ensure console.log is restored after tests (cleanup)
afterAll(() => {
  // Clear captured logs
  (global as any).__kasekiCapturedLogs = [];
});

// Optional: Restore original console.log if KASEKI_RESTORE_LOGS is set (for debugging)
if (process.env.KASEKI_RESTORE_LOGS === '1') {
  console.log = originalLog;
}
