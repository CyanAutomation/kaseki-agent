import { extractEventTimestamp, normalizeTimestamp, getEventTimestampISO, PiEvent } from './event-timestamp-helpers';

describe('event-timestamp-helpers', () => {
  describe('extractEventTimestamp', () => {
    it('should extract direct event.timestamp as string', () => {
      const event: PiEvent = { timestamp: '2026-05-11T12:00:00Z' };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should extract direct event.timestamp as number and convert to ISO', () => {
      const ms = 1747046400000; // 2026-05-11T12:00:00Z
      const event: PiEvent = { timestamp: ms };
      const result = extractEventTimestamp(event);
      expect(result).toBe(new Date(ms).toISOString());
    });

    it('should extract message.timestamp as fallback', () => {
      const event: PiEvent = {
        message: { timestamp: '2026-05-11T12:00:00Z' },
      };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should extract assistantMessageEvent.message.timestamp as fallback', () => {
      const event: PiEvent = {
        assistantMessageEvent: {
          message: { timestamp: '2026-05-11T12:00:00Z' },
        },
      };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should extract assistantMessageEvent.partial.timestamp as last fallback', () => {
      const event: PiEvent = {
        assistantMessageEvent: {
          partial: { timestamp: '2026-05-11T12:00:00Z' },
        },
      };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should follow fallback chain and return first valid value', () => {
      const event: PiEvent = {
        timestamp: '2026-05-11T12:00:00Z',
        message: { timestamp: '2026-05-11T13:00:00Z' }, // ignored
      };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should return null for event with no timestamp', () => {
      const event: PiEvent = {};
      expect(extractEventTimestamp(event)).toBeNull();
    });

    it('should ignore invalid numeric timestamps', () => {
      const event: PiEvent = { timestamp: NaN };
      expect(extractEventTimestamp(event)).toBeNull();
    });

    it('should ignore Infinity timestamps', () => {
      const event: PiEvent = { timestamp: Infinity };
      expect(extractEventTimestamp(event)).toBeNull();
    });

    it('should handle empty candidate array', () => {
      const event: PiEvent = {
        assistantMessageEvent: {},
      };
      expect(extractEventTimestamp(event)).toBeNull();
    });

    it('should convert numeric timestamp from milliseconds', () => {
      const ms = new Date('2026-05-11T12:00:00Z').getTime();
      const event: PiEvent = { timestamp: ms };
      const result = extractEventTimestamp(event);
      expect(result).toEqual(new Date(ms).toISOString());
    });

    it('should prefer string over numeric timestamp at same level', () => {
      const event: PiEvent = {
        timestamp: '2026-05-11T12:00:00Z',
      };
      expect(extractEventTimestamp(event)).toBe('2026-05-11T12:00:00Z');
    });
  });

  describe('normalizeTimestamp', () => {
    it('should return string timestamps unchanged', () => {
      expect(normalizeTimestamp('2026-05-11T12:00:00Z')).toBe('2026-05-11T12:00:00Z');
    });

    it('should convert numeric timestamps to ISO string', () => {
      const ms = 1747046400000;
      expect(normalizeTimestamp(ms)).toBe(new Date(ms).toISOString());
    });

    it('should convert Date objects to ISO string', () => {
      const date = new Date('2026-05-11T12:00:00Z');
      expect(normalizeTimestamp(date)).toBe(date.toISOString());
    });

    it('should return undefined for null', () => {
      expect(normalizeTimestamp(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
      expect(normalizeTimestamp(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(normalizeTimestamp('')).toBeUndefined();
    });

    it('should ignore invalid numbers', () => {
      expect(normalizeTimestamp(NaN)).toBeUndefined();
      expect(normalizeTimestamp(Infinity)).toBeUndefined();
    });

    it('should handle zero timestamp', () => {
      const result = normalizeTimestamp(0);
      expect(result).toBe(new Date(0).toISOString());
    });
  });

  describe('getEventTimestampISO', () => {
    it('should return extracted timestamp when available', () => {
      const event: PiEvent = { timestamp: '2026-05-11T12:00:00Z' };
      expect(getEventTimestampISO(event)).toBe('2026-05-11T12:00:00Z');
    });

    it('should return current time when no timestamp available', () => {
      const event: PiEvent = {};
      const beforeCall = Date.now();
      const result = getEventTimestampISO(event);
      const afterCall = Date.now();

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const parsed = Date.parse(result);
      expect(Number.isNaN(parsed)).toBe(false);
      expect(parsed).toBeGreaterThanOrEqual(beforeCall);
      expect(parsed).toBeLessThanOrEqual(afterCall);
    });

    it('should use fallback chain if direct timestamp missing', () => {
      const event: PiEvent = {
        message: { timestamp: '2026-05-11T12:00:00Z' },
      };
      expect(getEventTimestampISO(event)).toBe('2026-05-11T12:00:00Z');
    });
  });
});
