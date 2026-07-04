/**
 * Metadata extraction and exit code resolution helper for StatusResponseBuilder
 */

import * as path from 'path';
import * as fs from 'fs';
import { Job } from '../kaseki-api-types';
import { resolveInstanceExitCode } from '../instance-state-derivation';

export class StatusMetadataHelper {
  /**
   * Read metadata.json from run directory
   */
  readMetadata(runDir: string): any {
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
    if (job.completedAt) {
      return job.completedAt.toISOString();
    }
    if (!(job.status === 'completed' || job.status === 'failed')) {
      return undefined;
    }
    const rawEndedAt = metadata?.ended_at ?? metadata?.completedAt ?? metadata?.completed_at;
    if (typeof rawEndedAt !== 'string' || rawEndedAt.trim().length === 0) {
      return undefined;
    }
    const normalized = /^\d{4}-\d{2}-\d{2}T.*Z$/.test(rawEndedAt)
      ? rawEndedAt
      : rawEndedAt.replace(' ', 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  /**
   * Type guard for record objects
   */
  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Extract string field from record
   */
  stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Convert value to optional number
   */
  optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
}
