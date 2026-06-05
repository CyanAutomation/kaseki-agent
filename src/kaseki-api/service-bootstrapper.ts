import type { Server } from 'http';
import { createEventLogger } from '../logger';
import type { KasekiApiConfig } from '../kaseki-api-config';
import { JobScheduler } from '../job-scheduler';
import { WebhookManager } from '../webhook-manager';
import { IdempotencyStore } from '../idempotency-store';
import { PreFlightValidator } from '../pre-flight-validator';
import { ResultCache } from '../result-cache';

const logger = createEventLogger('service-bootstrapper');

/**
 * All bootstrapped service instances, ready for use
 */
export interface BootstrappedServices {
  artifactCache: ResultCache;
  webhookManager: WebhookManager;
  idempotencyStore: IdempotencyStore;
  preFlightValidator: PreFlightValidator;
  scheduler: JobScheduler;
}

/**
 * Dependencies required for graceful shutdown orchestration
 */
export interface ShutdownDeps {
  server: Server;
  scheduler: Pick<JobScheduler, 'shutdown'>;
  webhookManager: Pick<WebhookManager, 'shutdown'>;
  idempotencyStore: Pick<IdempotencyStore, 'shutdown'>;
  forceExitAfterMs?: number;
  exit?: (code: number) => never;
}

/**
 * Bootstraps all service components with proper dependency injection and initialization order
 *
 * Initialization sequence (order matters for dependencies):
 * 1. ResultCache (standalone, no dependencies)
 * 2. WebhookManager (depends on: resultsDir)
 * 3. IdempotencyStore (depends on: resultsDir)
 * 4. PreFlightValidator (standalone)
 * 5. JobScheduler (depends on: config, webhookManager, artifactCache)
 *
 * @param config - Validated KasekiApiConfig
 * @returns BootstrappedServices object with all initialized services
 * @throws Error with context if any service initialization fails
 */
