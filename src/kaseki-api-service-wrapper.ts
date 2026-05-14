/**
 * Kaseki API Service - Express server wrapper
 *
 * Encapsulates the complete REST API service for async execution
 */

import express from 'express';
import type { Server } from 'http';
import { loadConfig } from './kaseki-api-config';
import { createApiRouter } from './kaseki-api-routes';
import { createEventLogger } from './logger';
import { initializeSetup } from './kaseki-api/setup-orchestrator';
import { bootstrapServices, gracefulShutdown, type BootstrappedServices } from './kaseki-api/service-bootstrapper';

interface KasekiAPIServiceOptions {
  port?: number;
  apiKeys?: string[];
  logLevel?: string;
}

class KasekiAPIServiceImpl {
  private server: Server | null = null;
  private logger = createEventLogger('kaseki-api');
  private services: BootstrappedServices | null = null;
  private config = loadConfig();

  constructor(options: KasekiAPIServiceOptions = {}) {
    // Override config port if provided
    if (options.port) {
      this.config.port = options.port;
    }

    // Override API keys if provided
    if (options.apiKeys) {
      this.config.apiKeys = options.apiKeys;
      if (options.apiKeys.length === 0 && !this.config.host) {
        this.config.host = '127.0.0.1';
      }
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
      // Initialize setup (Node version check, template init)
      await initializeSetup();

      // Log startup configuration
      this.logger.event('service_startup_config', {
        port: this.config.port,
        host: this.config.host,
        authMode: this.config.apiKeys.length > 0 ? 'bearer' : 'loopback-unauthenticated',
        logLevel: this.config.logLevel,
        maxConcurrentRuns: this.config.maxConcurrentRuns,
        resultsDir: this.config.resultsDir,
        nodeVersion: process.versions.node,
      });

      if (this.config.apiKeys.length === 0) {
        this.logger.warn(
          '⚠️  Kaseki API authentication is disabled; service will only bind to loopback for trusted local development.',
          { host: this.config.host, remediation: 'Set KASEKI_API_KEYS before exposing the API on a network interface.' }
        );
      }

      // Bootstrap service components
      this.services = await bootstrapServices(this.config);

      // Create Express app
      const app = express();
      app.use(express.json());

      // Mount API routes
      const apiRouter = createApiRouter(
        this.services.scheduler,
        this.config,
        this.services.idempotencyStore,
        this.services.preFlightValidator,
        this.services.artifactCache
      );
      app.use('/api', apiRouter);
      app.use('/', apiRouter);

      // Start server
      const onListening = () => {
        const displayHost = this.config.host || 'localhost';
        this.logger.event('service_started', {
          port: this.config.port,
          host: this.config.host,
          authMode: this.config.apiKeys.length > 0 ? 'bearer' : 'loopback-unauthenticated',
          logLevel: this.config.logLevel,
          maxConcurrentRuns: this.config.maxConcurrentRuns,
        });
        console.log(`\n✓ Kaseki API service started on ${displayHost}:${this.config.port}`);
        console.log(`  Health check: http://${displayHost}:${this.config.port}/health`);
        console.log(`  API routes: http://${displayHost}:${this.config.port}/api/\n`);
      };
      this.server = this.config.host
        ? app.listen(this.config.port, this.config.host, onListening)
        : app.listen(this.config.port, onListening);

      // Setup graceful shutdown
      if (this.server && this.services) {
        process.on('SIGTERM', () => void gracefulShutdown({
          server: this.server!,
          scheduler: this.services!.scheduler,
          webhookManager: this.services!.webhookManager,
          idempotencyStore: this.services!.idempotencyStore,
        }));
        process.on('SIGINT', () => void gracefulShutdown({
          server: this.server!,
          scheduler: this.services!.scheduler,
          webhookManager: this.services!.webhookManager,
          idempotencyStore: this.services!.idempotencyStore,
        }));
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

export default KasekiAPIServiceImpl;
