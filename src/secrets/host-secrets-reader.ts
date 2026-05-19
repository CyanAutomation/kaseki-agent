/**
 * Host-Based Secrets Reader (Simplified)
 *
 * Reads secrets from possible locations in order of preference:
 * 1. GitHub App secrets: /run/secrets/{secretName} (root level, matches run-kaseki.sh mounts)
 * 2. Other secrets: /run/secrets/kaseki/{secretName} (host-mounted into container)
 * 3. Local dev: ~/.kaseki/secrets/{secretName} (single-run, local development)
 *
 * GitHub App secrets (github_app_id, github_app_client_id, github_app_private_key) are
 * mounted at root level /run/secrets/ to align with run-kaseki.sh controller mounts.
 * This ensures the job scheduler passes correct paths to worker containers.
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
  return process.env.KASEKI_SECRETS_DIR || '/run/secrets/kaseki';
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
 * Check if a secret is a GitHub App secret (mounted at root level)
 */
function isGitHubAppSecret(secretName: string): boolean {
  return ['github_app_id', 'github_app_client_id', 'github_app_private_key'].includes(secretName);
}

/**
 * Resolve secret path from locations in priority order, with logging
 * Returns the path string if found, null if not found in any location
 *
 * For GitHub App secrets: tries /run/secrets/{name} first (root level, matches run-kaseki.sh)
 * For other secrets: tries /run/secrets/kaseki/{name} first (API service mount)
 * Falls back to local dev directory for both types
 */
export function resolveHostSecretPath(secretName: string): string | null {
  validateSecretName(secretName);

  const isGitHub = isGitHubAppSecret(secretName);
  
  if (isGitHub) {
    // GitHub App secrets: check root level first (matches run-kaseki.sh controller mounts)
    const rootPath = path.join('/run/secrets', secretName);
    const kasekiSubdirPath = path.join(getPrimarySecretsDir(), secretName);
    const fallbackPath = path.join(getFallbackSecretsDir(), secretName);

    // Try root level first (where run-kaseki.sh mounts them)
    if (fs.existsSync(rootPath)) {
      logger.info(`✓ Found ${secretName} at ${rootPath} (root level)`);
      return rootPath;
    }

    // Try kaseki subdirectory (legacy API service path for compatibility)
    if (fs.existsSync(kasekiSubdirPath)) {
      logger.info(`⚠ Found ${secretName} at ${kasekiSubdirPath} (kaseki subdir, root level ${rootPath} not found)`);
      return kasekiSubdirPath;
    }

    // Try fallback (local dev)
    if (fs.existsSync(fallbackPath)) {
      logger.info(`⚠ Found ${secretName} at ${fallbackPath} (local dev)`);
      return fallbackPath;
    }

    logger.debug(`✗ Secret not found: ${secretName} (tried ${rootPath}, ${kasekiSubdirPath}, and ${fallbackPath})`);
    return null;
  } else {
    // Other secrets: check kaseki subdir first
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
