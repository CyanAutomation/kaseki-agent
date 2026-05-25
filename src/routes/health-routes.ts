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
import * as path from 'path';
import { JobScheduler } from '../job-scheduler';
import { KasekiApiConfig } from '../kaseki-api-config';
import { ResultCache } from '../result-cache';
import { metricsRegistry } from '../metrics';

type DependencyCacheMetrics = {
  sizeBytes?: number;
  entryCount?: number;
  maxBytes?: number;
  maxAgeDays?: number;
};

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
    const dependencyCacheStats = readDependencyCacheMetrics(config);
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
      '# HELP kaseki_artifact_cache_evictions_total Total artifact content cache evictions.',
      '# TYPE kaseki_artifact_cache_evictions_total counter',
      `kaseki_artifact_cache_evictions_total ${cacheStats.evictions}`,
      '# HELP kaseki_artifact_cache_max_entries Configured maximum artifact content cache entries.',
      '# TYPE kaseki_artifact_cache_max_entries gauge',
      `kaseki_artifact_cache_max_entries ${cacheStats.maxEntries}`,
      '# HELP kaseki_artifact_cache_max_file_bytes Configured maximum file size eligible for artifact content caching.',
      '# TYPE kaseki_artifact_cache_max_file_bytes gauge',
      `kaseki_artifact_cache_max_file_bytes ${cacheStats.maxFileBytes}`,
      ...renderDependencyCacheMetrics(dependencyCacheStats),
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(`${metricsRegistry.renderPrometheus()}${artifactCacheMetrics}\n`);
  });

  return router;
}

function readDependencyCacheMetrics(config: KasekiApiConfig): DependencyCacheMetrics {
  const metricsFile = config.dependencyCacheMetricsFile;
  const metrics: DependencyCacheMetrics = {
    maxBytes: config.dependencyCacheMaxBytes,
    maxAgeDays: config.dependencyCacheMaxAgeDays,
  };

  if (metricsFile) {
    try {
      const parsed = parseKeyValueFile(fs.readFileSync(metricsFile, 'utf-8'));
      metrics.sizeBytes = parseMetricNumber(parsed.size_bytes);
      metrics.entryCount = parseMetricNumber(parsed.entry_count);
      metrics.maxBytes = parseMetricNumber(parsed.max_bytes) ?? metrics.maxBytes;
      metrics.maxAgeDays = parseMetricNumber(parsed.max_age_days) ?? metrics.maxAgeDays;
    } catch {
      // Worker-maintained metrics are best-effort; fall through to cheap probes.
    }
  }

  if (metrics.entryCount === undefined && config.dependencyCacheDir) {
    metrics.entryCount = countDependencyCacheEntries(config.dependencyCacheDir);
  }

  return metrics;
}

function parseKeyValueFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    values[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return values;
}

function parseMetricNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function countDependencyCacheEntries(cacheDir: string): number | undefined {
  try {
    const npmDir = path.join(cacheDir, 'npm');
    let count = 0;
    for (const lockHash of fs.readdirSync(npmDir)) {
      const lockDir = path.join(npmDir, lockHash);
      for (const nodeDir of fs.readdirSync(lockDir)) {
        const nodeMajorDir = path.join(lockDir, nodeDir);
        for (const flagsDir of fs.readdirSync(nodeMajorDir)) {
          if (flagsDir.startsWith('flags-')) {
            count += 1;
          }
        }
      }
    }
    return count;
  } catch {
    return undefined;
  }
}

function renderDependencyCacheMetrics(metrics: DependencyCacheMetrics): string[] {
  const lines = [
    '# HELP kaseki_dependency_cache_config_max_bytes Configured maximum dependency cache size before worker pruning.',
    '# TYPE kaseki_dependency_cache_config_max_bytes gauge',
    `kaseki_dependency_cache_config_max_bytes ${metrics.maxBytes ?? 0}`,
    '# HELP kaseki_dependency_cache_config_max_age_days Configured maximum dependency cache entry age before worker pruning.',
    '# TYPE kaseki_dependency_cache_config_max_age_days gauge',
    `kaseki_dependency_cache_config_max_age_days ${metrics.maxAgeDays ?? 0}`,
  ];

  if (metrics.sizeBytes !== undefined) {
    lines.push(
      '# HELP kaseki_dependency_cache_bytes Worker-reported dependency cache size in bytes.',
      '# TYPE kaseki_dependency_cache_bytes gauge',
      `kaseki_dependency_cache_bytes ${metrics.sizeBytes}`
    );
  }

  if (metrics.entryCount !== undefined) {
    lines.push(
      '# HELP kaseki_dependency_cache_entries Number of dependency cache entries.',
      '# TYPE kaseki_dependency_cache_entries gauge',
      `kaseki_dependency_cache_entries ${metrics.entryCount}`
    );
  }

  return lines;
}
