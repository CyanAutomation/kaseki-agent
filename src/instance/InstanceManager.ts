/**
 * Instance Manager
 * 
 * Handles kaseki instance lifecycle: naming, directories, metadata
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../logger';

const logger = createLogger('instance');

export interface InstanceMetadata {
  id: string;
  createdAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  exitCode?: number;
  model?: string;
  provider?: string;
  repoUrl?: string;
  gitRef?: string;
  stages?: {
    [stageName: string]: {
      startTime?: string;
      endTime?: string;
      exitCode?: number;
      duration?: number;
    };
  };
}

export class InstanceManager {
  private rootDir: string;
  private instanceId: string | null = null;

  constructor(rootDir: string = '/agents') {
    this.rootDir = rootDir;
  }

  /**
   * Generate or get next instance ID
   */
  async getOrCreateInstanceId(): Promise<string> {
    if (this.instanceId) {
      return this.instanceId;
    }

    // Find next available instance number
    const runsDir = path.join(this.rootDir, 'kaseki-runs');
    let instanceNum = 1;

    try {
      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      const existingNums = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('kaseki-'))
        .map((entry) => {
          const match = entry.name.match(/kaseki-(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((num) => num > 0);

      if (existingNums.length > 0) {
        instanceNum = Math.max(...existingNums) + 1;
      }
    } catch {
      // Directory doesn't exist yet, that's fine
      instanceNum = 1;
    }

    this.instanceId = `kaseki-${instanceNum}`;
    logger.debug(`Generated instance ID: ${this.instanceId}`);

    return this.instanceId;
  }

  /**
   * Get workspace directory path
   */
  async getWorkspaceDir(): Promise<string> {
    const id = await this.getOrCreateInstanceId();
    return path.join(this.rootDir, 'kaseki-runs', id);
  }

  /**
   * Get results directory path
   */
  async getResultsDir(): Promise<string> {
    const id = await this.getOrCreateInstanceId();
    return path.join(this.rootDir, 'kaseki-results', id);
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return path.join(this.rootDir, 'kaseki-cache');
  }

  /**
   * Create instance directories
   */
  async createDirectories(): Promise<{ workspace: string; results: string }> {
    const workspace = await this.getWorkspaceDir();
    const results = await this.getResultsDir();

    try {
      await fs.mkdir(workspace, { recursive: true });
      await fs.mkdir(results, { recursive: true });
      logger.debug(`Created instance directories for ${this.instanceId}`);

      return { workspace, results };
    } catch (error) {
      throw new Error(`Failed to create instance directories: ${error}`);
    }
  }

  /**
   * Initialize metadata file
   */
  async initializeMetadata(metadata: Partial<InstanceMetadata>): Promise<void> {
    const id = await this.getOrCreateInstanceId();
    const resultsDir = await this.getResultsDir();
    const metadataPath = path.join(resultsDir, 'metadata.json');

    const fullMetadata: InstanceMetadata = {
      id,
      createdAt: new Date().toISOString(),
      status: 'running',
      stages: {},
      ...metadata,
    };

    try {
      await fs.writeFile(
        metadataPath,
        JSON.stringify(fullMetadata, null, 2),
        'utf-8'
      );
      logger.debug(`Initialized metadata for ${id}`);
    } catch (error) {
      throw new Error(`Failed to initialize metadata: ${error}`);
    }
  }

  /**
   * Update metadata
   */
  async updateMetadata(updates: Partial<InstanceMetadata>): Promise<void> {
    const resultsDir = await this.getResultsDir();
    const metadataPath = path.join(resultsDir, 'metadata.json');

    try {
      let metadata: InstanceMetadata = {
        id: this.instanceId || '',
        createdAt: new Date().toISOString(),
        status: 'running',
      };

      // Read existing metadata
      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(content);
      } catch {
        // File doesn't exist yet, that's fine
      }

      // Merge updates
      const updated = { ...metadata, ...updates };

      // Write back
      await fs.writeFile(
        metadataPath,
        JSON.stringify(updated, null, 2),
        'utf-8'
      );

      logger.debug(`Updated metadata for ${this.instanceId}`);
    } catch (error) {
      logger.warn(`Failed to update metadata: ${error}`);
    }
  }

  /**
   * Record stage timing
   */
  async recordStage(
    stageName: string,
    exitCode?: number,
    startTime?: Date,
    endTime?: Date
  ): Promise<void> {
    const resultsDir = await this.getResultsDir();
    const metadataPath = path.join(resultsDir, 'metadata.json');

    try {
      let metadata: InstanceMetadata = {
        id: this.instanceId || '',
        createdAt: new Date().toISOString(),
        status: 'running',
      };

      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(content);
      } catch {
        // File doesn't exist
      }

      if (!metadata.stages) {
        metadata.stages = {};
      }

      metadata.stages[stageName] = {
        startTime: startTime?.toISOString(),
        endTime: endTime?.toISOString(),
        exitCode,
        duration: startTime && endTime ? 
          (endTime.getTime() - startTime.getTime()) / 1000 : undefined,
      };

      await fs.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        'utf-8'
      );

      logger.debug(`Recorded stage: ${stageName} (exit code: ${exitCode})`);
    } catch (error) {
      logger.warn(`Failed to record stage: ${error}`);
    }
  }

  /**
   * Finalize instance metadata
   */
  async finalize(exitCode: number): Promise<void> {
    await this.updateMetadata({
      completedAt: new Date().toISOString(),
      status: exitCode === 0 ? 'completed' : 'failed',
      exitCode,
    });

    logger.info(`Finalized instance ${this.instanceId}: exit code ${exitCode}`);
  }

  /**
   * Get instance metadata
   */
  async getMetadata(): Promise<InstanceMetadata | null> {
    try {
      const resultsDir = await this.getResultsDir();
      const metadataPath = path.join(resultsDir, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Clean up instance workspace (optional)
   */
  async cleanup(keepWorkspace: boolean = false): Promise<void> {
    if (keepWorkspace) {
      logger.debug(`Keeping workspace for ${this.instanceId}`);
      return;
    }

    try {
      const workspace = await this.getWorkspaceDir();
      await fs.rm(workspace, { recursive: true, force: true });
      logger.debug(`Cleaned up workspace for ${this.instanceId}`);
    } catch (error) {
      logger.warn(`Failed to cleanup workspace: ${error}`);
    }
  }

  /**
   * Get instance ID
   */
  getInstanceId(): string | null {
    return this.instanceId;
  }
}
