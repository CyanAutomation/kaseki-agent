/**
 * instance-state-derivation.ts
 *
 * Encapsulates state derivation logic for kaseki instances.
 * Derives lifecycle status, exit codes, stages, and failure classifications
 * from metadata and instance artifacts.
 */

import fs from 'fs';
import path from 'path';
import { Metadata } from './instance-metadata-reader.js';

export type InstanceLifecycleStatus = 'running' | 'completed' | 'failed' | 'pending';

/**
 * Normalize an exit code candidate into an integer or null.
 */
function normalizeExitCodeCandidate(value: any): number | null {
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
  const exitCodePath = path.join(resultDir, 'exit_code');
  if (!fs.existsSync(exitCodePath)) {
    return metadataExitCode;
  }

  try {
    const fileExitCode = normalizeExitCodeCandidate(fs.readFileSync(exitCodePath, 'utf8'));
    return fileExitCode !== null ? fileExitCode : metadataExitCode;
  } catch {
    return metadataExitCode;
  }
}

/**
 * Get the current stage of a running or completed instance.
 * Parses stdout.log for "==> stage_name" markers.
 */
function getCurrentStage(resultsDir: string, instanceName: string): string {
  const stdoutPath = path.join(resultsDir, instanceName, 'stdout.log');
  if (!fs.existsSync(stdoutPath)) {
    return 'unknown';
  }

  try {
    const stdout = fs.readFileSync(stdoutPath, 'utf8');
    const matches = stdout.match(/^==> (.+?)$/gm);
    if (!matches || matches.length === 0) return 'unknown';

    const lastMarker = matches[matches.length - 1];
    return lastMarker.replace(/^==> /, '').trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Resolve stage from metadata first, then fallback to stdout markers.
 */
export function resolveInstanceStage(
  resultsDir: string,
  instanceName: string,
  metadata: Metadata = {},
  fallback: string = 'unknown'
): string {
  if (typeof metadata.current_stage === 'string' && metadata.current_stage.trim().length > 0) {
    return metadata.current_stage;
  }
  const parsedStage = getCurrentStage(resultsDir, instanceName);
  return parsedStage !== 'unknown' ? parsedStage : fallback;
}

/**
 * Classify failure type from metadata and exit code.
 */
export function classifyFailure(
  metadata: Metadata = {},
  exitCode: number | string | null = null
): string {
  const normalizedExitCode = normalizeExitCodeCandidate(exitCode);
  const failedCommand =
    typeof metadata.failed_command === 'string' ? metadata.failed_command.trim() : '';

  if (normalizedExitCode === 0) return 'none';
  if (normalizedExitCode === 124) return 'timeout';
  if (failedCommand === 'empty git diff' || normalizedExitCode === 3) return 'empty-diff';
  if (failedCommand === 'validation') return 'validation';
  if (failedCommand === 'quality checks') return 'quality';
  if (failedCommand === 'secret scan') return 'secret-scan';
  if (failedCommand.startsWith('github')) return 'github';
  if (failedCommand.includes('OPENROUTER_API_KEY') || failedCommand.includes('OpenRouter')) {
    return 'credentials';
  }
  if (failedCommand) return failedCommand.replace(/\s+/g, '-');
  if (Number.isInteger(normalizedExitCode)) return 'nonzero-exit';
  return 'unknown';
}
