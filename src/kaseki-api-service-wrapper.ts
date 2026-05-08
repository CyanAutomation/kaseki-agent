/**
 * Kaseki API Service - Express server wrapper
 * 
 * Encapsulates the complete REST API service for async execution
 */

import express from 'express';
import type { Server } from 'http';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { WebhookManager } from './webhook-manager';
import { IdempotencyStore } from './idempotency-store';
import { PreFlightValidator } from './pre-flight-validator';
import { createApiRouter } from './kaseki-api-routes';
import { createEventLogger } from './logger';
import { ResultCache } from './result-cache';
import { createGracefulShutdown, assertSupportedNodeVersion } from './kaseki-api-service';

interface KasekiAPIServiceOptions {
  port?: number;
  apiKeys?: string[];
  logLevel?: string;
}

export class KasekiAPIServiceImpl {
  private server: Server | null = null;
  private logger = createEventLogger('kaseki-api');
  private scheduler: JobScheduler | null = null;
  private webhookManager: WebhookManager | null = null;
  private idempotencyStore: IdempotencyStore | null = null;
  private artifactCache: ResultCache | null = null;
  private config = loadConfig();

  constructor(options: KasekiAPIServiceOptions = {}) {
    // Override config port if provided
    if (options.port) {
      this.config.port = options.port;
    }

    // Override log level if provided
    if (options.logLevel) {
      const validLevels: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {
        debug: 'debug',
        info: 'info',
        warn: 'warn',
        error: 'error',
      };
      const level = validLevels[options.logLevel] || 'info';
      this.config.logLevel = level;
    }
  }

  /**
   * Start the API service
   */
  async start(): Promise<void> {
    try {
      // Validate Node.js version
      assertSupportedNodeVersion();

      // Log startup configuration
      this.logger.event('service_startup_config', {
        port: this.config.port,
        logLevel: this.config.logLevel,
        maxConcurrentRuns: this.config.maxConcurrentRuns,
        resultsDir: this.config.resultsDir,
        nodeVersion: process.versions.node,
      });

      // Create Express app
      const app = express();
      app.use(express.json());

      // Create managers
      this.artifactCache = new ResultCache({
        maxEntries: this.config.artifactCacheMaxEntries,
        ttlMs: this.config.artifactCacheTtlMs,
        maxFileBytes: this.config.artifactCacheMaxFileBytes,
      });

      this.webhookManager = new WebhookManager(this.config.resultsDir);
      this.idempotencyStore = new IdempotencyStore(this.config.resultsDir, 24);
      const preFlightValidator = new PreFlightValidator();

      // Create scheduler
      this.scheduler = new JobScheduler(
        this.config,
        this.webhookManager,
        this.artifactCache
      );

      // Mount API routes
      const apiRouter = createApiRouter(
        this.scheduler,
        this.config,
        this.idempotencyStore,
        preFlightValidator,
        this.artifactCache
      );
      app.use('/api', apiRouter);
      app.use('/', apiRouter);

      // Start server
      this.server = app.listen(this.config.port, () => {
        this.logger.event('service_started', {
          port: this.config.port,
          logLevel: this.config.logLevel,
          maxConcurrentRuns: this.config.maxConcurrentRuns,
        });
        console.log(`\n✓ Kaseki API service started on port ${this.config.port}`);
        console.log(`  Health check: http://localhost:${this.config.port}/health`);
        console.log(`  API routes: http://localhost:${this.config.port}/api/\n`);
      });

      // Setup graceful shutdown
      if (this.server && this.scheduler && this.webhookManager && this.idempotencyStore) {
        const gracefulShutdown = createGracefulShutdown({
          server: this.server,
          scheduler: this.scheduler,
          webhookManager: this.webhookManager,
          idempotencyStore: this.idempotencyStore,
        });

        process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
      }

      // Catch unhandled errors
      process.on('uncaughtException', (err) => {
        this.logger.error('Uncaught exception:', {
          error: String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        process.exit(1);
      });

      process.on('unhandledRejection', (reason) => {
        this.logger.error('Unhandled rejection:', { reason: String(reason) });
        process.exit(1);
      });
    } catch (error) {
      this.logger.error('Failed to start service:', { error: String(error) });
      throw error;
    }
  }

  /**
   * Stop the API service
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('API service stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get service port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Get service status
   */
  getStatus(): {
    running: boolean;
    port: number;
    uptime: number;
  } {
    return {
      running: this.server?.listening ?? false,
      port: this.config.port,
      uptime: process.uptime(),
    };
  }
}

// Export both class name styles for compatibility
export const KasekiAPIService = KasekiAPIServiceImpl;
export default KasekiAPIServiceImpl;
