/**
 * Host-Based Secrets Reader
 *
 * Reads secrets from a single host filesystem location:
 *   $KASEKI_SECRETS_DIR/{secretName}  (default: /agents/secrets/{secretName})
 *
 * No fallback to environment variables (hard requirement).
 * Includes stat-based caching for performance.
 */

import * as fs from 'fs';
import * as path from 'path';

interface CacheEntry {
  value: string;
  mtimeMs: number;
  size: number;
}

const secretCache = new Map<string, CacheEntry>();

/**
 * Location for secrets on host
 */
const getPrimarySecretsDir = (): string => {
  return process.env.KASEKI_SECRETS_DIR || '/agents/secrets';
};

/**
 * Read a secret value from host filesystem.
 *
 * @param secretName - Name of the secret (e.g., "openrouter_api_key")
 * @returns Secret value as string, or null if not found
 * @throws Error if file exists but cannot be read (permissions, etc.)
 */
export function readHostSecret(secretName: string): string | null {
  const secretPath = resolveHostSecretPath(secretName);
  if (!secretPath) {
    return null;
  }

  return readSecretFromPath(secretPath);
}

export function resolveHostSecretPath(secretName: string): string | null {
  validateSecretName(secretName);

  const primaryPath = path.join(getPrimarySecretsDir(), secretName);

  if (fs.existsSync(primaryPath)) {
    return primaryPath;
  }

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
 * Get the expected secret file path for debugging/error messages.
 *
 * @param secretName - Name of the secret
 * @returns Object with primary path
 */
export function getSecretLocations(secretName: string): {
  primary: string; secondary: string;
} {
  return {
    primary: path.join(getPrimarySecretsDir(), secretName),
    secondary: path.join('/etc/kaseki/secrets', secretName),
  };
}

export function getSecretFilePath(secretName: string): string {
  validateSecretName(secretName);
  return resolveHostSecretPath(secretName) || path.join(getPrimarySecretsDir(), secretName);
}
