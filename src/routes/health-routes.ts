/**
 * Health-check routes for kaseki-agent API
 *
 * Provides monitoring endpoints:
 * - GET /health - Queue and infrastructure status
 * - GET /ready - Readiness probe for orchestrators
 * - GET /metrics - Prometheus-formatted metrics
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ResultCache } from '../result-cache';
import { metricsRegistry } from '../metrics';

/**
 * Create health-check routes
 */
export function createHealthRoutes(
  scheduler: JobScheduler,
  config: KasekiApiConfig,
  artifactCache: ResultCache
): Router {
  const router = Router();

  /**
   * GET /health - Queue and infrastructure health check
   */
  router.get('/health', (_req: Request, res: Response) => {
    const queueStatus = scheduler.getQueueStatus();
    const errors: string[] = [];

    // Check if results directory is accessible
    if (!fs.existsSync(config.resultsDir)) {
      errors.push(`Results directory not accessible: ${config.resultsDir}`);
    }

    const status = errors.length === 0 ? 'healthy' : 'degraded';

    res.json({
      status,
      timestamp: new Date().toISOString(),
      queue: queueStatus,
      errors: errors.length > 0 ? errors : undefined,
    });
  });

  /**
   * GET /ready - Kubernetes-style readiness probe
   */
  router.get('/ready', (_req: Request, res: Response) => {
    const readiness = scheduler.getReadiness();
    if (readiness.ready) {
      return res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
    }
    return res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      reasons: readiness.reasons,
    });
  });

  /**
   * GET /metrics - Prometheus-formatted metrics
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    const cacheStats = artifactCache.getStats();
    const artifactCacheMetrics = [
      '# HELP kaseki_artifact_cache_entries Number of artifact content cache entries currently held in memory.',
      '# TYPE kaseki_artifact_cache_entries gauge',
      `kaseki_artifact_cache_entries ${cacheStats.entries}`,
      '# HELP kaseki_artifact_cache_bytes Bytes of artifact content currently held in memory.',
      '# TYPE kaseki_artifact_cache_bytes gauge',
      `kaseki_artifact_cache_bytes ${cacheStats.bytes}`,
      '# HELP kaseki_artifact_cache_hits_total Total artifact content cache hits.',
      '# TYPE kaseki_artifact_cache_hits_total counter',
      `kaseki_artifact_cache_hits_total ${cacheStats.hits}`,
      '# HELP kaseki_artifact_cache_misses_total Total artifact content cache misses.',
      '# TYPE kaseki_artifact_cache_misses_total counter',
      `kaseki_artifact_cache_misses_total ${cacheStats.misses}`,
      '# HELP kaseki_artifact_cache_max_entries Configured maximum artifact content cache entries.',
      '# TYPE kaseki_artifact_cache_max_entries gauge',
      `kaseki_artifact_cache_max_entries ${cacheStats.maxEntries}`,
      '# HELP kaseki_artifact_cache_max_file_bytes Configured maximum file size eligible for artifact content caching.',
      '# TYPE kaseki_artifact_cache_max_file_bytes gauge',
      `kaseki_artifact_cache_max_file_bytes ${cacheStats.maxFileBytes}`,
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(`${metricsRegistry.renderPrometheus()}${artifactCacheMetrics}\n`);
  });

  return router;
}
