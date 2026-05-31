/**
 * Artifact availability determination logic.
 * Encapsulates rules for which artifacts are available in which job states.
 */

import * as fs from 'fs';
import { ArtifactAvailability } from '../kaseki-api-types';
import { ARTIFACT_METADATA_REGISTRY } from '../artifact-metadata';

export type ArtifactStatus = 'available' | 'pending' | 'not-found' | 'not-available-yet';

/**
 * Determine if a job status is terminal (completed or failed).
 * Non-terminal jobs: queued, running
 * Terminal jobs: completed, failed
 */
export function isTerminalJobStatus(status: 'queued' | 'running' | 'completed' | 'failed'): boolean {
  return status === 'completed' || status === 'failed';
}

/**
 * Determine artifact availability based on job status and file state.
 * Returns one of: 'available', 'pending', 'not-found', 'not-available-yet'
 *
 * Availability rules:
 * - ON_FAILURE artifacts only available if job.status === 'failed'
 * - ON_SUCCESS artifacts only available if job.status === 'completed'
 * - ALWAYS artifacts always available for terminal jobs
 * - CONDITIONAL artifacts require existence check on disk
 *
 * @param artifactName - Name of the artifact file
 * @param jobStatus - Current job status (queued, running, completed, failed)
 * @param fileExists - Whether the file exists on disk
 * @param fileSize - Size of the file in bytes (0 if doesn't exist or is empty)
 * @returns Status of artifact availability
 */
export function getArtifactStatus(
  artifactName: string,
  jobStatus: 'queued' | 'running' | 'completed' | 'failed',
  fileExists: boolean,
  fileSize: number
): ArtifactStatus {
  // Get artifact metadata
  const metadata = ARTIFACT_METADATA_REGISTRY[artifactName];
  if (!metadata) {
    return 'not-found';
  }

  // For non-terminal jobs, check if artifact is restricted to specific job states
  if (!isTerminalJobStatus(jobStatus)) {
    // If artifact requires a specific terminal state, it's not available yet
    if (metadata.availability === ArtifactAvailability.ON_FAILURE || metadata.availability === ArtifactAvailability.ON_SUCCESS) {
      return 'not-available-yet';
    }
    // Otherwise, it's pending (general artifacts available on all jobs)
    return 'pending';
  }

  // File must exist and have content for any availability
  if (!fileExists || fileSize === 0) {
    // Check if it should have content based on availability rules
    switch (metadata.availability) {
    case ArtifactAvailability.ON_FAILURE:
      return jobStatus === 'failed' ? 'not-found' : 'not-available-yet';
    case ArtifactAvailability.ON_SUCCESS:
      return jobStatus === 'completed' ? 'not-found' : 'not-available-yet';
    case ArtifactAvailability.ALWAYS:
      return 'not-found';
    case ArtifactAvailability.CONDITIONAL:
      return 'not-found';
    default:
      return 'not-found';
    }
  }

  // File exists and has content; check availability rules
  switch (metadata.availability) {
  case ArtifactAvailability.ALWAYS:
    return 'available';
  case ArtifactAvailability.ON_FAILURE:
    return jobStatus === 'failed' ? 'available' : 'not-available-yet';
  case ArtifactAvailability.ON_SUCCESS:
    return jobStatus === 'completed' ? 'available' : 'not-available-yet';
  case ArtifactAvailability.CONDITIONAL:
    // For conditional artifacts, file existence determines availability
    return 'available';
  default:
    return 'not-available-yet';
  }
}

/**
 * Check if an artifact is available (convenience wrapper).
 * Returns true if status is 'available'.
 */
export function isArtifactAvailable(
  artifactName: string,
  jobStatus: 'queued' | 'running' | 'completed' | 'failed',
  fileExists: boolean,
  fileSize: number
): boolean {
  return getArtifactStatus(artifactName, jobStatus, fileExists, fileSize) === 'available';
}

/**
 * Get human-readable reason for artifact unavailability.
 */
export function getArtifactUnavailableReason(status: ArtifactStatus, artifactName: string): string {
  const metadata = ARTIFACT_METADATA_REGISTRY[artifactName];
  const availabilityRule = metadata?.availability;

  switch (status) {
  case 'available':
    return 'Available';
  case 'pending':
    return 'Artifact will be available when job completes';
  case 'not-found':
    return `Artifact not found: ${artifactName}`;
  case 'not-available-yet':
    if (availabilityRule === ArtifactAvailability.ON_FAILURE) {
      return `Artifact only available for failed runs: ${artifactName}`;
    }
    if (availabilityRule === ArtifactAvailability.ON_SUCCESS) {
      return `Artifact only available for successful runs: ${artifactName}`;
    }
    return `Artifact not available in current state: ${artifactName}`;
  default:
    return 'Unknown artifact status';
  }
}

/**
 * Get file stats safely, handling errors gracefully.
 */
export function getSafeFileStats(filePath: string): { exists: boolean; size: number; stats?: fs.Stats } {
  try {
    const stats = fs.statSync(filePath);
    if (stats.isFile()) {
      return { exists: true, size: stats.size, stats };
    }
    return { exists: false, size: 0 };
  } catch {
    return { exists: false, size: 0 };
  }
}
