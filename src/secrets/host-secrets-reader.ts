/**
 * Host-Based Secrets Reader
 *
 * Reads secrets from host filesystem with multi-path resolution:
 * 1. Discovered path: From .kaseki-host-state.json (set by setup)
 * 2. Primary path: $KASEKI_SECRETS_DIR/{secretName} or /agents/secrets/{secretName}
 * 3. Fallback path: ~/secrets/{secretName}
 *
 * No fallback to environment variables (hard requirement).
 * Includes stat-based caching for performance.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../logger';

const logger = createLogger('host-secrets');

interface CacheEntry {
  value: string;
  mtimeMs: number;
  size: number;
}

/**
 * Cache for secret file reads with stat-based invalidation
 */
const secretCache = new Map<string, CacheEntry>();

/**
 * Primary location for secrets on host
 */
const getPrimarySecretsDir = (): string => {
  return process.env.KASEKI_SECRETS_DIR || '/agents/secrets';
};

/**
 * Fallback location for secrets (user home directory)
 */
const getSecondarySecretsDir = (): string => {
  const homeDir = os.homedir();
  return path.join(homeDir, 'secrets');
};

/**
 * Read a secret value from host filesystem.
 * Tries primary location first, then fallback.
 *
 * @param secretName - Name of the secret (e.g., "openrouter_api_key")
 * @returns Secret value as string, or null if not found at either location
 * @throws Error if file exists but cannot be read (permissions, etc.)
 */
export function readHostSecret(secretName: string): string | null {
  // Validate secret name to prevent path traversal
  if (secretName.includes('/') || secretName.includes('..')) {
    throw new Error(`Invalid secret name: ${secretName}`);
  }

  const primarySecretsDir = getPrimarySecretsDir();
  const primaryPath = path.join(primarySecretsDir, secretName);
  const secondaryPath = path.join(getSecondarySecretsDir(), secretName);

  // Try primary location first
  const primaryValue = readSecretFromPath(primaryPath);
  if (primaryValue !== null) {
    return primaryValue;
  }

  // Fall back to secondary location
  const secondaryValue = readSecretFromPath(secondaryPath);
  if (secondaryValue !== null) {
    // Warn if /agents/secrets exists but we're using a different path
    const agentsSecretsPath = path.join('/agents/secrets', secretName);
    if (primarySecretsDir !== '/agents/secrets' && fs.existsSync(agentsSecretsPath)) {
      logger.warn(
        `Secret found at ${secondaryPath} but /agents/secrets also exists. ` +
        `If you intended to use /agents/secrets, run: sudo kaseki-agent host setup --fix`
      );
    }
    return secondaryValue;
  }

  // Neither location has the secret
  return null;
}

/**
 * Read a secret from a specific path with caching.
 * Returns null if file doesn't exist.
 *
 * @param filePath - Full path to secret file
 * @returns Secret value, or null if file doesn't exist
 * @throws Error if file exists but cannot be read
 */
function readSecretFromPath(filePath: string): string | null {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    // Get file stats for cache validation
    const stat = fs.statSync(filePath);

    // Check if cached value is still valid
    const cached = secretCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value;
    }

    // Read file content
    const value = fs.readFileSync(filePath, 'utf8').trim();

    // Cache the value
    secretCache.set(filePath, {
      value,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });

    return value;
  } catch (error) {
    // File exists but cannot be read
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read secret from ${filePath}: ${errorMsg}`
    );
  }
}

/**
 * Get secret locations for debugging/error messages.
 *
 * @param secretName - Name of the secret
 * @returns Object with primary and secondary paths
 */
export function getSecretLocations(secretName: string): {
  primary: string;
  secondary: string;
} {
  return {
    primary: path.join(getPrimarySecretsDir(), secretName),
    secondary: path.join(getSecondarySecretsDir(), secretName),
  };
}
