import express from 'express';
import type { Server } from 'http';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { createApiRouter } from './kaseki-api-routes';
import { createEventLogger } from './logger';

type ShutdownDeps = {
  server: Server;
  scheduler: Pick<JobScheduler, 'shutdown'>;
  forceExitAfterMs?: number;
  exit?: (code: number) => never;
};

export function createGracefulShutdown({
  server,
  scheduler,
  forceExitAfterMs = 8000,
  exit = process.exit,
}: ShutdownDeps): (signal: string) => Promise<void> {
  const logger = createEventLogger('kaseki-api');
  
  return async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    const hardTimeout = setTimeout(() => {
      logger.error(
        `Graceful shutdown timeout after ${forceExitAfterMs}ms, forcing exit`,
      );
      exit(1);
    }, forceExitAfterMs);

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          logger.info('HTTP server closed');
          resolve();
        });
      });

      scheduler.shutdown();
      logger.info('Job scheduler shutdown');

      exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', { error: String(err) });
      exit(1);
    } finally {
      clearTimeout(hardTimeout);
    }
  };
}


export function assertSupportedNodeVersion(
  version: string = process.versions.node,
  minimumMajor: number = 24,
): void {
  const normalizedVersion = version.trim();
  const isValidVersion = /^\d+(?:\.\d+){0,2}$/.test(normalizedVersion);
  const major = Number.parseInt(normalizedVersion.split('.')[0] ?? '', 10);
  
  const logger = createEventLogger('kaseki-api');
  logger.info(`Node runtime detected: v${normalizedVersion}`);

  if (!isValidVersion || !Number.isFinite(major) || major < minimumMajor) {
    logger.error(
      `Unsupported Node.js runtime v${normalizedVersion}. Kaseki API service requires Node.js >= ${minimumMajor}. Please upgrade Node or deploy the Docker image built from this repo's Dockerfile (node:24-bookworm-slim).`,
    );
    process.exit(1);
  }
}

/**
 * Main Kaseki API service.
 */
async function main(): Promise<void> {
  const logger = createEventLogger('kaseki-api');
  
  assertSupportedNodeVersion();

  // Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error('Configuration error:', { error: String(err) });
    process.exit(1);
  }

  // Log detailed startup information
  logger.event('service_startup_config', {
    port: config.port,
    logLevel: config.logLevel,
    maxConcurrentRuns: config.maxConcurrentRuns,
    resultsDir: config.resultsDir,
    maxDiffBytes: config.maxDiffBytes,
    agentTimeoutSeconds: config.agentTimeoutSeconds,
    nodeVersion: process.versions.node,
    npmVersion: process.versions.npm || 'unknown',
    platform: process.platform,
    arch: process.arch,
  });

  // Log environment info
  logger.event('service_startup_environment', {
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: JSON.stringify(process.memoryUsage()),
    cpuUsage: JSON.stringify(process.cpuUsage()),
  });

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create scheduler
  const scheduler = new JobScheduler(config);

  // Mount API routes
  const apiRouter = createApiRouter(scheduler, config);
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // Start server
  const server = app.listen(config.port, () => {
    logger.event('service_started', {
      port: config.port,
      logLevel: config.logLevel,
      maxConcurrentRuns: config.maxConcurrentRuns,
      resultsDir: config.resultsDir,
      nodeVersion: process.versions.node,
    });
  });

  // Graceful shutdown
  const gracefulShutdown = createGracefulShutdown({ server, scheduler });

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  // Catch unhandled errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', { reason: String(reason) });
    process.exit(1);
  });
}

if (require.main === module) {
  void main();
}
