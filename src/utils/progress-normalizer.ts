import { StructuredProgress } from '../kaseki-api-types';

/**
 * Normalize a progress event by ensuring common fields are standardized.
 * Ensures message is populated from stage/detail, and timestamp is normalized to updatedAt.
 */
export function normalizeProgressEvent(event: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...event };
  if (typeof normalized.stage === 'string') {
    if (typeof normalized.message !== 'string' && typeof normalized.detail === 'string') {
      normalized.message = normalized.detail;
    }
    if (typeof normalized.message !== 'string') {
      normalized.message = normalized.stage;
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
  const stage = typeof event.stage === 'string' ? event.stage.trim() : fallbackStage;
  if (!stage) {
    return null;
  }

  const message =
    typeof event.message === 'string'
      ? event.message
      : typeof event.detail === 'string'
        ? event.detail
        : undefined;

  const numericPercent = typeof event.percentComplete === 'number' ? event.percentComplete : undefined;
  const percentFromPercent = typeof event.percent === 'number' ? event.percent : undefined;
  const percentComplete = numericPercent ?? percentFromPercent;
  const updatedAt =
    typeof event.updatedAt === 'string' ? event.updatedAt : typeof event.timestamp === 'string' ? event.timestamp : undefined;

  return {
    stage,
    percentComplete,
    message: message || stage,
    updatedAt,
  };
}
