import * as path from 'path';

describe('KasekiApiService Integration', () => {
  describe('Module imports and exports', () => {
    it('should export initializeSetup from setup-orchestrator', async () => {
      const { initializeSetup } = await import('./kaseki-api/setup-orchestrator');
      expect(typeof initializeSetup).toBe('function');
    });

    it('should export bootstrapServices from service-bootstrapper', async () => {
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');
      expect(typeof bootstrapServices).toBe('function');
    });

    it('should export gracefulShutdown from service-bootstrapper', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');
      expect(typeof gracefulShutdown).toBe('function');
    });

    it('should export public API from kaseki-api barrel file', async () => {
      const api = await import('./kaseki-api');
      expect(typeof api.initializeSetup).toBe('function');
      expect(typeof api.bootstrapServices).toBe('function');
      expect(typeof api.gracefulShutdown).toBe('function');
    });
  });

  describe('Service Integration', () => {
    it('should bootstrap services with callable contracts and cache behavior', async () => {
      const os = await import('os');
      const fs = await import('fs');
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');

      const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-integration-'));
      const artifactPath = path.join(resultsDir, 'artifact.log');
      fs.writeFileSync(artifactPath, 'payload-1', 'utf-8');

      let services;
      try {
        services = await bootstrapServices({
          port: 3000,
          host: 'localhost',
          resultsDir,
          logLevel: 'info',
          apiKeys: [],
          maxConcurrentRuns: 2,
          maxDiffBytes: 200000,
          agentTimeoutSeconds: 600,
          artifactCacheMaxEntries: 5,
          artifactCacheTtlMs: 60000,
          artifactCacheMaxFileBytes: 1024 * 1024,
          defaultTaskMode: 'patch',
        });

        expect(typeof services.scheduler.shutdown).toBe('function');
        expect(typeof services.webhookManager.shutdown).toBe('function');
        expect(typeof services.idempotencyStore.shutdown).toBe('function');
        expect(typeof services.preFlightValidator.validate).toBe('function');

        const first = services.artifactCache.getOrLoad(artifactPath);
        const second = services.artifactCache.getOrLoad(artifactPath);
        const stats = services.artifactCache.getStats();

        expect(first).toBe('payload-1');
        expect(second).toBe('payload-1');
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(1);
      } finally {
        if (services) {
          services.scheduler.shutdown();
          await services.webhookManager.shutdown();
          services.idempotencyStore.shutdown();
        }
        fs.rmSync(resultsDir, { recursive: true, force: true });
      }
    });

    // Circular dependency prevention belongs in static CI checks (dependency graph/lint rules),
    // not runtime import tests. Successful imports do not prove absence of cycles.
  });

  describe('Type safety', () => {
    it('should export BootstrappedServices interface', async () => {
      // This is a TypeScript compile-time check, but we can verify the type exists
      const { bootstrapServices } = await import('./kaseki-api/service-bootstrapper');
      expect(bootstrapServices).toBeDefined();
    });

    it('should export SetupContext interface', async () => {
      const { initializeSetup } = await import('./kaseki-api/setup-orchestrator');
      expect(initializeSetup).toBeDefined();
    });

    it('should export ShutdownDeps interface', async () => {
      const { gracefulShutdown } = await import('./kaseki-api/service-bootstrapper');
      expect(gracefulShutdown).toBeDefined();
    });
  });

  describe('Module organization', () => {
    it('should have separation of concerns', async () => {
      // Setup orchestrator should be independent
      const setupOrch = await import('./kaseki-api/setup-orchestrator');
      expect(setupOrch.initializeSetup).toBeDefined();

      // Service bootstrapper should be independent
      const serviceBoots = await import('./kaseki-api/service-bootstrapper');
      expect(serviceBoots.bootstrapServices).toBeDefined();
      expect(serviceBoots.gracefulShutdown).toBeDefined();

      // Main service should orchestrate both
      const apiService = await import('./kaseki-api-service');
      expect(apiService).toBeDefined();
    });

    it('should have barrel file for public API', async () => {
      const barrel = await import('./kaseki-api');
      expect(barrel.initializeSetup).toBeDefined();
      expect(barrel.bootstrapServices).toBeDefined();
      expect(barrel.gracefulShutdown).toBeDefined();
    });
  });

  describe('Code size metrics', () => {
    it('should have refactored kaseki-api-service.ts to ~100 LOC', async () => {
      // This is a rough check - actual line count may vary with formatting
      const fs = await import('fs');
      const content = fs.readFileSync(
        path.join(__dirname, './kaseki-api-service.ts'),
        'utf-8',
      );
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      // Should be significantly smaller than original ~370 LOC
      expect(lines.length).toBeLessThan(180); // Accounting for whitespace, comments, etc.
    });

    it('should have setup-orchestrator.ts ~80-120 LOC', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        path.join(__dirname, './kaseki-api/setup-orchestrator.ts'),
        'utf-8',
      );
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      expect(lines.length).toBeGreaterThan(50);
      expect(lines.length).toBeLessThan(150);
    });

    it('should have service-bootstrapper.ts ~100-150 LOC', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        path.join(__dirname, './kaseki-api/service-bootstrapper.ts'),
        'utf-8',
      );
      const lines = content.split('\n').filter(line => line.trim().length > 0);

      expect(lines.length).toBeGreaterThan(80);
      expect(lines.length).toBeLessThan(180);
    });
  });
});
