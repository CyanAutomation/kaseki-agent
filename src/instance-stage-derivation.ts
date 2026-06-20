/**
 * Instance Stage Derivation
 *
 * Derives the current stage of an instance from metadata and stdout logs.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Metadata } from './instance-metadata-reader';

/**
 * Get the current stage of a running or completed instance.
 * Parses stdout.log for "==> stage_name" markers.
 */
function getCurrentStage(resultsDir: string, instanceName: string): string {
  const stdoutPath = join(resultsDir, instanceName, 'stdout.log');
  if (!existsSync(stdoutPath)) {
    return 'unknown';
  }

  try {
    const stdout = readFileSync(stdoutPath, 'utf8');
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
