/**
 * Helper for reading analysis artifacts with caching support.
 * Used by log-routes.ts to reduce redundant file I/O.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CachedArtifactReader } from './cached-artifact-reader';

export class AnalysisArtifactHelper {
  private reader?: CachedArtifactReader;

  constructor(reader?: CachedArtifactReader) {
    this.reader = reader;
  }

  /**
   * Read metadata.json with optional caching.
   */
  readMetadata(runDir: string): Record<string, unknown> | undefined {
    const metadataPath = path.join(runDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      return undefined;
    }

    if (this.reader) {
      const metadata = this.reader.readMetadata(metadataPath);
      return metadata as Record<string, unknown> | null ?? undefined;
    }

    // Fallback to direct read
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  /**
   * Read changed-files.txt with optional caching.
   */
  readChangedFiles(runDir: string): string[] | undefined {
    const changedFilesPath = path.join(runDir, 'changed-files.txt');
    if (!fs.existsSync(changedFilesPath)) {
      return undefined;
    }

    if (this.reader) {
      return this.reader.readChangedFiles(changedFilesPath) ?? undefined;
    }

    // Fallback to direct read
    try {
      return fs
        .readFileSync(changedFilesPath, 'utf-8')
        .trim()
        .split('\n')
        .filter((f) => f);
    } catch {
      return undefined;
    }
  }

  /**
   * Read validation-timings.tsv with optional caching.
   */
  readValidationTimings(runDir: string): string | undefined {
    const validationPath = path.join(runDir, 'validation-timings.tsv');
    if (!fs.existsSync(validationPath)) {
      return undefined;
    }

    if (this.reader) {
      return this.reader.readTextArtifact(validationPath) ?? undefined;
    }

    // Fallback to direct read
    try {
      return fs.readFileSync(validationPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * Safely read an artifact with error handling.
   */
  safelyReadArtifact<T>(
    artifact: string,
    warnings: string[],
    reader: () => T
  ): T | undefined {
    try {
      return reader();
    } catch {
      // Analysis artifacts are produced independently while a run is finalizing.
      // One truncated or malformed optional file must not turn the whole endpoint
      // into a 500 response.
      warnings.push(`Could not read ${artifact}; it may be incomplete or malformed.`);
      return undefined;
    }
  }
}
