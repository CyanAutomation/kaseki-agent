import { StructuredProgress } from '../kaseki-api-types';
import { getPhaseDisplayName } from './phase-names';

const SHELL_DIAGNOSTIC_PATTERN = /\/[^\s:]+(?:\/[^\s:]+)*:\s+line\s+\d+:\s+.*$/;
const GIT_CLONE_STDERR_PATTERN = /Cloning into '[^']+'\.\.\.$/;
const STARTUP_CHECK_INTERLEAVE_PATTERN = /\s*ℹ?\s*Kaseki startup checks \(mode:[^)]+\)[\s\S]*$/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function sanitizeProgressMessage(message: string): string {
  return message
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(STARTUP_CHECK_INTERLEAVE_PATTERN, '')
    .replace(SHELL_DIAGNOSTIC_PATTERN, '')
    .replace(GIT_CLONE_STDERR_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a progress event by ensuring common fields are standardized.
 * Ensures message is populated from stage/detail, and timestamp is normalized to updatedAt.
 */
export function normalizeProgressEvent(event: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...event };
  if (typeof normalized.stage === 'string') {
    if (typeof normalized.message !== 'string' && typeof normalized.detail === 'string') {
      normalized.message = sanitizeProgressMessage(normalized.detail);
    }
    if (typeof normalized.message !== 'string') {
      normalized.message = normalized.stage;
    } else {
      normalized.message = sanitizeProgressMessage(normalized.message);
    }
  }
  if (typeof normalized.updatedAt !== 'string' && typeof normalized.timestamp === 'string') {
    normalized.updatedAt = normalized.timestamp;
  }
  return normalized;
}

/**
 * Convert a progress event to a StructuredProgress object.
 * Always ensures stage is present; returns null only if event is invalid.
 */
export function toStructuredProgress(
  event: Record<string, unknown>,
  fallbackStage: string = 'running'
): StructuredProgress | null {
  const stage = typeof event.stage === 'string' ? sanitizeProgressMessage(event.stage) : fallbackStage;
  if (!stage) {
    return null;
  }

  const message =
    typeof event.message === 'string'
      ? sanitizeProgressMessage(event.message)
      : typeof event.detail === 'string'
        ? sanitizeProgressMessage(event.detail)
        : undefined;

  const numericPercent = typeof event.percentComplete === 'number' ? event.percentComplete : undefined;
  const percentFromPercent = typeof event.percent === 'number' ? event.percent : undefined;
  const percentComplete = numericPercent ?? percentFromPercent;
  const updatedAt =
    typeof event.updatedAt === 'string' ? event.updatedAt : typeof event.timestamp === 'string' ? event.timestamp : undefined;

  return {
    stage,
    displayName: getPhaseDisplayName(stage),
    percentComplete,
    message: message || stage,
    updatedAt,
  };
}
