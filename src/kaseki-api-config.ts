import * as fs from 'fs';

/**
 * Configuration for the Kaseki API service.
 */
export interface KasekiApiConfig {
  port: number;
  apiKeys: string[];
  resultsDir: string;
  logDir: string;
  maxConcurrentRuns: number;
  defaultTaskMode: 'patch' | 'inspect';
  maxDiffBytes: number;
  agentTimeoutSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
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

  const agentTimeoutSeconds = parseInt(process.env.KASEKI_AGENT_TIMEOUT_SECONDS || '1200', 10);
  if (isNaN(agentTimeoutSeconds) || agentTimeoutSeconds < 1) {
    throw new Error(
      `KASEKI_AGENT_TIMEOUT_SECONDS must be >= 1, got: ${process.env.KASEKI_AGENT_TIMEOUT_SECONDS}`
    );
  }

  const maxDiffBytes = parseInt(process.env.KASEKI_MAX_DIFF_BYTES || '200000', 10);
  if (isNaN(maxDiffBytes) || maxDiffBytes < 1) {
    throw new Error(`KASEKI_MAX_DIFF_BYTES must be >= 1, got: ${process.env.KASEKI_MAX_DIFF_BYTES}`);
  }

  const taskMode = (process.env.KASEKI_TASK_MODE || 'patch') as 'patch' | 'inspect';
  if (!['patch', 'inspect'].includes(taskMode)) {
    throw new Error(`KASEKI_TASK_MODE must be 'patch' or 'inspect', got: ${taskMode}`);
  }

  const resultsDir = process.env.KASEKI_RESULTS_DIR || '/agents/kaseki-results';
  if (!fs.existsSync(resultsDir)) {
    throw new Error(`KASEKI_RESULTS_DIR does not exist: ${resultsDir}`);
  }

  const logDir = process.env.KASEKI_API_LOG_DIR || '/var/log/kaseki-api';
  // Create log directory if it doesn't exist
  if (!fs.existsSync(logDir)) {
    try {
      fs.mkdirSync(logDir, { recursive: true, mode: 0o755 });
    } catch (err) {
      console.warn(`Failed to create log directory ${logDir}:`, err);
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
    logDir,
    maxConcurrentRuns,
    defaultTaskMode: taskMode,
    maxDiffBytes,
    agentTimeoutSeconds,
    logLevel,
  };
}

/**
 * Load API keys from environment variable or file.
 */
function loadApiKeys(): string[] {
  // Try KASEKI_API_KEYS_FILE first
  const keysFile = process.env.KASEKI_API_KEYS_FILE;
  if (keysFile) {
    try {
      const content = fs.readFileSync(keysFile, 'utf-8').trim();
      if (content) {
        return content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
      }
      // If file exists but is empty, fall through to env var
    } catch (err) {
      throw new Error(`Failed to read KASEKI_API_KEYS_FILE: ${keysFile}: ${err}`);
    }
  }

  // Fall back to KASEKI_API_KEYS
  const keysEnv = process.env.KASEKI_API_KEYS;
  if (keysEnv) {
    return keysEnv
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key);
  }

  return [];
}

/**
 * Validate that an API key is valid.
 */
export function validateApiKey(config: KasekiApiConfig, token: string): boolean {
  return config.apiKeys.includes(token);
}
