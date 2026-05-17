/**
 * Host-Based Secrets Reader (Simplified)
 *
 * Reads secrets from two possible locations in order of preference:
 * 1. Docker: /home/pi/secrets/{secretName} (host-mounted into container)
 * 2. Local dev: ~/.kaseki/secrets/{secretName} (single-run, local development)
 *
 * Logs which path is actually being used for transparency.
 * No environment variables, no fallbacks to env vars (hard requirement).
 * Includes stat-based caching for performance.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../logger';

const logger = createLogger('secrets');

interface CacheEntry {
  value: string;
  mtimeMs: number;
  size: number;
}

const secretCache = new Map<string, CacheEntry>();

/**
 * Get the primary secrets directory (Docker Compose or KASEKI_SECRETS_DIR)
 */
const getPrimarySecretsDir = (): string => {
  return process.env.KASEKI_SECRETS_DIR || '/home/pi/secrets';
};

/**
 * Get the fallback secrets directory (single-run, local dev)
 */
const getFallbackSecretsDir = (): string => {
  return path.join(os.homedir(), '.kaseki', 'secrets');
};

/**
 * Read a secret from either Docker or local dev location
 * Returns null if not found
 */
export function readHostSecret(secretName: string): string | null {
  const resolved = resolveHostSecretPath(secretName);
  if (!resolved) {
    return null;
  }
  return readSecretFromPath(resolved);
}

/**
 * Resolve secret path from either location, with logging
 * Returns the path string if found, null if not found in either location
 */
export function resolveHostSecretPath(secretName: string): string | null {
  validateSecretName(secretName);

  const primaryPath = path.join(getPrimarySecretsDir(), secretName);
  const fallbackPath = path.join(getFallbackSecretsDir(), secretName);

  // Try primary (Docker or KASEKI_SECRETS_DIR)
  if (fs.existsSync(primaryPath)) {
    logger.info(`✓ Found ${secretName} at ${primaryPath} (Docker)`);
    return primaryPath;
  }

  // Try fallback (local dev)
  if (fs.existsSync(fallbackPath)) {
    logger.info(`⚠ Found ${secretName} at ${fallbackPath} (local dev, primary ${primaryPath} not found)`);
    return fallbackPath;
  }

  logger.debug(`✗ Secret not found: ${secretName} (tried ${primaryPath} and ${fallbackPath})`);
  return null;
}

/**
 * Read a secret from a specific path with caching and logging.
 * Returns null if file doesn't exist.
 *
 * @param filePath - Full path to secret file
 * @returns Secret value, or null if file doesn't exist
 * @throws Error if file exists but cannot be read
 */
function readSecretFromPath(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    throw new Error(
      `Secret path is a directory: ${describeSecretPath(filePath, stat)}. Replace it with a file containing the secret.`
    );
  }

  if (!stat.isFile()) {
    throw new Error(
      `Secret path is not a regular file: ${describeSecretPath(filePath, stat)}. Replace it with a regular secret file.`
    );
  }

  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new Error(
      `Secret file is not readable: ${describeSecretPath(filePath, stat)}. Fix ownership or permissions so the Kaseki process can read it.`
    );
  }

  const cached = secretCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.value;
  }

  try {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    secretCache.set(filePath, {
      value,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
    return value;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read secret from ${describeSecretPath(filePath, stat)}: ${errorMsg}`
    );
  }
}

function validateSecretName(secretName: string): void {
  if (secretName.includes('/') || secretName.includes('..')) {
    throw new Error('Invalid secret name: ' + secretName);
  }
}

function describeSecretPath(filePath: string, stat: fs.Stats): string {
  const mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
  return filePath + ' (mode ' + mode + ', uid:gid ' + stat.uid + ':' + stat.gid + ')';
}

/**
 * Get expected secret file locations for error messages and validation
 * Returns both primary/secondary (legacy names) and docker/local (new names)
 */
export function getSecretLocations(secretName: string): {
  docker: string;
  local: string;
  primary: string;
  secondary: string;
} {
  const docker = path.join(getPrimarySecretsDir(), secretName);
  const local = path.join(getFallbackSecretsDir(), secretName);
  return {
    docker,
    local,
    primary: docker, // Legacy name for backward compatibility
    secondary: local, // Legacy name for backward compatibility
  };
}

/**
 * Get the resolved secret file path (where it actually was found)
 * Falls back to primary location if not found
 */
export function getSecretFilePath(secretName: string): string {
  validateSecretName(secretName);
  const resolved = resolveHostSecretPath(secretName);
  return resolved || path.join(getPrimarySecretsDir(), secretName);
}
