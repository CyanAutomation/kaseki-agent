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
import { getNpmVersion } from './kaseki-api/npm-version';
import { generateStartupHealthReport } from './kaseki-api/startup-health-reporter';
import { writeStartupHealthArtifacts } from './kaseki-api/startup-summary-artifact';
import { readHostSecret } from './secrets/host-secrets-reader';
import {
  initSentry,
  sentryRequestHandler,
  sentryErrorHandler,
  captureException,
  flushSentry,
} from './sentry-integration';

export { assertSupportedNodeVersion, ensureTemplateInitialized };

/**
 * Set up LLM provider configuration.
 * If gateway URL is configured and provider is not explicitly set,
 * default to 'gateway' provider. This ensures child processes
 * (worker containers) inherit the correct provider configuration.
 */
export function setupLlmProviderEnvironment(env?: NodeJS.ProcessEnv): void {
  const actualEnv = env || process.env;
  if (!actualEnv.KASEKI_PROVIDER && actualEnv.LLM_GATEWAY_URL) {
    actualEnv.KASEKI_PROVIDER = 'gateway';
  }

  const shouldNormalizeGatewayModel =
    actualEnv.KASEKI_PROVIDER === 'gateway' && (!actualEnv.KASEKI_MODEL || actualEnv.KASEKI_MODEL === 'auto');

  if (shouldNormalizeGatewayModel) {
    actualEnv.KASEKI_MODEL = actualEnv.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';
  }
}

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

  // Initialize Sentry for error tracking and monitoring
  initSentry();
  logger.debug('Sentry initialized', {
    enabled: process.env.SENTRY_DSN ? 'true' : 'false',
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
  });

  // Set up LLM provider early so child processes inherit correct configuration
  setupLlmProviderEnvironment();

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

  // Detect npm version (async, with graceful fallback)
  const npmVersion = await getNpmVersion();

  // Determine active LLM provider
  const activeLLMProvider = process.env.KASEKI_PROVIDER || 'gateway';
  const hasOpenRouterFallback = !!(
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY_FILE ||
    readHostSecret('openrouter_api_key')
  );

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
    npmVersion,
    platform: process.platform,
    arch: process.arch,
    activeLLMProvider,
    fallbackProviderAvailable: hasOpenRouterFallback,
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

  // Bootstrap all services with timing measurement
  const bootstrapStartTime = performance.now();
  const {
    artifactCache,
    webhookManager,
    idempotencyStore,
    preFlightValidator,
    scheduler
  } = await bootstrapServices(config);
  const bootstrapDurationMs = performance.now() - bootstrapStartTime;

  // Run container preflight diagnostics (non-blocking startup checks)
  // Results are cached and accessible via /api/preflight endpoint
  logger.info('Running container preflight diagnostics...');
  const preflightStartTime = performance.now();
  const containerPreflight = new ContainerPreflightDiagnostics(config);
  const preflightChecks = containerPreflight.run();
  const preflightDurationMs = performance.now() - preflightStartTime;
  logContainerPreflightResults(preflightChecks);

  // Generate unified startup health report (Phase 4 improvement)
  // Consolidates bootstrap timing, preflight checks, and environment into one report
  try {
    const componentTimings = {
      'ResultCache': 0,  // Would come from bootstrapServices in production
      'WebhookManager': 0,
      'IdempotencyStore': 0,
      'PreFlightValidator': 0,
      'JobScheduler': 0,
    };

    const healthReport = generateStartupHealthReport(
      bootstrapDurationMs,
      preflightDurationMs,
      preflightChecks,
      componentTimings
    );

    // Write health report artifacts (JSON and markdown)
    writeStartupHealthArtifacts(config.resultsDir, healthReport);

    logger.event('health_report_generated', {
      status: healthReport.status,
      passed: healthReport.summary.passed,
      warnings: healthReport.summary.warnings,
      blocking: healthReport.summary.blocking,
      totalMs: healthReport.timing.totalMs,
    });
  } catch (err) {
    logger.warn('Failed to generate startup health report', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Log startup completion with timing summary
  const preflightWarnings = preflightChecks.filter(c => !c.ok).length;
  logger.event('service_startup_complete', {
    bootstrapDurationMs: Math.round(bootstrapDurationMs),
    preflightDurationMs: Math.round(preflightDurationMs),
    preflightWarningsCount: preflightWarnings,
    preflightOkCount: preflightChecks.filter(c => c.ok).length,
  });

  // Create Express app
  const app = express();
  app.use(express.json());

  // Mount Sentry request handler to track incoming requests
  app.use(sentryRequestHandler());

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

  // Mount Sentry error handler to capture errors in routes and middleware
  app.use(sentryErrorHandler());

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
  const shutdown = async () => {
    await gracefulShutdown({ server, scheduler, webhookManager, idempotencyStore });
    // Flush any pending Sentry events before process exit
    await flushSentry(2000);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  // Catch unhandled errors
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    captureException(err, { type: 'uncaughtException' });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', { reason: String(reason) });
    captureException(reason, { type: 'unhandledRejection' });
    process.exit(1);
  });
}

if (!process.env.JEST_WORKER_ID) {
  void main();
}
