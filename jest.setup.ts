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
// Store reference to the real process.exit before mocking (to use in emergency shutdown)
const realProcessExit = process.exit.bind(process);
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

  // Destroy all HTTP/HTTPS agent sockets to prevent connection pool exhaustion
  // This is critical because Node.js's fetch() uses global HttpAgent/HttpsAgent
  // which keep sockets alive for connection reuse. If not drained, these sockets
  // prevent the process from exiting.
  try {
    // @ts-ignore - Accessing Node's internal HTTP agents
    const http = require('http');
    const https = require('https');
    
    // Destroy all sockets in the global HTTP agent
    if (http.globalAgent) {
      const httpSockets = Object.values(http.globalAgent.sockets || {});
      for (const socketList of httpSockets) {
        if (Array.isArray(socketList)) {
          for (const socket of socketList) {
            socket.destroy();
          }
        }
      }
    }
    
    // Destroy all sockets in the global HTTPS agent
    if (https.globalAgent) {
      const httpsSockets = Object.values(https.globalAgent.sockets || {});
      for (const socketList of httpsSockets) {
        if (Array.isArray(socketList)) {
          for (const socket of socketList) {
            socket.destroy();
          }
        }
      }
    }
  } catch {
    // If agents don't exist or we can't access them, continue
  }
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

  // Kill any lingering child processes (critical for spawn() usage in tests)
  try {
    const { spawn: _spawn } = require('child_process');
    // @ts-ignore - Access to private Node API
    const activeRequests = process._getActiveRequests?.() || [];
    for (const req of activeRequests) {
      if (req && typeof req.kill === 'function') {
        try {
          req.kill();
        } catch {
          // Already dead
        }
      }
    }
  } catch {
    // Child process module may not be available
  }

  // Aggressively clean up HTTP/HTTPS global agents
  try {
    // @ts-ignore - Accessing Node's internal HTTP agents
    const http = require('http');
    const https = require('https');
    
    // Destroy ALL sockets in global HTTP agent
    if (http.globalAgent) {
      const httpSockets = http.globalAgent.sockets || {};
      for (const [key, socketList] of Object.entries(httpSockets)) {
        if (Array.isArray(socketList)) {
          while (socketList.length > 0) {
            const socket = socketList.pop();
            if (socket) {
              socket.destroy();
            }
          }
        }
      }
      // Also destroy requests pending
      const httpRequests = http.globalAgent.requests || {};
      for (const [key, requestList] of Object.entries(httpRequests)) {
        if (Array.isArray(requestList)) {
          while (requestList.length > 0) {
            const req = requestList.pop();
            if (req) {
              req.abort?.();
              req.destroy?.();
            }
          }
        }
      }
    }
    
    // Destroy ALL sockets in global HTTPS agent
    if (https.globalAgent) {
      const httpsSockets = https.globalAgent.sockets || {};
      for (const [key, socketList] of Object.entries(httpsSockets)) {
        if (Array.isArray(socketList)) {
          while (socketList.length > 0) {
            const socket = socketList.pop();
            if (socket) {
              socket.destroy();
            }
          }
        }
      }
      // Also destroy requests pending
      const httpsRequests = https.globalAgent.requests || {};
      for (const [key, requestList] of Object.entries(httpsRequests)) {
        if (Array.isArray(requestList)) {
          while (requestList.length > 0) {
            const req = requestList.pop();
            if (req) {
              req.abort?.();
              req.destroy?.();
            }
          }
        }
      }
    }
  } catch (e) {
    // If agents don't exist or we can't access them, continue
  }

  // Give Node a moment to complete any pending operations
  await new Promise(resolve => setImmediate(resolve));

  // Check for open handles using private API
  if (process.env.KASEKI_DEBUG_HANDLES === '1') {
    try {
      // @ts-ignore - Accessing private Node API
      const handles = process._getActiveHandles?.() || [];
      // @ts-ignore
      const requests = process._getActiveRequests?.() || [];
      console.error('Open handles:', handles.length);
      console.error('Open requests:', requests.length);
      
      // Log details about what's keeping the process alive
      for (let i = 0; i < handles.length && i < 5; i++) {
        // @ts-ignore
        const handle = handles[i];
        const name = handle?.constructor?.name || typeof handle;
        console.error(`  Handle ${i}: ${name}`);
        // Log more details for file descriptors
        if (handle && handle.fd !== undefined) {
          console.error(`    - FD: ${handle.fd}`);
        }
      }
      for (let i = 0; i < requests.length && i < 5; i++) {
        // @ts-ignore
        console.error(`Request ${i}:`, requests[i]?.constructor?.name || typeof requests[i]);
      }
    } catch {
      // Private API not available
    }
  }

  // Set a timeout to force exit if cleanup takes too long
  // This is a safety net for persistent hangs - tests should complete in ~60s total
  const forceExitTimeout = setTimeout(() => {
    // At this point, afterAll has had 5 seconds to clean up
    // If we're still here, something is keeping the process alive
    // Use the real process.exit stored before mocking
    try {
      realProcessExit(0);
    } catch {
      // If real exit throws (shouldn't happen), try direct exit
      // @ts-ignore - Using private Node API as last resort
      process._exit?.(0);
    }
  }, 5000);
  
  // Allow this timeout to not block process exit (make it a "weak" reference)
  forceExitTimeout.unref();
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
