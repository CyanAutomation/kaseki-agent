/**
 * Temporary directory lifecycle management
 *
 * Utilities for managing temporary directories with proper cleanup
 * and optional reuse across test scenarios.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

export interface TempDirPoolConfig {
  prefix?: string;
  reusable?: boolean; // Allow reuse across multiple tests
}

/**
 * Create a temporary directory with cleanup tracking
 *
 * @param prefix Prefix for the temp directory name
 * @returns Object with tmpDir path and cleanup function
 */
export function createTempDir(prefix = 'kaseki-test-'): { tmpDir: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(tmpdir(), prefix));

  return {
    tmpDir,
    cleanup: () => {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Create multiple subdirectories in a temp dir efficiently
 *
 * @param tmpDir Base temporary directory
 * @param subdirs Array of subdirectory names to create
 * @returns Object mapping names to full paths
 */
export function createSubdirs(
  tmpDir: string,
  subdirs: string[]
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const subdir of subdirs) {
    const fullPath = path.join(tmpDir, subdir);
    fs.mkdirSync(fullPath, { recursive: true });
    result[subdir] = fullPath;
  }

  return result;
}



/**
 * Pool of temporary directories for test reuse
 */
class TempDirPool {
  private dirs: Map<string, { tmpDir: string; inUse: boolean }> = new Map();
  private prefix: string;

  constructor(prefix = 'kaseki-test-pool-') {
    this.prefix = prefix;
  }

  /**
   * Get or create a temp directory from the pool
   */
  acquire(key: string): string {
    if (this.dirs.has(key)) {
      const entry = this.dirs.get(key)!;
      if (!entry.inUse) {
        entry.inUse = true;
        return entry.tmpDir;
      }
    }

    const { tmpDir } = createTempDir(this.prefix);
    this.dirs.set(key, { tmpDir, inUse: true });
    return tmpDir;
  }

  /**
   * Release a temp directory back to the pool
   */
  release(key: string): void {
    const entry = this.dirs.get(key);
    if (entry) {
      entry.inUse = false;
    }
  }

  /**
   * Clean up all directories in the pool
   */
  cleanup(): void {
    for (const entry of this.dirs.values()) {
      if (fs.existsSync(entry.tmpDir)) {
        fs.rmSync(entry.tmpDir, { recursive: true, force: true });
      }
    }
    this.dirs.clear();
  }
}

// Global pool instance for test suites that want to share temps (internal use only)
let globalPool: TempDirPool | null = null;

/**
 * Clear the global temp directory pool (useful in afterAll hooks)
 */
export function clearGlobalTempDirPool(): void {
  if (globalPool) {
    globalPool.cleanup();
    globalPool = null;
  }
}

// ensureTempDirStructure() removed — use createSubdirs() instead, or fs.mkdirSync(..., { recursive: true })
