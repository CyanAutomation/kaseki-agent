import express from 'express';
import { loadConfig } from './kaseki-api-config';
import { JobScheduler } from './job-scheduler';
import { createApiRouter } from './kaseki-api-routes';

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
  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);

    // Stop accepting new requests
    server.close(() => {
      console.log('HTTP server closed');
    });

    // Abort running jobs
    scheduler.shutdown();
    console.log('Job scheduler shutdown');

    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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

main();
