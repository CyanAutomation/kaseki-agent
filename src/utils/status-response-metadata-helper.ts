/**
 * Metadata extraction and exit code resolution helper for StatusResponseBuilder
 */

import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import { resolveInstanceExitCode } from '../instance-state-derivation';
import { CachedArtifactReader } from './cached-artifact-reader';
import {
  isRecordValue,
  optionalNumberValue,
  resolveCompletedAtValue,
  stringFieldValue,
} from './status-metadata-fields';

export class StatusMetadataHelper {
  private reader?: CachedArtifactReader;

  constructor(reader?: CachedArtifactReader) {
    this.reader = reader;
  }

  /**
   * Read metadata.json from run directory
   */
  readMetadata(runDir: string): any {
    // Use cached reader if available
    if (this.reader) {
      const metadataPath = path.join(runDir, 'metadata.json');
      const metadata = this.reader.readMetadata(metadataPath);
      return metadata ?? {};
    }

    // Fallback to direct fs read
    try {
      const metadataPath = path.join(runDir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      }
    } catch {
      // Ignore metadata read errors
    }
    return {};
  }

  /**
   * Resolve exit code from job or metadata
   */
  resolveExitCode(job: Job, runDir: string): number | null {
    if (job.exitCode !== undefined && job.exitCode !== null) {
      return job.exitCode;
    }
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return null;
    }
    try {
      const metadata = this.readMetadata(runDir);
      return resolveInstanceExitCode(runDir, metadata);
    } catch {
      return null;
    }
  }

  /**
   * Resolve completion timestamp from job or metadata
   */
  resolveCompletedAt(job: Job, metadata: any): string | undefined {
    return resolveCompletedAtValue(job, metadata);
  }

  /**
   * Type guard for record objects
   */
  isRecord(value: unknown): value is Record<string, unknown> {
    return isRecordValue(value);
  }

  /**
   * Extract string field from record
   */
  stringField(record: Record<string, unknown>, key: string): string | undefined {
    return stringFieldValue(record, key);
  }

  /**
   * Convert value to optional number
   */
  optionalNumber(value: unknown): number | undefined {
    return optionalNumberValue(value);
  }
}
