/**
 * timestamp-tracker.ts
 *
 * Encapsulates timestamp tracking logic for Pi event stream processing.
 * Safely parses ISO timestamps, tracks min/max values, and converts to epoch milliseconds.
 */

export interface TimestampRange {
  first: string | null;
  last: string | null;
  minEpochMs: number | null;
  maxEpochMs: number | null;
}

/**
 * TimestampTracker manages timestamp observations from an event stream.
 *
 * Responsibilities:
 * - Parse and record ISO 8601 timestamps
 * - Track first and last observed timestamps (as ISO strings)
 * - Track min/max epoch milliseconds for duration calculation
 * - Provide safe conversion from ISO string to epoch milliseconds
 * - Handle malformed timestamps gracefully
 */
export class TimestampTracker {
  private first: string | null = null;
  private last: string | null = null;
  private minEpochMs: number | null = null;
  private maxEpochMs: number | null = null;

  /**
   * Convert ISO 8601 string to epoch milliseconds.
   * Returns null if the string cannot be parsed.
   */
  private parseToEpochMs(timestamp: string | null): number | null {
    if (!timestamp) return null;
    const epochMs = Date.parse(timestamp);
    return Number.isFinite(epochMs) ? epochMs : null;
  }

  /**
   * Record an ISO timestamp observation.
   * Safely handles malformed timestamps by ignoring them.
   */
  record(timestamp: string | null): void {
    if (!timestamp) return;

    // Track first and last as ISO strings
    if (this.first === null) {
      this.first = timestamp;
    }
    this.last = timestamp;

    // Track min/max as epoch milliseconds for duration calculation
    const epochMs = this.parseToEpochMs(timestamp);
    if (epochMs !== null) {
      this.minEpochMs =
        this.minEpochMs === null ? epochMs : Math.min(this.minEpochMs, epochMs);
      this.maxEpochMs =
        this.maxEpochMs === null ? epochMs : Math.max(this.maxEpochMs, epochMs);
    }
  }

  /**
   * Get epoch milliseconds for a given ISO timestamp string.
   * Useful for extracting individual timestamp conversions.
   */
  getEpochMs(timestamp: string | null): number | null {
    return this.parseToEpochMs(timestamp);
  }

  /**
   * Get the first recorded timestamp (ISO string).
   * Returns null if no timestamps have been recorded.
   */
  firstTimestamp(): string | null {
    return this.first;
  }

  /**
   * Get the last recorded timestamp (ISO string).
   * Returns null if no timestamps have been recorded.
   */
  lastTimestamp(): string | null {
    return this.last;
  }

  /**
   * Get the first timestamp as epoch milliseconds.
   * If first timestamp string exists but is malformed, attempts parse; otherwise
   * uses tracked minEpochMs (which may be different if timestamps came from different sources).
   */
  firstEpochMs(): number | null {
    if (this.minEpochMs !== null) return this.minEpochMs;
    if (this.first !== null) return this.parseToEpochMs(this.first);
    return null;
  }

  /**
   * Get the last timestamp as epoch milliseconds.
   * If last timestamp string exists but is malformed, attempts parse; otherwise
   * uses tracked maxEpochMs (which may be different if timestamps came from different sources).
   */
  lastEpochMs(): number | null {
    if (this.maxEpochMs !== null) return this.maxEpochMs;
    if (this.last !== null) return this.parseToEpochMs(this.last);
    return null;
  }

  /**
   * Calculate duration in milliseconds between first and last recorded epochs.
   * Returns null if either bound is missing or invalid.
   */
  durationMs(): number | null {
    const first = this.firstEpochMs();
    const last = this.lastEpochMs();
    if (first === null || last === null) return null;
    return Math.max(0, last - first);
  }

  /**
   * Get complete timestamp range information.
   */
  range(): TimestampRange {
    return {
      first: this.first,
      last: this.last,
      minEpochMs: this.minEpochMs,
      maxEpochMs: this.maxEpochMs,
    };
  }
}
