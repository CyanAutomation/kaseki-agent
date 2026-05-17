/**
 * Secrets Manager (Simplified)
 *
 * Secure credential storage - filesystem only
 * - Primary: /home/pi/secrets/{secretName} (Docker Compose)
 * - Fallback: ~/.kaseki/secrets/{secretName} (Single-run / local dev)
 *
 * No keyring, no env vars. Explicit paths only.
 * See scripts/setup-secrets.sh for automatic permission setup.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createLogger } from '../logger';

const logger = createLogger('secrets');

/**
 * Schema validators for different secret types
 */
interface SecretSchema {
  name: string;
  pattern: RegExp | null;
  validate(value: string): { valid: boolean; error?: string };
}

const schemas: Record<string, SecretSchema> = {
  openrouter_api_key: {
    name: 'OpenRouter API Key',
    pattern: /^sk-or-[a-zA-Z0-9]+$/,
    validate(value: string) {
      if (!/^sk-or-/.test(value)) {
        return { valid: false, error: 'Must start with "sk-or-"' };
      }
      if (value.length < 20) {
        return { valid: false, error: 'Looks incomplete (too short)' };
      }
      return { valid: true };
    },
  },
  github_app_private_key: {
    name: 'GitHub App Private Key',
    pattern: null,
    validate(value: string) {
      if (!value.includes('BEGIN RSA PRIVATE KEY')) {
        return { valid: false, error: 'Not a valid RSA private key (missing header)' };
      }
      if (!value.includes('END RSA PRIVATE KEY')) {
        return { valid: false, error: 'Not a valid RSA private key (missing footer)' };
      }
      return { valid: true };
    },
  },
  kaseki_api_keys: {
    name: 'Kaseki API Keys',
    pattern: /^[a-f0-9\-:;]+$/,
    validate(value: string) {
      // Comma or semicolon-separated UUIDs
      const keys = value.split(/[,;]/).map((k) => k.trim());
      for (const key of keys) {
        if (!/^[a-f0-9\-]+$/.test(key)) {
          return { valid: false, error: 'Contains invalid UUID format' };
        }
      }
      return { valid: true };
    },
  },
};

/**
 * Validate secret format and return detailed error if invalid
 */
export function validateSecretFormat(secretName: string, value: string): { valid: boolean; error?: string } {
  const schema = schemas[secretName];
  if (!schema) {
    // Unknown secret type; assume valid
    return { valid: true };
  }

  if (!value || value.trim().length === 0) {
    return { valid: false, error: `${schema.name} cannot be empty` };
  }

  return schema.validate(value);
}

/**
 * Simplified Secrets Manager - filesystem-only implementation
 * 
 * Two fallback paths:
 * 1. Primary: /home/pi/secrets/{secretName} (Docker Compose)
 * 2. Fallback: ~/.kaseki/secrets/{secretName} (Single-run, local dev)
 */
export class SecretsManager {
  /**
   * Get the primary secrets directory (Docker Compose)
   */
  private getPrimarySecretsDir(): string {
    // For Docker deployments, try /home/pi/secrets first
    return '/home/pi/secrets';
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
