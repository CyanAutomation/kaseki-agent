/**
 * Unified timestamp extraction and normalization utilities.
 * Consolidates timestamp handling across pi-event-filter, kaseki-report, and progress-stream-utils.
 *
 * This module provides a single source of truth for extracting timestamps from various
 * nested event structures, preventing duplication and ensuring consistency across the codebase.
 */

/**
 * Represents a Pi CLI event with optional timestamp at multiple levels.
 */
export interface PiEvent {
  type?: string;
  timestamp?: string | number;
  message?: {
    model?: string;
    api?: string;
    timestamp?: string | number;
    content?: Array<{ type: string }>;
  };
  assistantMessageEvent?: {
    type?: string;
    message?: {
      model?: string;
      api?: string;
      timestamp?: string | number;
      content?: Array<{ type: string }>;
    };
    partial?: {
      model?: string;
      api?: string;
      timestamp?: string | number;
      content?: Array<{ type: string }>;
    };
  };
}

/**
 * Extract timestamp from a Pi event using a fallback chain.
 *
 * Tries candidate timestamps in this order:
 * 1. Direct event.timestamp
 * 2. event.message.timestamp
 * 3. event.assistantMessageEvent.message.timestamp
 * 4. event.assistantMessageEvent.partial.timestamp
 *
 * Returns the first valid timestamp found, or null if none are valid.
 * Numeric timestamps are assumed to be milliseconds since epoch and converted to ISO 8601 strings.
 *
 * @param event - A Pi event object
 * @returns ISO 8601 string or null if no valid timestamp found
 */
export function extractEventTimestamp(event: PiEvent): string | null {
  const candidates = [
    event.timestamp,
    event.message?.timestamp,
    event.assistantMessageEvent?.message?.timestamp,
    event.assistantMessageEvent?.partial?.timestamp,
  ];

  for (const value of candidates) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
  }

  return null;
}

/**
 * Normalize a timestamp value to ISO 8601 string format.
 *
 * Accepts strings (assumed to be ISO 8601 or epoch), numbers (milliseconds since epoch), or Date objects.
 * Returns undefined for null/undefined inputs.
 *
 * @param timestamp - String, number, Date, or undefined/null
 * @returns ISO 8601 string or undefined
 */
export function normalizeTimestamp(timestamp: string | number | Date | undefined | null): string | undefined {
  if (timestamp === null || timestamp === undefined) return undefined;
  if (timestamp === '') return undefined;

  if (typeof timestamp === 'string') {
    return timestamp;
  }

  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }

  return undefined;
}

/**
 * Safe timestamp extraction with validation.
 *
 * Attempts to extract a valid timestamp using extractEventTimestamp.
 * Falls back to current time if no valid timestamp is found.
 *
 * Always returns a valid ISO 8601 string.
 *
 * @param event - A Pi event object
 * @returns ISO 8601 string (never null)
 */
export function getEventTimestampISO(event: PiEvent): string {
  const extracted = extractEventTimestamp(event);
  return extracted ?? new Date().toISOString();
}
