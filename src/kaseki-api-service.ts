import express from 'express';
import type { Server } from 'http';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { createApiRouter } from './kaseki-api-routes';

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
  return async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    const hardTimeout = setTimeout(() => {
      console.error(
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
          console.log('HTTP server closed');
          resolve();
        });
      });

      scheduler.shutdown();
      console.log('Job scheduler shutdown');

      exit(0);
    } catch (err) {
      console.error('Error during graceful shutdown:', err);
      exit(1);
    } finally {
      clearTimeout(hardTimeout);
    }
  };
}

/**
 * Main Kaseki API service.
 */
async function main(): Promise<void> {
  // Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error('Configuration error:', err);
    process.exit(1);
  }

  // Create Express app
  const app = express();
  app.use(express.json());

  // Create scheduler
  const scheduler = new JobScheduler(config);

  // Mount API routes
  const apiRouter = createApiRouter(scheduler, config);
  app.use('/api', apiRouter);

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`Kaseki API service running on port ${config.port}`);
    console.log(`Log level: ${config.logLevel}`);
    console.log(`Max concurrent runs: ${config.maxConcurrentRuns}`);
    console.log(`Results directory: ${config.resultsDir}`);
  });

  // Graceful shutdown
  const gracefulShutdown = createGracefulShutdown({ server, scheduler });

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  // Catch unhandled errors
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
}

if (require.main === module) {
  void main();
}
