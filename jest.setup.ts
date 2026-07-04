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

// Keep tests hermetic on developer and deployment hosts. Git must never prompt
// for real credentials, and application config must not resolve from the real
// home directory unless a test opts in explicitly.
process.env.GIT_TERMINAL_PROMPT = '0';
process.env.GCM_INTERACTIVE = 'never';
process.env.KASEKI_TEST_MODE = '1';

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
 * Helper function: Destroy all sockets in a given agent
 * @param agent - HTTP or HTTPS agent with sockets property
 */
function destroyAgentSockets(agent: any): void {
  if (!agent) return;
  try {
    const sockets = Object.values(agent.sockets || {});
    for (const socketList of sockets) {
      if (Array.isArray(socketList)) {
        for (const socket of socketList) {
          socket.destroy();
        }
      }
    }
  } catch {
    // If sockets don't exist or we can't access them, continue
  }
}

/**
 * Helper function: Cleanup global HTTP and HTTPS agents (fast version for afterEach)
 * Destroys all sockets in the global HTTP/HTTPS agents to prevent connection pool exhaustion.
 * This is critical because Node.js's fetch() uses global HttpAgent/HttpsAgent
 * which keep sockets alive for connection reuse.
 */
function cleanupHttpAgents(): void {
  try {
    // @ts-ignore - Accessing Node's internal HTTP agents
    const http = require('http');
    const https = require('https');
    
    destroyAgentSockets(http.globalAgent);
    destroyAgentSockets(https.globalAgent);
  } catch {
    // If agents don't exist or we can't access them, continue
  }
}

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

  // Cleanup HTTP/HTTPS agent sockets (fast path)
  cleanupHttpAgents();
});

/**
 * Helper function: Destroy all requests (pending and queued) in a given agent
 * @param agent - HTTP or HTTPS agent with requests property
 */
function destroyAgentRequests(agent: any): void {
  if (!agent) return;
  try {
    const requests = Object.values(agent.requests || {});
    for (const requestList of requests) {
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
  } catch {
    // If requests don't exist or we can't access them, continue
  }
}

/**
 * Helper function: Aggressively cleanup global HTTP and HTTPS agents (slow version for afterAll)
 * Destroys all sockets AND requests in the global agents.
 * This is more thorough than afterEach cleanup.
 */
function cleanupHttpAgentsAggressive(): void {
  try {
    // @ts-ignore - Accessing Node's internal HTTP agents
    const http = require('http');
    const https = require('https');
    
    if (http.globalAgent) {
      // Destroy sockets
      const httpSockets = http.globalAgent.sockets || {};
      for (const [, socketList] of Object.entries(httpSockets)) {
        if (Array.isArray(socketList)) {
          while (socketList.length > 0) {
            const socket = socketList.pop();
            if (socket) {
              socket.destroy();
            }
          }
        }
      }
      // Destroy pending requests
      destroyAgentRequests(http.globalAgent);
    }
    
    if (https.globalAgent) {
      // Destroy sockets
      const httpsSockets = https.globalAgent.sockets || {};
      for (const [, socketList] of Object.entries(httpsSockets)) {
        if (Array.isArray(socketList)) {
          while (socketList.length > 0) {
            const socket = socketList.pop();
            if (socket) {
              socket.destroy();
            }
          }
        }
      }
      // Destroy pending requests
      destroyAgentRequests(https.globalAgent);
    }
  } catch (e) {
    // If agents don't exist or we can't access them, continue
  }
}

/**
 * Helper function: Cleanup undici connection pool (used by Node's fetch)
 */
async function cleanupUndiciDispatcher(): Promise<void> {
  try {
    const { getGlobalDispatcher } = require('undici');
    const dispatcher = getGlobalDispatcher();
    if (dispatcher && typeof dispatcher.destroy === 'function') {
      await dispatcher.destroy();
    }
  } catch {
    // undici might not be explicitly installed or accessible
  }
}

/**
 * Helper function: Kill any lingering child processes
 */
function cleanupChildProcesses(): void {
  try {
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
    // Child process module may not be available or private API not accessible
  }
}

/**
 * Helper function: Remove all process event listeners that might keep the process alive
 */
function cleanupProcessListeners(): void {
  try {
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    
    // Remove all other process listeners that might keep it alive
    const allListeners = process.eventNames();
    for (const listener of allListeners) {
      process.removeAllListeners(listener as string);
    }
  } catch {
    // If we can't remove listeners, continue
  }
}

/**
 * Helper function: Log open handles for debugging (debug mode only)
 */
function debugLogOpenHandles(): void {
  if (process.env.KASEKI_DEBUG_HANDLES !== '1') return;
  
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

  // Cleanup process listeners
  cleanupProcessListeners();

  // Kill any lingering child processes
  cleanupChildProcesses();

  // Aggressively clean up HTTP/HTTPS global agents
  cleanupHttpAgentsAggressive();

  // Cleanup undici dispatcher
  await cleanupUndiciDispatcher();

  // Give Node a moment to complete any pending operations
  await new Promise(resolve => setImmediate(resolve));

  // Log open handles for debugging (if enabled)
  debugLogOpenHandles();

  // Signal successful exit code; Jest's forceExit (jest.config.ts) handles
  // forcibly terminating any lingering open handles after all tests complete.
  process.exitCode = 0;
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
