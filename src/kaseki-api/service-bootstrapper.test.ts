import { bootstrapServices, gracefulShutdown } from './service-bootstrapper';
import type { KasekiApiConfig } from '../kaseki-api-config';
import type { Server } from 'http';
import * as os from 'os';
import * as path from 'path';

// Mock configuration for testing
const createMockConfig = (): KasekiApiConfig => ({
  port: 3000,
  host: 'localhost',
  resultsDir: path.join(os.tmpdir(), 'kaseki-results'),
  logLevel: 'debug',
  apiKeys: [],
  maxConcurrentRuns: 5,
  maxDiffBytes: 200000,
  agentTimeoutSeconds: 10800,
  artifactCacheMaxEntries: 100,
  artifactCacheTtlMs: 3600000,
  artifactCacheMaxFileBytes: 10485760,
  defaultTaskMode: 'patch',
});

describe('ServiceBootstrapper', () => {
  let mockConfig: KasekiApiConfig;

  beforeEach(() => {
    mockConfig = createMockConfig();
    jest.restoreAllMocks();
  });

  describe('bootstrapServices', () => {
    it('should return wired services only after the scheduler is ready', async () => {
      const artifactCache = { clearAll: jest.fn() };
      const webhookManager = {
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
      const idempotencyStore = { shutdown: jest.fn() };
      const preFlightValidator = { validate: jest.fn() };
      let resolveSchedulerReady!: () => void;
      const schedulerReady = new Promise<void>((resolve) => {
        resolveSchedulerReady = resolve;
      });
      const scheduler = {
        ready: jest.fn().mockReturnValue(schedulerReady),
        shutdown: jest.fn(),
      };
      const resultCacheConstructor = jest.fn().mockReturnValue(artifactCache);
      const webhookManagerConstructor = jest
        .fn()
        .mockReturnValue(webhookManager);
      const idempotencyStoreConstructor = jest
        .fn()
        .mockReturnValue(idempotencyStore);
      const preFlightValidatorConstructor = jest
        .fn()
        .mockReturnValue(preFlightValidator);
      const schedulerConstructor = jest.fn().mockReturnValue(scheduler);

      let mockedBootstrapServices!: typeof bootstrapServices;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../result-cache', () => ({
          ResultCache: resultCacheConstructor,
        }));
        jest.doMock('../webhook-manager', () => ({
          WebhookManager: webhookManagerConstructor,
        }));
        jest.doMock('../idempotency-store', () => ({
          IdempotencyStore: idempotencyStoreConstructor,
        }));
        jest.doMock('../pre-flight-validator', () => ({
          PreFlightValidator: preFlightValidatorConstructor,
        }));
        jest.doMock('../job-scheduler', () => ({
          JobScheduler: schedulerConstructor,
        }));

        const bootstrapper = await import('./service-bootstrapper');
        mockedBootstrapServices = bootstrapper.bootstrapServices;
      });

      const bootstrapPromise = mockedBootstrapServices(mockConfig);
      let bootstrapSettled = false;
      void bootstrapPromise.then(() => {
        bootstrapSettled = true;
      });
      await Promise.resolve();

      expect(scheduler.ready).toHaveBeenCalledTimes(1);
      expect(bootstrapSettled).toBe(false);
      expect(resultCacheConstructor).toHaveBeenCalledWith({
        maxEntries: mockConfig.artifactCacheMaxEntries,
        ttlMs: mockConfig.artifactCacheTtlMs,
        maxFileBytes: mockConfig.artifactCacheMaxFileBytes,
      });
      expect(webhookManagerConstructor).toHaveBeenCalledWith(
        mockConfig.resultsDir,
      );
      expect(idempotencyStoreConstructor).toHaveBeenCalledWith(
        mockConfig.resultsDir,
        24,
      );
      expect(preFlightValidatorConstructor).toHaveBeenCalledWith();
      expect(schedulerConstructor).toHaveBeenCalledWith(
        mockConfig,
        webhookManager,
        artifactCache,
      );

      resolveSchedulerReady();
      await expect(bootstrapPromise).resolves.toEqual({
        artifactCache,
        webhookManager,
        idempotencyStore,
        preFlightValidator,
        scheduler,
      });
    });

    it('should propagate initialization failure and not initialize downstream dependencies', async () => {
      const cleanupOrder: string[] = [];
      const cacheCleanupSpy = jest.fn(() => cleanupOrder.push('ResultCache'));
      const webhookShutdownSpy = jest.fn(async () => {
        cleanupOrder.push('WebhookManager');
      });
      const schedulerCtorSpy = jest.fn();
      const preFlightCtorSpy = jest.fn();
      const initError = new Error('IdempotencyStore failed to initialize');

      let mockedBootstrapServices!: typeof bootstrapServices;
      await jest.isolateModulesAsync(async () => {
        jest.doMock('../result-cache', () => ({
          ResultCache: jest.fn().mockImplementation(() => ({
            getOrLoad: jest.fn(),
            clearAll: cacheCleanupSpy,
          })),
        }));

        jest.doMock('../webhook-manager', () => ({
          WebhookManager: jest
            .fn()
            .mockImplementation(() => ({ shutdown: webhookShutdownSpy })),
        }));

        jest.doMock('../idempotency-store', () => ({
          IdempotencyStore: jest.fn().mockImplementation(() => {
            throw initError;
          }),
        }));

        jest.doMock('../pre-flight-validator', () => ({
          PreFlightValidator: jest.fn().mockImplementation(() => {
            preFlightCtorSpy();
            return { validate: jest.fn() };
          }),
        }));

        jest.doMock('../job-scheduler', () => ({
          JobScheduler: jest.fn().mockImplementation(() => {
            schedulerCtorSpy();
            return { shutdown: jest.fn() };
          }),
        }));

        const bootstrapper = await import('./service-bootstrapper');
        mockedBootstrapServices = bootstrapper.bootstrapServices;
      });

      await expect(mockedBootstrapServices(mockConfig)).rejects.toThrow(
        'Service bootstrap failed: IdempotencyStore failed to initialize',
      );

      expect(preFlightCtorSpy).not.toHaveBeenCalled();
      expect(schedulerCtorSpy).not.toHaveBeenCalled();
      expect(webhookShutdownSpy).toHaveBeenCalledTimes(1);
      expect(cacheCleanupSpy).toHaveBeenCalledTimes(1);
      expect(cleanupOrder).toEqual(['WebhookManager', 'ResultCache']);
    });
  });

  describe('gracefulShutdown', () => {
    let mockServer: Partial<Server>;
    let shutdownSpies: {
      serverClose: jest.Mock;
      schedulerShutdown: jest.Mock;
      webhookShutdown: jest.Mock;
      idempotencyShutdown: jest.Mock;
    };

    beforeEach(async () => {
      mockServer = {
        close: jest.fn((callback?: (err?: Error) => void) => {
          if (callback) callback();
          return mockServer as Server;
        }),
      };

      shutdownSpies = {
        serverClose: mockServer.close as jest.Mock,
        schedulerShutdown: jest.fn(),
        webhookShutdown: jest.fn().mockResolvedValue(undefined),
        idempotencyShutdown: jest.fn(),
      };
    });

    it('should call shutdown on all services in sequence', async () => {
      const mockExit = jest.fn() as unknown as (code: number) => never;

      const mockServices = {
        scheduler: { shutdown: shutdownSpies.schedulerShutdown },
        webhookManager: { shutdown: shutdownSpies.webhookShutdown },
        idempotencyStore: { shutdown: shutdownSpies.idempotencyShutdown },
      };

      await gracefulShutdown({
        server: mockServer as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
      });

      expect(shutdownSpies.serverClose).toHaveBeenCalled();
      expect(shutdownSpies.schedulerShutdown).toHaveBeenCalled();
      expect(shutdownSpies.webhookShutdown).toHaveBeenCalled();
      expect(shutdownSpies.idempotencyShutdown).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should exit with code 0 on successful shutdown', async () => {
      const mockExit = jest.fn() as unknown as (code: number) => never;

      const mockServices = {
        scheduler: { shutdown: jest.fn() },
        webhookManager: { shutdown: jest.fn().mockResolvedValue(undefined) },
        idempotencyStore: { shutdown: jest.fn() },
      };

      await gracefulShutdown({
        server: mockServer as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
        forceExitAfterMs: 100,
      });

      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should enforce hard timeout on graceful shutdown', async () => {
      // For this test, we DO NOT await gracefulShutdown because it will hang
      // We want to test that the timeout fires.
      const mockExit = jest.fn() as unknown as (code: number) => never;

      // Make webhook shutdown never resolve
      const hungWebhookShutdown = new Promise<void>(() => {});
      const mockServices = {
        scheduler: { shutdown: jest.fn() },
        webhookManager: { shutdown: () => hungWebhookShutdown },
        idempotencyStore: { shutdown: jest.fn() },
      };

      // Use real timers but a very short timeout
      gracefulShutdown({
        server: mockServer as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
        forceExitAfterMs: 50,
      });

      // Wait for the timeout to fire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should handle server close errors gracefully', async () => {
      const mockExit = jest.fn() as unknown as (code: number) => never;

      const serverError = new Error('Server close failed');
      const failingServerClose = jest.fn((callback?: (err?: Error) => void) => {
        if (callback) callback(serverError);
        return mockServer as Server;
      });

      const mockServices = {
        scheduler: { shutdown: jest.fn() },
        webhookManager: { shutdown: jest.fn().mockResolvedValue(undefined) },
        idempotencyStore: { shutdown: jest.fn() },
      };

      await gracefulShutdown({
        server: { close: failingServerClose } as unknown as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
      });

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
