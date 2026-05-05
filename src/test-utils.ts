/**
 * Shared test utilities and fixtures for unit and integration tests.
 * Consolidates common test setup patterns to reduce duplication.
 */

import * as fs from 'fs';
import * as path from 'path';
import express, { Express } from 'express';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createApiRouter } from './kaseki-api-routes';
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

/**
 * Complete test app setup: returns { app, server, port, idempotencyStore, preFlightValidator }.
 * Call server.close() in finally block to clean up.
 *
 * @param scheduler Mock scheduler (use createMockScheduler)
 * @param config Test config (use createTestConfig)
 * @returns Object with Express app, HTTP server, port number, and stores
 */
export async function createTestApp(
  scheduler: TestScheduler,
  config: KasekiApiConfig,
): Promise<{
  app: Express;
  server: Server;
  port: number;
  idempotencyStore: IdempotencyStore;
  preFlightValidator: PreFlightValidator;
}> {
  const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
  const preFlightValidator = new PreFlightValidator();

  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(scheduler as any, config, idempotencyStore, preFlightValidator));

  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    app,
    server,
    port,
    idempotencyStore,
    preFlightValidator,
  };
}

/**
 * Clean shutdown of server and idempotency store.
 */
export async function cleanupTestApp(server: Server, idempotencyStore: IdempotencyStore): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await idempotencyStore.shutdown();
}

/**
 * Creates a temporary test directory for file-based tests.
 * Remember to clean up with fs.rmSync(..., { recursive: true, force: true }).
 */
export function createTestDir(prefix = 'kaseki-test-'): string {
  return fs.mkdtempSync(path.join('/tmp', prefix));
}

/**
 * Cleans up a temporary test directory.
 */
export function cleanupTestDir(testDir: string): void {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}
