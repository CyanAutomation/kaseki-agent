import * as fs from 'fs';
import { readHostSecret } from './secrets/host-secrets-reader';

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
  /** Optional HTTP bind host. Omitted values keep Node's default all-interface binding. */
  host?: string;
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
 * Validate and parse port number from environment variable.
 * @throws Error if port is invalid (not 1-65535)
 */
function validatePort(envVar: string = 'KASEKI_API_PORT', defaultPort: number = 8080): number {
  const port = parseInt(process.env[envVar] || String(defaultPort), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`${envVar} must be a valid port number, got: ${process.env[envVar]}`);
  }
  return port;
}

/**
 * Determine whether a bind host is limited to the local machine.
 */
function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

/**
 * Validate and parse API bind host.
 * Unauthenticated local development mode must stay bound to loopback.
 */
function validateApiHost(apiKeys: string[]): string | undefined {
  const rawHost = process.env.KASEKI_API_HOST?.trim();

  if (!rawHost) {
    return apiKeys.length === 0 ? '127.0.0.1' : undefined;
  }

  if (apiKeys.length === 0 && !isLoopbackHost(rawHost)) {
    throw new Error(
      'KASEKI_API_HOST must be localhost, 127.0.0.1, or ::1 when KASEKI_API_KEYS is empty. ' +
      'Configure KASEKI_API_KEYS before binding the unauthenticated API to a network interface.'
    );
  }

  return rawHost;
}

/**
 * Validate and parse positive integer (>= min) from environment variable.
 * @throws Error if value is invalid
 */
function validatePositiveInt(
  envVar: string,
  defaultValue: number,
  minValue: number = 1,
  description: string = envVar
): number {
  const value = parseInt(process.env[envVar] || String(defaultValue), 10);
  if (isNaN(value) || value < minValue) {
    throw new Error(`${description} must be >= ${minValue}, got: ${process.env[envVar]}`);
  }
  return value;
}

/**
 * Validate and parse task mode enum.
 * @throws Error if mode is not 'patch' or 'inspect'
 */
function validateTaskMode(): 'patch' | 'inspect' {
  const taskMode = (process.env.KASEKI_TASK_MODE || 'patch') as 'patch' | 'inspect';
  if (!['patch', 'inspect'].includes(taskMode)) {
    throw new Error(`KASEKI_TASK_MODE must be 'patch' or 'inspect', got: ${taskMode}`);
  }
  return taskMode;
}

/**
 * Validate and parse log level enum.
 * @throws Error if level is not debug/info/warn/error
 */
function validateLogLevel(): 'debug' | 'info' | 'warn' | 'error' {
  const logLevel = (process.env.KASEKI_API_LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`KASEKI_API_LOG_LEVEL must be debug/info/warn/error, got: ${logLevel}`);
  }
  return logLevel;
}

/**
 * Ensure results directory exists and is writable.
 * @throws Error if directory cannot be created
 */
function ensureResultsDir(): string {
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

  return resultsDir;
}

/**
 * Load and validate artifact cache configuration.
 */
function loadArtifactCacheConfig(): {
  maxEntries: number;
  ttlMs: number;
  maxFileBytes: number;
  } {
  const maxEntries = validatePositiveInt(
    'KASEKI_ARTIFACT_CACHE_MAX_ENTRIES',
    DEFAULT_ARTIFACT_CACHE_MAX_ENTRIES,
    0,
    'KASEKI_ARTIFACT_CACHE_MAX_ENTRIES'
  );

  const ttlMs = validatePositiveInt(
    'KASEKI_ARTIFACT_CACHE_TTL_MS',
    DEFAULT_ARTIFACT_CACHE_TTL_MS,
    0,
    'KASEKI_ARTIFACT_CACHE_TTL_MS'
  );

  const maxFileBytes = validatePositiveInt(
    'KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES',
    DEFAULT_ARTIFACT_CACHE_MAX_FILE_BYTES,
    0,
    'KASEKI_ARTIFACT_CACHE_MAX_FILE_BYTES'
  );

  return { maxEntries, ttlMs, maxFileBytes };
}

/**
 * Load and validate configuration from environment variables.
 */
export function loadConfig(): KasekiApiConfig {
  const apiKeys = loadApiKeys();

  const port = validatePort('KASEKI_API_PORT', 8080);
  const host = validateApiHost(apiKeys);
  const maxConcurrentRuns = validatePositiveInt('KASEKI_API_MAX_CONCURRENT_RUNS', 3, 1, 'KASEKI_API_MAX_CONCURRENT_RUNS');
  const agentTimeoutSeconds = validatePositiveInt('KASEKI_AGENT_TIMEOUT_SECONDS', 10800, 1, 'KASEKI_AGENT_TIMEOUT_SECONDS');
  const maxDiffBytes = validatePositiveInt('KASEKI_MAX_DIFF_BYTES', 400000, 1, 'KASEKI_MAX_DIFF_BYTES');
  const jobIndexMaxEntries = validatePositiveInt(
    'KASEKI_API_JOB_INDEX_MAX_ENTRIES',
    DEFAULT_JOB_INDEX_MAX_ENTRIES,
    0,
    'KASEKI_API_JOB_INDEX_MAX_ENTRIES'
  );

  const { maxEntries: artifactCacheMaxEntries, ttlMs: artifactCacheTtlMs, maxFileBytes: artifactCacheMaxFileBytes } =
    loadArtifactCacheConfig();

  const taskMode = validateTaskMode();
  const resultsDir = ensureResultsDir();
  const logLevel = validateLogLevel();

  return {
    port,
    host,
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
 * Load API keys from KASEKI_API_KEYS or host-based secret files.
 * Host secrets are read from /run/secrets/kaseki/kaseki_api_keys or ~/.kaseki/secrets/kaseki_api_keys.
 * Returns an empty list for trusted unauthenticated local mode.
 */
function parseApiKeys(keysValue: string): string[] {
  return keysValue
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function loadApiKeys(): string[] {
  if (process.env.KASEKI_API_KEYS !== undefined) {
    return parseApiKeys(process.env.KASEKI_API_KEYS);
  }

  const keysValue = readHostSecret('kaseki_api_keys');
  if (!keysValue) {
    return [];
  }

  return parseApiKeys(keysValue);
}

/**
 * Validate that an API key is valid.
 */
export function validateApiKey(config: KasekiApiConfig, token: string): boolean {
  return config.apiKeys.includes(token);
}
