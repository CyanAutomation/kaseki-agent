/**
 * NPM Version Detection
 *
 * Detects the npm version installed in the container.
 * Falls back gracefully to 'unknown' if detection fails.
 *
 * @returns npm version string (e.g., "10.2.4") or "unknown" on failure
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from 'child_process';

/**
 * Get the installed npm version
 *
 * Uses process.versions.npm first (fast, no subprocess),
 * falls back to `npm --version` command if that's unavailable,
 * and gracefully returns 'unknown' if both fail.
 *
 * @returns Promise<string> - npm version or 'unknown'
 */
type NpmVersionExecSync = (
  command: string,
  options: ExecSyncOptionsWithStringEncoding
) => string;

interface GetNpmVersionOptions {
  npmVersion?: string;
  execSync?: NpmVersionExecSync;
}

export async function getNpmVersion(
  options: GetNpmVersionOptions = {}
): Promise<string> {
  // Try process.versions.npm first (should be available in Node.js with npm)
  // This is fast and requires no subprocess
  const npmVersion =
    options.npmVersion !== undefined ? options.npmVersion : process.versions.npm;

  if (npmVersion) {
    return npmVersion;
  }

  // Fallback: try `npm --version` command
  const execNpmVersion = options.execSync ?? execSync;

  try {
    const version = execNpmVersion('npm --version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();

    // Validate it looks like a version (basic sanity check)
    if (version && /^\d+\.\d+\.\d+/.test(version)) {
      return version;
    }
  } catch {
    // npm command failed or timed out; silently fall through
  }

  // Graceful fallback: don't break startup, just indicate version is unknown
  return 'unknown';
}
