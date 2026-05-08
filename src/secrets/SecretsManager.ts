/**
 * Secrets Manager
 *
 * Secure credential storage with keyring integration
 * - Primary: Linux keyring (pass)
 * - Fallback: File-based storage (~/.kaseki/secrets/) with 0600 permissions
 *
 * Note: macOS Keychain and Windows Credential Manager support can be added
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { createLogger } from '../logger';

const logger = createLogger('secrets');

export interface SecretsStore {
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/**
 * File-based secrets store (fallback, headless systems)
 */
export class FileSecretsStore implements SecretsStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(os.homedir(), '.kaseki', 'secrets');
  }

  async store(key: string, value: string): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
      const filePath = path.join(this.baseDir, key);

      // Write with restrictive permissions (0600 - owner read/write only)
      await fs.writeFile(filePath, value, {
        mode: 0o600,
        flag: 'w',
      });

      logger.debug(`Secret stored: ${key} -> ${filePath}`);
    } catch (error) {
      throw new Error(`Failed to store secret: ${error}`);
    }
  }

  async retrieve(key: string): Promise<string | null> {
    try {
      const filePath = path.join(this.baseDir, key);
      const stat = await fs.stat(filePath);

      // Security check: verify file permissions are restrictive
      if ((stat.mode & 0o077) !== 0) {
        logger.warn(`Secret file has overly permissive permissions: ${filePath}`);
      }

      const value = await fs.readFile(filePath, 'utf-8');
      return value.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to retrieve secret: ${error}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = path.join(this.baseDir, key);
      await fs.unlink(filePath);
      logger.debug(`Secret deleted: ${key}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Failed to delete secret: ${error}`);
      }
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.baseDir);
      return files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

/**
 * Linux pass (password-store) backed secrets
 * Requires: pass package installed and initialized
 */
export class PassSecretsStore implements SecretsStore {
  private prefix: string;

  constructor(prefix: string = 'kaseki-agent') {
    this.prefix = prefix;
  }

  private getPassKey(key: string): string {
    return `${this.prefix}/${key}`;
  }

  private isPassAvailable(): boolean {
    try {
      execSync('command -v pass', { shell: '/bin/bash', stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private isPassInitialized(): boolean {
    try {
      execSync('pass ls > /dev/null 2>&1', { shell: '/bin/bash', stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async store(key: string, value: string): Promise<void> {
    if (!this.isPassAvailable()) {
      throw new Error('pass (password-store) not installed. Install with: sudo apt install pass');
    }

    if (!this.isPassInitialized()) {
      throw new Error('pass (password-store) not initialized. Run: pass init');
    }

    try {
      // Use echo + pass insert to avoid interactive prompt
      const passKey = this.getPassKey(key);
      execSync(`echo "${value.replace(/"/g, '\\"')}" | pass insert -f "${passKey}"`, {
        shell: '/bin/bash',
      });

      logger.debug(`Secret stored in pass: ${passKey}`);
    } catch (error) {
      throw new Error(`Failed to store secret in pass: ${error}`);
    }
  }

  async retrieve(key: string): Promise<string | null> {
    if (!this.isPassAvailable()) {
      logger.debug('pass not available, skipping keyring retrieval');
      return null;
    }

    try {
      const passKey = this.getPassKey(key);
      const result = execSync(`pass show "${passKey}" 2>/dev/null || echo ""`, {
        shell: '/bin/bash',
        encoding: 'utf-8',
      });

      return result.trim() || null;
    } catch (error) {
      logger.debug(`Failed to retrieve secret from pass: ${error}`);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isPassAvailable()) {
      return;
    }

    try {
      const passKey = this.getPassKey(key);
      execSync(`pass rm -f "${passKey}"`, { shell: '/bin/bash' });
      logger.debug(`Secret deleted from pass: ${passKey}`);
    } catch (error) {
      throw new Error(`Failed to delete secret from pass: ${error}`);
    }
  }

  async list(): Promise<string[]> {
    if (!this.isPassAvailable()) {
      return [];
    }

    try {
      const result = execSync(`pass ls 2>/dev/null | grep "^${this.prefix}/" || echo ""`, {
        shell: '/bin/bash',
        encoding: 'utf-8',
      });

      return result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.replace(`${this.prefix}/`, ''));
    } catch (error) {
      logger.debug(`Failed to list secrets from pass: ${error}`);
      return [];
    }
  }
}

/**
 * Secrets Manager - Main interface
 * Tries keyring first, falls back to file storage
 */
export class SecretsManager {
  private fileStore: FileSecretsStore;
  private passStore: PassSecretsStore;
  private usePassIfAvailable: boolean;

  constructor(usePassIfAvailable: boolean = true) {
    this.fileStore = new FileSecretsStore();
    this.passStore = new PassSecretsStore();
    this.usePassIfAvailable = usePassIfAvailable;
  }

  /**
   * Store a secret with automatic fallback
   */
  async store(key: string, value: string): Promise<void> {
    if (this.usePassIfAvailable && this.isPassAvailable()) {
      try {
        await this.passStore.store(key, value);
        return;
      } catch (error) {
        logger.warn(`Keyring storage failed, falling back to file storage: ${error}`);
      }
    }

    await this.fileStore.store(key, value);
  }

  /**
   * Retrieve a secret (tries keyring first, then file)
   */
  async retrieve(key: string): Promise<string | null> {
    // Try file-based first (where users might have stored it)
    const fileValue = await this.fileStore.retrieve(key);
    if (fileValue) {
      return fileValue;
    }

    // Try keyring if available
    if (this.usePassIfAvailable && this.isPassAvailable()) {
      const passValue = await this.passStore.retrieve(key);
      if (passValue) {
        return passValue;
      }
    }

    return null;
  }

  /**
   * Delete a secret from both stores
   */
  async delete(key: string): Promise<void> {
    try {
      await this.fileStore.delete(key);
    } catch (error) {
      logger.debug(`Failed to delete from file store: ${error}`);
    }

    if (this.usePassIfAvailable && this.isPassAvailable()) {
      try {
        await this.passStore.delete(key);
      } catch (error) {
        logger.debug(`Failed to delete from keyring: ${error}`);
      }
    }
  }

  /**
   * List all stored secrets
   */
  async list(): Promise<Map<string, string>> {
    const secrets = new Map<string, string>();

    // List from file store
    const fileKeys = await this.fileStore.list();
    for (const key of fileKeys) {
      const value = await this.fileStore.retrieve(key);
      if (value) {
        secrets.set(key, `file:${path.join(os.homedir(), '.kaseki', 'secrets', key)}`);
      }
    }

    // List from keyring
    if (this.usePassIfAvailable && this.isPassAvailable()) {
      const passKeys = await this.passStore.list();
      for (const key of passKeys) {
        secrets.set(key, `keyring:${key}`);
      }
    }

    return secrets;
  }

  /**
   * Check if pass is available
   */
  private isPassAvailable(): boolean {
    try {
      execSync('command -v pass', { shell: '/bin/bash', stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize/setup keyring (interactive)
   */
  async initializeKeyring(): Promise<void> {
    if (!this.isPassAvailable()) {
      throw new Error('pass (password-store) not installed');
    }

    try {
      execSync('pass init 2>&1', { shell: '/bin/bash', stdio: 'inherit' });
      logger.info('Keyring initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize keyring: ${error}`);
    }
  }

  /**
   * Get recommended storage method for system
   */
  getRecommendedStore(): string {
    if (this.isPassAvailable()) {
      return 'keyring (pass)';
    }
    return 'file (~/.kaseki/secrets/)';
  }
}
