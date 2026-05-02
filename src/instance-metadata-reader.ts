/**
 * instance-metadata-reader.ts
 *
 * Encapsulates metadata reading logic for kaseki instances.
 * Safely reads and parses metadata.json, host-start.json, and resource.time files
 * with graceful error handling for transient I/O errors.
 */

import fs from 'fs';
import path from 'path';

export interface Metadata {
  current_stage?: string;
  exit_code?: number | string;
  duration_seconds?: number;
  started_at?: string;
  start_time?: string;
  model?: string;
  pi_duration_seconds?: number;
  [key: string]: any;
}

export interface HostStart {
  model?: string;
  repo_url?: string;
  repo?: string;
  git_ref?: string;
  ref?: string;
  agentTimeoutSeconds?: number;
  [key: string]: any;
}

export interface InstanceMetadataInfo {
  metadata: Metadata;
  hostStart: HostStart;
  elapsedSeconds: number | null;
}

/**
 * Check if an error is a transient I/O error that should be retried or skipped.
 */
function isSkippableInstanceIoError(error: any): boolean {
  return error && (error.code === 'ENOENT' || error.code === 'ESTALE');
}

/**
 * Read elapsed seconds from metadata or resource.time file.
 * Tries metadata.duration_seconds first, then falls back to resource.time.
 */
function readElapsedSeconds(resultDir: string, metadata: Metadata): number | null {
  if (metadata.duration_seconds !== undefined) {
    return metadata.duration_seconds;
  }

  const resourceTimePath = path.join(resultDir, 'resource.time');
  if (!fs.existsSync(resourceTimePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(resourceTimePath, 'utf8');
    const match = content.match(/elapsed_seconds=([0-9]+(?:\.[0-9]+)?)/);
    if (match) {
      return parseFloat(match[1]);
    }
  } catch {
    // File may be unreadable; return null
  }

  return null;
}

/**
 * Read metadata for a kaseki instance from its results directory.
 *
 * Reads three files:
 * - metadata.json (primary source of truth)
 * - host-start.json (configuration from run initiation)
 * - resource.time (timing information if metadata incomplete)
 *
 * Handles transient I/O errors (ENOENT, ESTALE) by propagating them
 * so callers can skip the instance and continue scanning.
 *
 * @param resultDir - Path to the kaseki results directory (e.g., /agents/kaseki-results/kaseki-1)
 * @returns InstanceMetadataInfo with parsed metadata, host config, and elapsed time
 * @throws Error if I/O error is transient (ENOENT, ESTALE); caller should skip this instance
 */
export function readInstanceMetadata(resultDir: string): InstanceMetadataInfo {
  const metadataPath = path.join(resultDir, 'metadata.json');
  const hostStartPath = path.join(resultDir, 'host-start.json');

  let metadata: Metadata = {};
  let hostStart: HostStart = {};

  // Read metadata
  if (fs.existsSync(metadataPath)) {
    try {
      const content = fs.readFileSync(metadataPath, 'utf8');
      metadata = JSON.parse(content);
    } catch (e) {
      if (isSkippableInstanceIoError(e)) {
        throw e; // Propagate transient errors to caller
      }
      // Metadata may still be incomplete if run is in progress; use empty object
    }
  }

  // Read host start config
  if (fs.existsSync(hostStartPath)) {
    try {
      const content = fs.readFileSync(hostStartPath, 'utf8');
      hostStart = JSON.parse(content);
    } catch (e) {
      if (isSkippableInstanceIoError(e)) {
        throw e; // Propagate transient errors to caller
      }
      // File may be unreadable; use empty object
    }
  }

  // Read elapsed seconds
  const elapsedSeconds = readElapsedSeconds(resultDir, metadata);

  return {
    metadata,
    hostStart,
    elapsedSeconds,
  };
}
