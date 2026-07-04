import {
  bootstrapServices,
  gracefulShutdown,
  type ServiceBootstrapFactories,
} from './service-bootstrapper';
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

const asService = <T>(service: unknown): T => service as T;

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

      const factories: ServiceBootstrapFactories = {
        createResultCache: jest.fn(() => asService(artifactCache)),
        createWebhookManager: jest.fn(() => asService(webhookManager)),
        createIdempotencyStore: jest.fn(() => asService(idempotencyStore)),
        createPreFlightValidator: jest.fn(() => asService(preFlightValidator)),
        createJobScheduler: jest.fn(() => asService(scheduler)),
      };

      const bootstrapPromise = bootstrapServices(mockConfig, factories);
      let bootstrapSettled = false;
      void bootstrapPromise.then(() => {
        bootstrapSettled = true;
      });
      await Promise.resolve();

      expect(scheduler.ready).toHaveBeenCalledTimes(1);
      expect(bootstrapSettled).toBe(false);

      resolveSchedulerReady();
      await expect(bootstrapPromise).resolves.toEqual({
        artifactCache,
        webhookManager,
        idempotencyStore,
        preFlightValidator,
        scheduler,
      });
      expect(factories.createJobScheduler).toHaveBeenCalledWith(
        mockConfig,
        webhookManager,
        artifactCache,
      );
    });

    it('should propagate initialization failure and clean up already-created services', async () => {
      const cleanupOrder: string[] = [];
      const artifactCache = {
        clearAll: jest.fn(() => cleanupOrder.push('ResultCache')),
      };
      const webhookManager = {
        shutdown: jest.fn(async () => {
          cleanupOrder.push('WebhookManager');
        }),
      };
      const idempotencyError = new Error('IdempotencyStore failed to initialize');
      const factories: ServiceBootstrapFactories = {
        createResultCache: jest.fn(() => asService(artifactCache)),
        createWebhookManager: jest.fn(() => asService(webhookManager)),
        createIdempotencyStore: jest.fn(() => {
          throw idempotencyError;
        }),
        createPreFlightValidator: jest.fn(() => asService({ validate: jest.fn() })),
        createJobScheduler: jest.fn(() =>
          asService({ ready: jest.fn(), shutdown: jest.fn() }),
        ),
      };

      await expect(bootstrapServices(mockConfig, factories)).rejects.toThrow(
        'Service bootstrap failed: IdempotencyStore failed to initialize',
      );

      expect(factories.createPreFlightValidator).not.toHaveBeenCalled();
      expect(factories.createJobScheduler).not.toHaveBeenCalled();
      expect(webhookManager.shutdown).toHaveBeenCalledTimes(1);
      expect(artifactCache.clearAll).toHaveBeenCalledTimes(1);
      expect(cleanupOrder).toEqual(['WebhookManager', 'ResultCache']);
    });
  });

  describe('gracefulShutdown', () => {
    let mockServer: Partial<Server>;
    beforeEach(async () => {
      mockServer = {
        close: jest.fn((callback?: (err?: Error) => void) => {
          if (callback) callback();
          return mockServer as Server;
        }),
      };
    });

    it('should call shutdown on all services in sequence', async () => {
      const shutdownOrder: string[] = [];
      const mockExit = jest.fn(() => {
        shutdownOrder.push('exit');
      }) as unknown as (code: number) => never;

      const sequencedServer = {
        close: jest.fn((callback?: (err?: Error) => void) => {
          shutdownOrder.push('server');
          callback?.();
          return sequencedServer as unknown as Server;
        }),
      };
      const mockServices = {
        scheduler: {
          shutdown: jest.fn(() => shutdownOrder.push('scheduler')),
        },
        webhookManager: {
          shutdown: jest.fn(async () => {
            shutdownOrder.push('webhookManager');
          }),
        },
        idempotencyStore: {
          shutdown: jest.fn(() => shutdownOrder.push('idempotencyStore')),
        },
      };

      await gracefulShutdown({
        server: sequencedServer as unknown as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
      });

      expect(sequencedServer.close).toHaveBeenCalled();
      expect(mockServices.scheduler.shutdown).toHaveBeenCalled();
      expect(mockServices.webhookManager.shutdown).toHaveBeenCalled();
      expect(mockServices.idempotencyStore.shutdown).toHaveBeenCalled();
      expect(shutdownOrder).toEqual([
        'server',
        'scheduler',
        'webhookManager',
        'idempotencyStore',
        'exit',
      ]);
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

    it('should enforce hard timeout on graceful shutdown', () => {
      jest.useFakeTimers();
      const mockExit = jest.fn() as unknown as (code: number) => never;
      const forceExitAfterMs = 50;
      const hungWebhookShutdown = new Promise<void>(() => {});
      const mockServices = {
        scheduler: { shutdown: jest.fn() },
        webhookManager: { shutdown: () => hungWebhookShutdown },
        idempotencyStore: { shutdown: jest.fn() },
      };

      void gracefulShutdown({
        server: mockServer as Server,
        scheduler: mockServices.scheduler,
        webhookManager: mockServices.webhookManager,
        idempotencyStore: mockServices.idempotencyStore,
        exit: mockExit,
        forceExitAfterMs,
      });

      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(forceExitAfterMs);

      expect(mockExit).toHaveBeenCalledWith(1);
      jest.useRealTimers();
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
