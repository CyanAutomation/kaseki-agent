/**
 * Tests for Timing Formatter
 *
 * Focused on externally meaningful formatting contracts rather than full
 * serialized output snapshots.
 */

import {
  formatTimingMs,
  formatComponentTiming,
  formatTimingTable,
  detectSlowComponent,
} from './timing-formatter';

describe('Timing Formatter', () => {
  describe('formatTimingMs', () => {
    it('should format durations in milliseconds with one decimal place', () => {
      expect(formatTimingMs(100)).toBe('100.0ms');
      expect(formatTimingMs(1234.567)).toBe('1234.6ms');
    });
  });

  describe('formatComponentTiming', () => {
    it('should include the component name and formatted duration', () => {
      expect(formatComponentTiming('ResultCache', 12.3)).toEqual(
        expect.stringContaining('ResultCache initialized (12.3ms)')
      );
    });

    it('should mark components above the slow threshold', () => {
      const formatted = formatComponentTiming('SlowComponent', 1200, 1000);

      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('above threshold (1000ms)');
    });

    it('should mark components at or below the slow threshold as healthy', () => {
      const formatted = formatComponentTiming('FastComponent', 1000, 1000);

      expect(formatted).toContain('✓');
      expect(formatted).not.toContain('above threshold');
    });
  });

  describe('formatTimingTable', () => {
    it('should include each component name in the table', () => {
      const table = formatTimingTable({
        ResultCache: 12.3,
        WebhookManager: 18.5,
      });

      expect(table).toContain('ResultCache');
      expect(table).toContain('WebhookManager');
    });

    it('should mark slow rows and healthy rows distinctly', () => {
      const table = formatTimingTable({
        FastComponent: 50,
        SlowComponent: 1200,
      });

      // Use regex whitespace (\s+) so the assertions are insensitive to column padding.
      expect(table).toMatch(/✓\s+FastComponent/);
      expect(table).toMatch(/⚠️\s+SlowComponent/);
    });

    it('should include a total duration summary', () => {
      const table = formatTimingTable({
        ResultCache: 12.3,
        WebhookManager: 18.5,
      });

      expect(table).toContain('TOTAL');
      expect(table).toContain('30.8ms');
    });
  });

  // Semantic assertions (behavior, not formatting)
  it('should detect slow vs fast components correctly', () => {
    expect(detectSlowComponent(1200, 1000)).toBe(true);
    expect(detectSlowComponent(900, 1000)).toBe(false);
    expect(detectSlowComponent(1500)).toBe(true); // with default threshold
  });
});
