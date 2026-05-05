/**
 * Shared generic test utilities and fixtures for unit and integration tests.
 * Consolidates common test setup patterns to reduce duplication.
 *
 * This module contains reusable test factories and types that can be imported
 * by multiple test files. For API-route-specific test setup, see kaseki-api-routes.test.ts.
 */

import type { KasekiApiConfig } from './kaseki-api-config';

/**
 * Test-specific config type with jest.fn() mocks.
 */
export interface TestScheduler {
  getQueueStatus: jest.Mock;
  getReadiness: jest.Mock;
  getJob: jest.Mock;
  submitJob: jest.Mock;
  listJobs: jest.Mock;
  cancelJob: jest.Mock;
}

/**
 * Possible job statuses for mock scheduler.
 */
export type MockJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Mock job object for tests.
 */
export interface MockJob {
  id: string;
  status: MockJobStatus;
  createdAt: Date;
  resultDir?: string;
  exitCode?: number;
  failureClass?: string;
  error?: string;
}

/**
 * Creates a mock scheduler with standard behavior for tests.
 * Customize by providing jobData to override default getJob behavior.
 *
 * @example
 * const scheduler = createMockScheduler();
 * scheduler.getReadiness.mockReturnValue({ ready: false, reasons: ['error'] });
 */
export function createMockScheduler(jobData?: { [jobId: string]: MockJob }): TestScheduler {
  return {
    getQueueStatus: jest.fn(() => ({ pending: 0, running: 0, maxConcurrent: 1 })),
    getReadiness: jest.fn(() => ({ ready: true, reasons: [] })),
    getJob: jest.fn((id: string) => jobData?.[id]),
    submitJob: jest.fn(),
    listJobs: jest.fn(() => []),
    cancelJob: jest.fn(),
  };
}

/**
 * Creates a standard test configuration object.
 * Pass resultsDir to set the directory; other params use reasonable defaults.
 *
 * @example
 * const config = createTestConfig('/tmp/results');
 */
export function createTestConfig(resultsDir: string): KasekiApiConfig {
  return {
    port: 0,
    apiKeys: ['test-key'],
    resultsDir,
    maxConcurrentRuns: 1,
    defaultTaskMode: 'patch' as const,
    maxDiffBytes: 200000,
    agentTimeoutSeconds: 1200,
    logLevel: 'info' as const,
  };
}
