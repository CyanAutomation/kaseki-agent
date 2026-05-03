import { TimestampTracker } from './timestamp-tracker';

describe('TimestampTracker', () => {
  it('should record and retrieve first and last ISO timestamps', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00Z');
    tracker.record('2024-01-01T10:05:00Z');
    tracker.record('2024-01-01T10:10:00Z');

    expect(tracker.firstTimestamp()).toBe('2024-01-01T10:00:00Z');
    expect(tracker.lastTimestamp()).toBe('2024-01-01T10:10:00Z');
  });

  it('should return null for first/last when no timestamps recorded', () => {
    const tracker = new TimestampTracker();
    expect(tracker.firstTimestamp()).toBeNull();
    expect(tracker.lastTimestamp()).toBeNull();
  });

  it('should ignore null and empty timestamps', () => {
    const tracker = new TimestampTracker();
    tracker.record(null);
    tracker.record('');

    expect(tracker.firstTimestamp()).toBeNull();
    expect(tracker.lastTimestamp()).toBeNull();
  });

  it('should convert ISO timestamps to epoch milliseconds', () => {
    const tracker = new TimestampTracker();
    const iso = '2024-01-01T00:00:00Z';
    tracker.record(iso);

    const epochMs = tracker.getEpochMs(iso);
    expect(epochMs).toBe(1704067200000);
  });

  it('should return null for malformed timestamps', () => {
    const tracker = new TimestampTracker();
    const malformed = 'not-a-timestamp';

    const epochMs = tracker.getEpochMs(malformed);
    expect(epochMs).toBeNull();
  });

  it('should handle malformed timestamps gracefully during record', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00Z');
    tracker.record('invalid-timestamp');
    tracker.record('2024-01-01T10:05:00Z');

    // Should still track valid timestamps
    expect(tracker.firstTimestamp()).toBe('2024-01-01T10:00:00Z');
    expect(tracker.lastTimestamp()).toBe('2024-01-01T10:05:00Z');
  });

  it('should track min and max epoch milliseconds', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:05:00Z');
    tracker.record('2024-01-01T10:00:00Z');
    tracker.record('2024-01-01T10:10:00Z');

    const firstEpochMs = tracker.firstEpochMs();
    const lastEpochMs = tracker.lastEpochMs();

    // Epoch millis should be min and max across all recorded timestamps
    const expectedMin = new Date('2024-01-01T10:00:00Z').getTime();
    const expectedMax = new Date('2024-01-01T10:10:00Z').getTime();

    expect(firstEpochMs).toBe(expectedMin);
    expect(lastEpochMs).toBe(expectedMax);
  });

  it('should calculate duration in milliseconds between first and last epochs', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00Z');
    tracker.record('2024-01-01T10:05:00Z');

    const duration = tracker.durationMs();
    expect(duration).toBe(5 * 60 * 1000); // 5 minutes in ms
  });

  it('should return null for duration when timestamps are missing', () => {
    const tracker = new TimestampTracker();
    expect(tracker.durationMs()).toBeNull();
  });

  it('should return 0 for duration when only one timestamp is recorded', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00Z');
    // After recording one timestamp, both first and last are the same
    const duration = tracker.durationMs();
    expect(duration).toBe(0);
  });

  it('should return 0 for duration when first and last are the same', () => {
    const tracker = new TimestampTracker();
    const timestamp = '2024-01-01T10:00:00Z';
    tracker.record(timestamp);
    tracker.record(timestamp);

    const duration = tracker.durationMs();
    expect(duration).toBe(0);
  });

  it('should provide complete range information', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00Z');
    tracker.record('2024-01-01T10:05:00Z');

    const range = tracker.range();
    expect(range.first).toBe('2024-01-01T10:00:00Z');
    expect(range.last).toBe('2024-01-01T10:05:00Z');
    expect(range.minEpochMs).toBe(new Date('2024-01-01T10:00:00Z').getTime());
    expect(range.maxEpochMs).toBe(new Date('2024-01-01T10:05:00Z').getTime());
  });

  it('should handle millisecond precision in timestamps', () => {
    const tracker = new TimestampTracker();
    tracker.record('2024-01-01T10:00:00.123Z');
    tracker.record('2024-01-01T10:00:00.456Z');

    const duration = tracker.durationMs();
    expect(duration).toBe(333); // 456 - 123 = 333 ms
  });

  it('should handle numeric epoch timestamps (if converted to ISO)', () => {
    const tracker = new TimestampTracker();
    const isoString = new Date(1704067200000).toISOString();
    tracker.record(isoString);

    expect(tracker.getEpochMs(isoString)).toBe(1704067200000);
  });
});
