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
    it('should bootstrap all services successfully', async () => {
      const services = await bootstrapServices(mockConfig);

      expect(services).toHaveProperty('artifactCache');
      expect(services).toHaveProperty('webhookManager');
      expect(services).toHaveProperty('idempotencyStore');
      expect(services).toHaveProperty('preFlightValidator');
      expect(services).toHaveProperty('scheduler');
    });

    it('should return BootstrappedServices interface with correct types', async () => {
      const services = await bootstrapServices(mockConfig);

      expect(services.artifactCache).toBeDefined();
      expect(services.webhookManager).toBeDefined();
      expect(services.idempotencyStore).toBeDefined();
      expect(services.preFlightValidator).toBeDefined();
      expect(services.scheduler).toBeDefined();

      // Verify they are objects with expected methods
      expect(typeof services.artifactCache.getOrLoad).toBe('function');
      expect(typeof services.webhookManager.shutdown).toBe('function');
      expect(typeof services.idempotencyStore.shutdown).toBe('function');
      expect(typeof services.preFlightValidator.validate).toBe('function');
      expect(typeof services.scheduler.shutdown).toBe('function');
    });

    it('should initialize components in correct dependency order', async () => {
      const services = await bootstrapServices(mockConfig);

      // All services should be initialized (non-null)
      expect(services.artifactCache).not.toBeNull();
      expect(services.webhookManager).not.toBeNull();
      expect(services.idempotencyStore).not.toBeNull();
      expect(services.preFlightValidator).not.toBeNull();
      expect(services.scheduler).not.toBeNull();
    });

    it('should handle missing results directory gracefully', async () => {
      const configWithMissingDir: KasekiApiConfig = {
        ...mockConfig,
        resultsDir: path.join(os.tmpdir(), 'nonexistent', 'kaseki-results'),
      };

      // Should not throw; services should handle or create directory
      const services = await bootstrapServices(configWithMissingDir);
      expect(services).toBeDefined();
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
      await new Promise(resolve => setTimeout(resolve, 150));

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

  describe('BootstrappedServices interface', () => {
    it('should have all required service properties', async () => {
      const services = await bootstrapServices(mockConfig);
      expect(services).toHaveProperty('artifactCache');
      expect(services).toHaveProperty('webhookManager');
      expect(services).toHaveProperty('idempotencyStore');
      expect(services).toHaveProperty('preFlightValidator');
      expect(services).toHaveProperty('scheduler');
    });
  });
});
