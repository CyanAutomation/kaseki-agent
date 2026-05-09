import * as fs from 'fs';
import { secretValueCache } from './secret-value-cache';

/**
 * Configuration for the Kaseki API service.
 */
export const DEFAULT_JOB_INDEX_MAX_ENTRIES = 1000;
// Artifact cache constants moved to private scope (no longer exported as they are only used internally)
const DEFAULT_ARTIFACT_CACHE_MAX_ENTRIES = 20;
const DEFAULT_ARTIFACT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ARTIFACT_CACHE_MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface KasekiApiConfig {
  port: number;
  apiKeys: string[];
  resultsDir: string;
  maxConcurrentRuns: number;
  defaultTaskMode: 'patch' | 'inspect';
  maxDiffBytes: number;
  agentTimeoutSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /**
   * Maximum number of terminal jobs retained in the API jobs index.
   * Active queued/running jobs are always retained in addition to this cap.
   */
  jobIndexMaxEntries?: number;
  /** Maximum number of artifact content files cached in memory. Set to 0 to disable caching. */
  artifactCacheMaxEntries?: number;
  /** Artifact content cache time-to-live in milliseconds. */
  artifactCacheTtlMs?: number;
  /** Maximum artifact file size eligible for content caching, in bytes. */
  artifactCacheMaxFileBytes?: number;
}

/**
 * Load and validate configuration from environment variables.
 */
