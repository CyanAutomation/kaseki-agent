/**
 * Temporary directory lifecycle management
 *
 * Utilities for managing temporary directories with proper cleanup
 * and optional reuse across test scenarios.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

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

// Global pool for future use: if temp reuse pattern is needed again, add this:
// class TempDirPool { ... }

/**
 * Clear the global temp directory pool (useful in afterAll hooks)
 */
export function clearGlobalTempDirPool(): void {
  // Placeholder for future pool cleanup logic
}

// ensureTempDirStructure() removed — use createSubdirs() instead, or fs.mkdirSync(..., { recursive: true })
