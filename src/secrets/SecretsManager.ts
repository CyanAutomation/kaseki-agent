/**
 * Secrets Manager (Simplified)
 *
 * Secure credential storage - filesystem only
 * - Primary: /home/pi/secrets/{secretName} (Docker Compose)
 * - Fallback: ~/.kaseki/secrets/{secretName} (Single-run / local dev)
 *
 * No keyring, no env vars. Explicit paths only.
 * See scripts/setup-secrets.sh for automatic permission setup.
 *
 * Note: Secret format validation is in secrets-schema.ts (setup-time only).
 * Runtime retrieval does not validate; only stores/retrieves from secure filesystem paths.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createLogger } from '../logger';

const logger = createLogger('secrets');

/**
 * Simplified Secrets Manager - filesystem-only implementation
 *
 * Two fallback paths:
 * 1. Primary: /run/secrets/kaseki/{secretName} (Docker Compose)
 * 2. Fallback: ~/.kaseki/secrets/{secretName} (Single-run, local dev)
 */
export class SecretsManager {
  /**
   * Get the primary secrets directory (Docker Compose)
   */
  private getPrimarySecretsDir(): string {
    return process.env.KASEKI_SECRETS_DIR || '/run/secrets/kaseki';
  }

  /**
   * Get the fallback secrets directory (local dev)
   */
  private getFallbackSecretsDir(): string {
    return path.join(os.homedir(), '.kaseki', 'secrets');
  }

  /**
   * Store a secret in the fallback location (~/.kaseki/secrets)
   * Used for local development and single-run execution
   */
  async store(key: string, value: string): Promise<void> {
    const baseDir = this.getFallbackSecretsDir();

    try {
      // Create directory with restrictive permissions (700 - owner only)
      await fs.mkdir(baseDir, { recursive: true, mode: 0o700 });
      const filePath = path.join(baseDir, key);

      // Write with restrictive permissions (600 - owner read/write only)
      await fs.writeFile(filePath, value, {
        mode: 0o600,
        flag: 'w',
      });

      logger.info(`✓ Stored ${key} at ${filePath}`);
    } catch (error) {
      throw new Error(`Failed to store secret in ${baseDir}: ${error}`);
    }
  }

  /**
   * Retrieve a secret from either location (primary or fallback)
   * Logs which path was used for transparency
   */
  async retrieve(key: string): Promise<string | null> {
    const primaryDir = this.getPrimarySecretsDir();
    const fallbackDir = this.getFallbackSecretsDir();
    const primaryPath = path.join(primaryDir, key);
    const fallbackPath = path.join(fallbackDir, key);

    // Try primary location first
    try {
      const stat = await fs.stat(primaryPath);
      if (stat.isFile()) {
        const value = await fs.readFile(primaryPath, 'utf-8');
        logger.info(`✓ Loaded ${key} from ${primaryPath}`);
        return value.trim();
      }
    } catch {
      // File not found at primary location, try fallback
    }

    // Try fallback location
    try {
      const stat = await fs.stat(fallbackPath);
      if (stat.isFile()) {
        const value = await fs.readFile(fallbackPath, 'utf-8');
        logger.info(`⚠ Fallback: Loading ${key} from ${fallbackPath} (primary ${primaryDir} not found)`);
        return value.trim();
      }
    } catch {
      // File not found at fallback location either
    }

    logger.debug(`Secret not found: ${key} (tried ${primaryPath} and ${fallbackPath})`);
    return null;
  }

  /**
   * Delete a secret from the fallback location
   */
  async delete(key: string): Promise<void> {
    const filePath = path.join(this.getFallbackSecretsDir(), key);

    try {
      await fs.unlink(filePath);
      logger.info(`✓ Deleted ${key}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to delete secret: ${error}`);
      }
    }
  }

  /**
   * List all stored secrets from both locations
   */
  async list(): Promise<Map<string, string>> {
    const secrets = new Map<string, string>();
    const primaryDir = this.getPrimarySecretsDir();
    const fallbackDir = this.getFallbackSecretsDir();

    // List from fallback
    try {
      const files = await fs.readdir(fallbackDir);
      for (const key of files) {
        secrets.set(key, fallbackDir);
      }
    } catch {
      // Directory doesn't exist
    }

    // List from primary (overrides fallback if exists)
    try {
      const files = await fs.readdir(primaryDir);
      for (const key of files) {
        secrets.set(key, primaryDir);
      }
    } catch {
      // Directory doesn't exist
    }

    return secrets;
  }
}
