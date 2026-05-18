/**
 * SecretResolver - Discovers and resolves secrets from multiple sources
 * Checks config, environment variables, and well-known file locations
 */

import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ConfigManager } from '../../config/ConfigManager';
import { createLogger } from '../../logger';

const logger = createLogger('secret-resolver');

export interface SecretLocation {
  filePath: string;
  source: string;
}

export interface DiscoveredSecrets {
  openrouterKeyFile: SecretLocation | null;
  githubAppIdFile: SecretLocation | null;
  githubAppClientIdFile: SecretLocation | null;
  githubAppPrivateKeyFile: SecretLocation | null;
  kasekiApiKeysFile: SecretLocation | null;
}

export class SecretResolver {
  constructor(private configManager: ConfigManager) {}

  /**
   * Discover all configured secrets from well-known locations
   * Checks in order: config file, environment variables, ~/.kaseki/secrets/, ~/secrets/
   */
  discover(): DiscoveredSecrets {
    const home = os.homedir();

    const resolve = (configKey: string, envVar: string, filename: string): SecretLocation | null => {
      const candidates: Array<{ filePath: string; source: string }> = [
        { filePath: this.configManager.get(configKey, ''), source: `~/.kaseki/config.json (${configKey})` },
        { filePath: process.env[envVar] ?? '', source: `$${envVar}` },
        { filePath: path.join(home, '.kaseki', 'secrets', filename), source: `~/.kaseki/secrets/${filename}` },
        { filePath: path.join(home, 'secrets', filename), source: `~/secrets/${filename}` },
      ];

      for (const c of candidates) {
        if (c.filePath && existsSync(c.filePath)) {
          logger.debug(`Found ${filename} at ${c.source}`);
          return c;
        }
      }

      logger.debug(`${filename} not found in any location`);
      return null;
    };

    return {
      openrouterKeyFile: resolve('auth.openrouter_api_key_file', 'OPENROUTER_API_KEY_FILE', 'openrouter_api_key'),
      githubAppIdFile: resolve('auth.github_app_id_file', 'GITHUB_APP_ID_FILE', 'github_app_id'),
      githubAppClientIdFile: resolve('auth.github_app_client_id_file', 'GITHUB_APP_CLIENT_ID_FILE', 'github_app_client_id'),
      githubAppPrivateKeyFile: resolve('auth.github_app_private_key_file', 'GITHUB_APP_PRIVATE_KEY_FILE', 'github_app_private_key'),
      kasekiApiKeysFile: resolve('api.key_file', 'KASEKI_API_KEYS_FILE', 'kaseki_api_keys'),
    };
  }

  /**
   * Read the first API key from the configured key file
   */
  readApiKey(secrets: DiscoveredSecrets): string | null {
    if (secrets.kasekiApiKeysFile) {
      try {
        const content = readFileSync(secrets.kasekiApiKeysFile.filePath, 'utf-8').trim();
        const firstKey = content.split(/\r?\n/).find((l) => l.trim());
        if (firstKey) {
          logger.debug('Read API key from key file');
          return firstKey;
        }
      } catch (e) {
        logger.warn(`Failed to read API key file: ${(e as Error).message}`);
      }
    }

    // Check environment
    const envKey = process.env.KASEKI_API_KEYS ?? process.env.KASEKI_API_KEY;
    if (envKey) {
      logger.debug('Using API key from environment');
      return envKey;
    }

    logger.debug('No API key found');
    return null;
  }

  /**
   * Print a summary of discovered secrets to console
   */
  printSummary(secrets: DiscoveredSecrets): void {
    const show = (label: string, loc: SecretLocation | null): void => {
      if (loc) {
        console.log(`  ✓ ${label}: ${loc.source}`);
      } else {
        console.log(`  ✗ ${label}: not found`);
      }
    };
    show('OpenRouter key      ', secrets.openrouterKeyFile);
    show('GitHub App ID       ', secrets.githubAppIdFile);
    show('GitHub App Client ID', secrets.githubAppClientIdFile);
    show('GitHub App key      ', secrets.githubAppPrivateKeyFile);
    show('Kaseki API keys     ', secrets.kasekiApiKeysFile);
  }
}
