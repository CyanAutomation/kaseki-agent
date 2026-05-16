import { spawnSync } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Discover the secrets path from previous setup state file.
 * Returns null if state file doesn't exist or is invalid.
 */
function discoverSecretsPathFromPreviousSetup(env: NodeJS.ProcessEnv): string | null {
  const sudoHome = getSudoUserHome(env);
  if (!sudoHome) {
    return null;
  }

  const stateFilePath = path.join(sudoHome, '.kaseki-host-state.json');

  try {
    if (!fs.existsSync(stateFilePath)) {
      return null;
    }

    const content = fs.readFileSync(stateFilePath, 'utf8');
    const state = JSON.parse(content);

    if (typeof state.normalized_secrets_dir === 'string') {
      // Verify the directory exists and is accessible
      if (fs.existsSync(state.normalized_secrets_dir)) {
        return state.normalized_secrets_dir;
      }
    }
  } catch {
    // State file doesn't exist, is malformed, or path is inaccessible
  }

  return null;
}

export function configureHostSecretsDirForPreflight(env: NodeJS.ProcessEnv = process.env): void {
  if (env.KASEKI_SECRETS_DIR) {
    return;
  }

  if (env.KASEKI_HOST_SECRETS_DIR) {
    env.KASEKI_SECRETS_DIR = env.KASEKI_HOST_SECRETS_DIR;
    return;
  }

  // New: Check for discovered path from setup state file
  const discoveredPath = discoverSecretsPathFromPreviousSetup(env);
  if (discoveredPath) {
    env.KASEKI_SECRETS_DIR = discoveredPath;
    return;
  }

  const sudoHome = getSudoUserHome(env);
  if (sudoHome) {
    env.KASEKI_SECRETS_DIR = resolve(sudoHome, 'secrets');
  }
}

/**
 * Export the discovered path for diagnostics/logging purposes
 */
export function getDiscoveredSecretsPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return discoverSecretsPathFromPreviousSetup(env);
}

function getSudoUserHome(env: NodeJS.ProcessEnv): string | null {
  const sudoUser = env.SUDO_USER;
  if (!sudoUser || sudoUser === 'root' || !/^[a-z_][a-z0-9_-]*\$?$/.test(sudoUser)) {
    return null;
  }

  const getent = spawnSync('getent', ['passwd', sudoUser], {
    encoding: 'utf8',
  });
  if (getent.error) {
    // getent command not found or failed to execute
    return `/home/${sudoUser}`;
  }
  if (getent.status === 0 && getent.stdout) {
    const home = getent.stdout.trim().split(':')[5];
    if (home) {
      return home;
    }
  }

  return `/home/${sudoUser}`;
}
