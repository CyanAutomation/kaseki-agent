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

/**
 * Mock process.exit to prevent Jest process from terminating during tests
 * By default, spy on process.exit to prevent actual exit
 */
const processExitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  const error = new Error(`process.exit(${code ?? 0}) called`);
  throw error;
}) as never);

/**
 * Global afterEach hook to ensure proper cleanup between tests
 * This prevents handle leaks from process.exit spy and other resources
 */
afterEach(() => {
  // Reset the process.exit spy mock to clear call history
  // but keep the mock implementation active
  processExitSpy.mockClear();

  // Restore all mocked timers to real timers if any test left them in fake state
  try {
    jest.useRealTimers();
  } catch {
    // Already using real timers, ignore
  }

  // Clear any remaining console overrides from suppression system
  (global as any).__kasekiCapturedLogs = [];

  // Clear all pending timers to prevent handle leaks
  jest.clearAllTimers();
});

/**
 * Global afterAll hook to clean up global resources after all tests complete
 * This prevents handle leaks that span test suites
 */
afterAll(async () => {
  // Restore the process.exit spy completely
  processExitSpy.mockRestore();

  // Clear all timers
  jest.clearAllTimers();

  // Clear captured logs
  (global as any).__kasekiCapturedLogs = [];
  delete (global as any).__kasekiCapturedLogs;

  // Force cleanup of any lingering listeners to prevent hanging
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  
  // Remove all other process listeners that might keep it alive
  const allListeners = process.eventNames();
  for (const listener of allListeners) {
    process.removeAllListeners(listener as string);
  }
  
  // Give Node a moment to complete any pending operations
  await new Promise(resolve => setImmediate(resolve));
  
  // As a last resort, if tests are still hanging, we can force a more aggressive exit
  // but only log it if in CI or JEST_FORCE_EXIT is set
  if (process.env.JEST_FORCE_EXIT === '1' || isCI) {
    // Set a timeout to force exit after cleanup hooks complete
    // This is a safety net for persistent hangs
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  }
});

/**
 * Global mocks for tree-sitter to avoid native module loading issues
 * during tests that mock the 'fs' module.
 * Tests that need real tree-sitter should jest.unmock() these.
 */
jest.mock('tree-sitter', () => {
  return jest.fn().mockImplementation(() => ({
    parse: jest.fn().mockReturnValue({
      rootNode: { type: 'program', children: [], startIndex: 0, endIndex: 0 }
    }),
    setLanguage: jest.fn()
  }));
});
jest.mock('tree-sitter-typescript', () => ({
  typescript: {}
}));
jest.mock('tree-sitter-go', () => ({
  language: {}
}));
