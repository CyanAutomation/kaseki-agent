/**
 * Instance Status Derivation
 *
 * Derives instance lifecycle status and exit codes from metadata and artifacts.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Metadata } from './instance-metadata-reader';

export type InstanceLifecycleStatus = 'running' | 'completed' | 'failed' | 'pending';

/**
 * Normalize an exit code candidate into an integer or null.
 */
export function normalizeExitCodeCandidate(value: any): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

/**
 * Derive lifecycle status from running flag and exit code.
 */
export function deriveInstanceLifecycleStatus(
  isRunning: boolean,
  exitCode: number | null
): InstanceLifecycleStatus {
  if (isRunning) return 'running';
  if (exitCode === 0) return 'completed';
  if (Number.isInteger(exitCode)) return 'failed';
  return 'pending';
}

/**
 * Resolve exit code from metadata and optional /exit_code file.
 * Prefers /exit_code file when readable, falls back to metadata.exit_code.
 * Returns null only when neither source has a valid integer.
 */
export function resolveInstanceExitCode(
  resultDir: string,
  metadata: Metadata = {}
): number | null {
  const metadataExitCode = normalizeExitCodeCandidate(metadata.exit_code);
  const exitCodePath = join(resultDir, 'exit_code');
  if (!existsSync(exitCodePath)) {
    return metadataExitCode;
  }

  try {
    const fileExitCode = normalizeExitCodeCandidate(readFileSync(exitCodePath, 'utf8'));
    return fileExitCode !== null ? fileExitCode : metadataExitCode;
  } catch {
    return metadataExitCode;
  }
}