export function loadConfig(): KasekiApiConfig {
  const apiKeys = loadApiKeys();
  if (!apiKeys || apiKeys.length === 0) {
    throw new Error(
      'KASEKI_API_KEYS environment variable is required. ' +
        'Set it to a comma-separated list of API keys, or KASEKI_API_KEYS_FILE pointing to a file.'
    );
  }

  const port = parseInt(process.env.KASEKI_API_PORT || '8080', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`KASEKI_API_PORT must be a valid port number, got: ${process.env.KASEKI_API_PORT}`);
  }

  const maxConcurrentRuns = parseInt(process.env.KASEKI_API_MAX_CONCURRENT_RUNS || '3', 10);
  if (isNaN(maxConcurrentRuns) || maxConcurrentRuns < 1) {
    throw new Error(`KASEKI_API_MAX_CONCURRENT_RUNS must be >= 1, got: ${process.env.KASEKI_API_MAX_CONCURRENT_RUNS}`);
  }

  const agentTimeoutSeconds = parseInt(process.env.KASEKI_AGENT_TIMEOUT_SECONDS || '5700', 10);
  if (isNaN(agentTimeoutSeconds) || agentTimeoutSeconds < 1) {
    throw new Error(
      `KASEKI_AGENT_TIMEOUT_SECONDS must be >= 1, got: ${process.env.KASEKI_AGENT_TIMEOUT_SECONDS}`
    );
  }

  const maxDiffBytes = parseInt(process.env.KASEKI_MAX_DIFF_BYTES || '200000', 10);
  if (isNaN(maxDiffBytes) || maxDiffBytes < 1) {
    throw new Error(`KASEKI_MAX_DIFF_BYTES must be >= 1, got: ${process.env.KASEKI_MAX_DIFF_BYTES}`);
  }

  const jobIndexMaxEntries = parseInt(
    process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES || String(DEFAULT_JOB_INDEX_MAX_ENTRIES),
    10
  );
  if (isNaN(jobIndexMaxEntries) || jobIndexMaxEntries < 0) {
    throw new Error(
      `KASEKI_API_JOB_INDEX_MAX_ENTRIES must be >= 0, got: ${process.env.KASEKI_API_JOB_INDEX_MAX_ENTRIES}`
    );
  }

  const artifactCacheMaxEntries = parseInt(
    process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES || String(DEFAULT_ARTIFACT_CACHE_MAX_ENTRIES),
    10
  );
  if (isNaN(artifactCacheMaxEntries) || artifactCacheMaxEntries < 0) {
    throw new Error(
      `KASEKI_ARTIFACT_CACHE_MAX_ENTRIES must be >= 0, got: ${process.env.KASEKI_ARTIFACT_CACHE_MAX_ENTRIES}`
    );
  }

  const artifactCacheTtlMs = parseInt(
    process.env.KASEKI_ARTIFACT_CACHE_TTL_MS || String(DEFAULT_ARTIFACT_CACHE_TTL_MS),
    10
  );
  if (isNaN(artifactCacheTtlMs) || artifactCacheTtlMs < 0) {
    throw new Error(
      `KASEKI_ARTIFACT_CACHE_TTL_MS must be >= 0, got: ${process.env.KASEKI_ARTIFACT_CACHE_TTL_MS}`
    );
  }

  const artifactCacheMaxFileBytes = parseInt(
    process.env.KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES || String(DEFAULT_ARTIFACT_CACHE_MAX_FILE_BYTES),
    10
  );
  if (isNaN(artifactCacheMaxFileBytes) || artifactCacheMaxFileBytes < 0) {
    throw new Error(
      `KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES must be >= 0, got: ${process.env.KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES}`
    );
  }

  const taskMode = (process.env.KASEKI_TASK_MODE || 'patch') as 'patch' | 'inspect';
  if (!['patch', 'inspect'].includes(taskMode)) {
    throw new Error(`KASEKI_TASK_MODE must be 'patch' or 'inspect', got: ${taskMode}`);
  }

  const resultsDir = process.env.KASEKI_RESULTS_DIR || '/agents/kaseki-results';
  try {
    fs.mkdirSync(resultsDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create KASEKI_RESULTS_DIR at ${resultsDir}: ${err instanceof Error ? err.message : String(err)}. ` +
      'Check host volume mount (-v /agents:/agents:rw) and ensure directory is writable.'
    );
  }

  // Best-effort chmod to ensure directory is writable by container user (uid 1000)
  // Mode 777 allows the container (uid 1000) to write to results even if owned by root
  try {
    fs.chmodSync(resultsDir, 0o777);
  } catch (err) {
    // chmod might fail on special filesystems (e.g., /tmp) or read-only mounts
    // This is not fatal since mkdir succeeded; log warning but continue
    if (process.env.KASEKI_API_LOG_LEVEL === 'debug') {
      console.warn(
        `[config] Warning: Could not chmod KASEKI_RESULTS_DIR ${resultsDir} to 777: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          'This may cause permission issues if the directory is owned by root.'
      );
    }
  }

  const logLevel = (process.env.KASEKI_API_LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`KASEKI_API_LOG_LEVEL must be debug/info/warn/error, got: ${logLevel}`);
  }

  return {
    port,
    apiKeys,
    resultsDir,
    maxConcurrentRuns,
    defaultTaskMode: taskMode,
    maxDiffBytes,
    agentTimeoutSeconds,
    logLevel,
    jobIndexMaxEntries,
    artifactCacheMaxEntries,
    artifactCacheTtlMs,
    artifactCacheMaxFileBytes,
  };
}

/**
 * Load API keys from environment variable or file.
 */
function loadApiKeys(): string[] {
  const keysEnv = process.env.KASEKI_API_KEYS;
  if (keysEnv) {
    return keysEnv
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key);
  }

  const keysFile = process.env.KASEKI_API_KEYS_FILE;
  if (keysFile) {
    try {
      const content = secretValueCache.readFile(keysFile).trim();
      if (content) {
        return content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
      }
    } catch (err) {
      throw new Error(`Failed to read KASEKI_API_KEYS_FILE: ${keysFile}: ${err}`);
    }
  }

  return [];
}

/**
 * Validate that an API key is valid.
 */
export function validateApiKey(config: KasekiApiConfig, token: string): boolean {
  return config.apiKeys.includes(token);
}
