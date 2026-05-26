import express from 'express';
import swaggerUi from 'swagger-ui-express';
import * as fs from 'fs';
import { loadConfig } from './kaseki-api-config';
import { createApiRouter } from './kaseki-api-routes';
import { createWebRouter } from './kaseki-api-web';
import { createEventLogger } from './logger';
import { generateOpenAPISpec } from './openapi-spec-generator';
import { initializeSetup, assertSupportedNodeVersion, ensureTemplateInitialized } from './kaseki-api/setup-orchestrator';
import { bootstrapServices, gracefulShutdown, type ShutdownDeps } from './kaseki-api/service-bootstrapper';
import { ContainerPreflightDiagnostics, logContainerPreflightResults } from './startup/container-preflight';

export { assertSupportedNodeVersion, ensureTemplateInitialized };

/**
 * Legacy wrapper for gracefulShutdown to maintain backwards compatibility
 */
export function createGracefulShutdown(deps: ShutdownDeps) {
  return () => gracefulShutdown(deps);
}

export function ensureResultsDir(resultsDir: string): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.accessSync(resultsDir, fs.constants.R_OK | fs.constants.W_OK);
}

/**
 * Main Kaseki API service.
 */
async function main(): Promise<void> {
  const logger = createEventLogger('kaseki-api');

  // Phase 3: Auto-initialize setup (Node version and template directory)
  const templateDir = process.env.KASEKI_TEMPLATE_DIR || '/agents/kaseki-template';
  await initializeSetup(templateDir);

  // Load configuration
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error('Configuration error:', { error: String(err) });
    process.exit(1);
  }

  try {
    ensureResultsDir(config.resultsDir);
  } catch (err) {
    logger.error('Results directory is not ready:', {
      resultsDir: config.resultsDir,
      error: String(err),
      remediation: 'Create the directory and make it writable by the API container user, or run scripts/kaseki-setup-host.sh --fix.',
    });
    process.exit(1);
  }

  // Log detailed startup information
  logger.info(`KASEKI_RESULTS_DIR: ${config.resultsDir}`);
  logger.event('service_startup_config', {
    port: config.port,
    host: config.host,
    authMode: config.apiKeys.length > 0 ? 'bearer' : 'loopback-unauthenticated',
    logLevel: config.logLevel,
    maxConcurrentRuns: config.maxConcurrentRuns,
    resultsDir: config.resultsDir,
    maxDiffBytes: config.maxDiffBytes,
    agentTimeoutSeconds: config.agentTimeoutSeconds,
    artifactCacheMaxEntries: config.artifactCacheMaxEntries,
    artifactCacheTtlMs: config.artifactCacheTtlMs,
    artifactCacheMaxFileBytes: config.artifactCacheMaxFileBytes,
    nodeVersion: process.versions.node,
    npmVersion: process.versions.npm || 'unknown',
    platform: process.platform,
    arch: process.arch,
  });

  if (config.apiKeys.length === 0) {
    logger.warn(
      '⚠️  Kaseki API authentication is disabled; service will only bind to loopback for trusted local development.',
      { host: config.host, remediation: 'Set KASEKI_API_KEYS before exposing the API on a network interface.' }
    );
  }

  // Log environment info
  logger.event('service_startup_environment', {
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: JSON.stringify(process.memoryUsage()),
    cpuUsage: JSON.stringify(process.cpuUsage()),
  });

  // Bootstrap all services
  const {
    artifactCache,
    webhookManager,
    idempotencyStore,
    preFlightValidator,
    scheduler
  } = await bootstrapServices(config);

  // Run container preflight diagnostics (non-blocking startup checks)
  // Results are cached and accessible via /api/preflight endpoint
  logger.info('Running container preflight diagnostics...');
  const containerPreflight = new ContainerPreflightDiagnostics(config);
  const preflightChecks = containerPreflight.run();
  logContainerPreflightResults(preflightChecks);

  // Create Express app
  const app = express();
  app.use(express.json());

  // Generate OpenAPI specification
  const openApiSpec = generateOpenAPISpec();

  // Mount Swagger UI documentation
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customCss: '.topbar { display: none }',
  }));

  // Mount OpenAPI spec endpoint
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  // Mount web router first so it serves /ui before the API router's catch-all
  // Serve a same-origin task console for operators using the REST API directly.
  app.use(createWebRouter());

  // Mount API routes (mount /api first, then / for backward compatibility)
  const apiRouter = createApiRouter(scheduler, config, idempotencyStore, preFlightValidator, artifactCache);
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // Start server
  const onListening = () => {
    const displayHost = config.host || 'localhost';
    const baseUrl = `http://${displayHost}:${config.port}`;
    logger.event('service_started', {
      port: config.port,
      host: config.host,
      authMode: config.apiKeys.length > 0 ? 'bearer' : 'loopback-unauthenticated',
      logLevel: config.logLevel,
      maxConcurrentRuns: config.maxConcurrentRuns,
      resultsDir: config.resultsDir,
      nodeVersion: process.versions.node,
      swaggerDocumentationUrl: `${baseUrl}/docs`,
      openApiSpecUrl: `${baseUrl}/api/openapi.json`,
    });
  };
  const server = config.host
    ? app.listen(config.port, config.host, onListening)
    : app.listen(config.port, onListening);

  // Graceful shutdown
  const shutdown = () => gracefulShutdown({ server, scheduler, webhookManager, idempotencyStore });

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

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

if (!process.env.JEST_WORKER_ID) {
  void main();
}
