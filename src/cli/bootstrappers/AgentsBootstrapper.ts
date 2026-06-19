/**
 * AgentsBootstrapper - Creates and initializes the /agents directory structure
 * Handles sudo fallback and sets proper permissions for container access
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { ConfigManager } from '../../config/ConfigManager';
import { createLogger } from '../../logger';

const logger = createLogger('agents-bootstrapper');

const AGENTS_SUBDIRS = ['kaseki-results', 'kaseki-runs', 'kaseki-cache'];
const CONTAINER_UID = 10000;

export interface BootstrapResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export class AgentsBootstrapper {
  // @ts-expect-error - configManager may be used in future extensions
  constructor(private configManager: ConfigManager) {}

  /**
   * Ensure /agents directory structure exists with proper permissions
   */
  async bootstrap(dryRun: boolean = false): Promise<BootstrapResult> {
    // Check if already set up
    const allReady = ['/agents', ...AGENTS_SUBDIRS.map((d) => `/agents/${d}`)].every((p) => existsSync(p));

    if (allReady) {
      logger.debug('/agents already initialized');
      return { ok: true, message: '✓ /agents already set up' };
    }

    if (dryRun) {
      logger.debug('[dry-run] would create /agents');
      return { ok: true, message: '[dry-run] would create /agents with UID 10000 ownership' };
    }

    // Create directory structure
    const dirsToCreate = ['/agents', ...AGENTS_SUBDIRS.map((d) => `/agents/${d}`)];

    for (const dir of dirsToCreate) {
      const result = this.createDirectoryWithSudoFallback(dir);
      if (!result.ok) {
        logger.error(`Failed to create ${dir}: ${result.error}`);
        return result;
      }
    }

    // Set ownership to CONTAINER_UID
    const ownershipResult = this.setOwnershipWithSudoFallback('/agents');
    if (!ownershipResult.ok) {
      logger.error(`Failed to set ownership: ${ownershipResult.error}`);
      return ownershipResult;
    }

    // Set permissions
    const permissionResult = this.setPermissionsWithSudoFallback('/agents');
    if (!permissionResult.ok) {
      logger.error(`Failed to set permissions: ${permissionResult.error}`);
      return permissionResult;
    }

    logger.info('/agents bootstrap completed successfully');
    return { ok: true, message: '✓ /agents created with UID 10000 ownership' };
  }

  /**
   * Write configuration file to ~/.kaseki/config.json
   */
  async writeConfig(
    secrets: {
      llmGatewayKeyFile?: { filePath: string } | null;
      githubAppIdFile?: { filePath: string } | null;
      githubAppClientIdFile?: { filePath: string } | null;
      githubAppPrivateKeyFile?: { filePath: string } | null;
      kasekiApiKeysFile?: { filePath: string } | null;
    }
  ): Promise<void> {
    const kasekiDir = path.join(os.homedir(), '.kaseki');
    await fs.mkdir(kasekiDir, { recursive: true, mode: 0o700 });

    const auth: Record<string, string> = {};
    if (secrets.llmGatewayKeyFile) auth.llm_gateway_api_key_file = secrets.llmGatewayKeyFile.filePath;
    if (secrets.githubAppIdFile) auth.github_app_id_file = secrets.githubAppIdFile.filePath;
    if (secrets.githubAppClientIdFile) auth.github_app_client_id_file = secrets.githubAppClientIdFile.filePath;
    if (secrets.githubAppPrivateKeyFile) auth.github_app_private_key_file = secrets.githubAppPrivateKeyFile.filePath;

    const config = {
      auth,
      api: {
        url: 'http://localhost:8080/api',
        ...(secrets.kasekiApiKeysFile ? { key_file: secrets.kasekiApiKeysFile.filePath } : {}),
      },
    };

    const configPath = path.join(kasekiDir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    logger.info(`Config written to ${configPath}`);
  }

  /**
   * Create directory, falling back to sudo if needed
   */
  private createDirectoryWithSudoFallback(dir: string): BootstrapResult {
    const mkdirResult = spawnSync('mkdir', ['-p', dir], { stdio: 'pipe' });
    if (mkdirResult.status === 0) {
      return { ok: true };
    }

    // Try with sudo
    const sudoResult = spawnSync('sudo', ['mkdir', '-p', dir], { stdio: 'inherit' });
    if (sudoResult.status === 0) {
      return { ok: true };
    }

    return { ok: false, error: `Failed to create directory: ${dir}` };
  }

  /**
   * Set ownership to CONTAINER_UID, falling back to sudo if needed
   */
  private setOwnershipWithSudoFallback(dir: string): BootstrapResult {
    const chownResult = spawnSync('chown', ['-R', `${CONTAINER_UID}:${CONTAINER_UID}`, dir], { stdio: 'pipe' });
    if (chownResult.status === 0) {
      return { ok: true };
    }

    // Try with sudo
    const sudoResult = spawnSync('sudo', ['chown', '-R', `${CONTAINER_UID}:${CONTAINER_UID}`, dir], { stdio: 'inherit' });
    if (sudoResult.status === 0) {
      return { ok: true };
    }

    return { ok: false, error: 'Failed to set ownership on /agents' };
  }

  /**
   * Set directory permissions, falling back to sudo if needed
   */
  private setPermissionsWithSudoFallback(dir: string): BootstrapResult {
    const chmodResult = spawnSync('chmod', ['755', dir], { stdio: 'pipe' });
    if (chmodResult.status === 0) {
      return { ok: true };
    }

    // Try with sudo
    const sudoResult = spawnSync('sudo', ['chmod', '755', dir], { stdio: 'inherit' });
    if (sudoResult.status === 0) {
      return { ok: true };
    }

    return { ok: false, error: 'Failed to set permissions on /agents' };
  }
}