export async function bootstrapServices(
  config: KasekiApiConfig,
): Promise<BootstrappedServices> {
  const bootstrapStartTime = performance.now();
  logger.info('Starting service bootstrap');

  const cleanupTasks: Array<{ name: string; run: () => void | Promise<void> }> =
    [];

  const componentTimings: { name: string; durationMs: number }[] = [];

  try {
    // 1. Create artifact cache (no dependencies)
    const cacheStartTime = performance.now();
    logger.info('Initializing ResultCache');
    const artifactCache = new ResultCache({
      maxEntries: config.artifactCacheMaxEntries,
      ttlMs: config.artifactCacheTtlMs,
      maxFileBytes: config.artifactCacheMaxFileBytes,
    });
    const cacheDuration = performance.now() - cacheStartTime;
    componentTimings.push({ name: 'ResultCache', durationMs: cacheDuration });
    logger.info(`ResultCache initialized (${cacheDuration.toFixed(1)}ms)`);
    cleanupTasks.push({
      name: 'ResultCache',
      run: () => artifactCache.clearAll(),
    });

    // 2. Create webhook manager (depends on: resultsDir)
    const webhookStartTime = performance.now();
    logger.info('Initializing WebhookManager');
    const webhookManager = new WebhookManager(config.resultsDir);
    const webhookDuration = performance.now() - webhookStartTime;
    componentTimings.push({ name: 'WebhookManager', durationMs: webhookDuration });
    logger.info(`WebhookManager initialized (${webhookDuration.toFixed(1)}ms)`);
    cleanupTasks.push({
      name: 'WebhookManager',
      run: () => webhookManager.shutdown(),
    });

    // 3. Create idempotency store (depends on: resultsDir)
    const idempotencyStartTime = performance.now();
    logger.info('Initializing IdempotencyStore');
    const idempotencyStore = new IdempotencyStore(config.resultsDir, 24);
    const idempotencyDuration = performance.now() - idempotencyStartTime;
    componentTimings.push({ name: 'IdempotencyStore', durationMs: idempotencyDuration });
    logger.info(`IdempotencyStore initialized (${idempotencyDuration.toFixed(1)}ms)`);
    cleanupTasks.push({
      name: 'IdempotencyStore',
      run: () => idempotencyStore.shutdown(),
    });

    // 4. Create pre-flight validator (no dependencies)
    const validatorStartTime = performance.now();
    logger.info('Initializing PreFlightValidator');
    const preFlightValidator = new PreFlightValidator();
    const validatorDuration = performance.now() - validatorStartTime;
    componentTimings.push({ name: 'PreFlightValidator', durationMs: validatorDuration });
    logger.info(`PreFlightValidator initialized (${validatorDuration.toFixed(1)}ms)`);

    // 5. Create scheduler (depends on: config, webhookManager, artifactCache)
    const schedulerStartTime = performance.now();
    logger.info('Initializing JobScheduler');
    const scheduler = new JobScheduler(config, webhookManager, artifactCache);
    await scheduler.ready();
    const schedulerDuration = performance.now() - schedulerStartTime;
    componentTimings.push({ name: 'JobScheduler', durationMs: schedulerDuration });
    logger.info(`JobScheduler initialized (${schedulerDuration.toFixed(1)}ms)`);

    // Detect slow components and warn
    const slowComponentThreshold = 1000; // 1 second
    const slowComponents = componentTimings.filter(c => c.durationMs > slowComponentThreshold);
    if (slowComponents.length > 0) {
      logger.warn('Slow component initialization detected during bootstrap:', {
        slowComponents: slowComponents.map(c => `${c.name} (${c.durationMs.toFixed(1)}ms)`),
      });
    }

    const totalBootstrapDuration = performance.now() - bootstrapStartTime;
    logger.info('Service bootstrap complete', {
      totalDurationMs: totalBootstrapDuration.toFixed(1),
      componentCount: componentTimings.length,
      components: componentTimings,
    });

    return {
      artifactCache,
      webhookManager,
      idempotencyStore,
      preFlightValidator,
      scheduler,
    };
  } catch (err) {
    for (const task of cleanupTasks.reverse()) {
      try {
        await task.run();
        logger.info(`Cleaned up ${task.name} after bootstrap failure`);
      } catch (cleanupErr) {
        logger.error('Failed bootstrap cleanup task', {
          service: task.name,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr),
        });
      }
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    const totalBootstrapDuration = performance.now() - bootstrapStartTime;
    logger.error('Failed to bootstrap services', {
      error: errorMessage,
      durationMs: totalBootstrapDuration.toFixed(1),
    });
    throw new Error(`Service bootstrap failed: ${errorMessage}`, {
      cause: err,
    });
  }
}

/**
 * Orchestrates graceful shutdown of all services and the HTTP server
 *
 * Shutdown sequence:
 * 1. Close HTTP server (stop accepting new connections)
 * 2. Shutdown scheduler (cancel running jobs)
 * 3. Shutdown webhook manager (flush pending webhooks)
 * 4. Shutdown idempotency store (finalize persistence)
 * 5. Exit process
 *
 * Hard timeout (8000ms default) ensures process exits even if services hang
 *
 * @param deps - ShutdownDeps with server and all service instances
 * @throws Error if shutdown sequence fails (but still attempts exit)
 */
export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  const {
    server,
    scheduler,
    webhookManager,
    idempotencyStore,
    forceExitAfterMs = 8000,
    exit = process.exit,
  } = deps;

  logger.info('Starting graceful shutdown', { timeoutMs: forceExitAfterMs });

  const hardTimeout = setTimeout(() => {
    logger.error(
      `Graceful shutdown timeout after ${forceExitAfterMs}ms, forcing exit`,
    );
    exit(1);
  }, forceExitAfterMs);

  try {
    // 1. Close HTTP server
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

    // 2. Shutdown scheduler
    scheduler.shutdown();
    logger.info('Job scheduler shutdown');

    // 3. Shutdown webhook manager
    await webhookManager.shutdown();
    logger.info('Webhook manager shutdown');

    // 4. Shutdown idempotency store
    idempotencyStore.shutdown();
    logger.info('Idempotency store shutdown');

    logger.info('Graceful shutdown complete');
    exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown', { error: String(err) });
    exit(1);
  } finally {
    clearTimeout(hardTimeout);
  }
}
