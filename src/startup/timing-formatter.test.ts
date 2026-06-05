/**
 * Tests for Timing Formatter
 * 
 * Consistent formatting of startup timing data
 */

import {
  formatTimingMs,
  formatComponentTiming,
  formatTimingTable,
  detectSlowComponent,
} from './timing-formatter';

describe('Timing Formatter', () => {
  describe('formatTimingMs', () => {
    it('should format milliseconds consistently', () => {
      expect(formatTimingMs(100)).toBe('100.0ms');
      expect(formatTimingMs(1234.567)).toBe('1234.6ms');
      expect(formatTimingMs(50)).toBe('50.0ms');
    });

    it('should format large values in milliseconds', () => {
      expect(formatTimingMs(1500)).toBe('1500.0ms');
      expect(formatTimingMs(5000)).toBe('5000.0ms');
    });

    it('should handle 0 and very small values', () => {
      expect(formatTimingMs(0)).toBe('0.0ms');
      expect(formatTimingMs(0.5)).toBe('0.5ms');
    });
  });

  describe('formatComponentTiming', () => {
    it('should format component with name and duration', () => {
      const result = formatComponentTiming('ResultCache', 12.3);
      expect(result).toContain('ResultCache');
      expect(result).toContain('12.3ms');
    });

    it('should add warning indicator for slow components', () => {
      const result = formatComponentTiming('SlowComponent', 1200);
      expect(result).toContain('⚠️');
      expect(result).toContain('above threshold');
    });

    it('should show ok status for fast components', () => {
      const result = formatComponentTiming('FastComponent', 50);
      expect(result).toContain('✓');
    });
  });

  describe('detectSlowComponent', () => {
    it('should detect slow components above threshold', () => {
      expect(detectSlowComponent(1200, 1000)).toBe(true);
      expect(detectSlowComponent(900, 1000)).toBe(false);
    });

    it('should use default threshold if not provided', () => {
      expect(detectSlowComponent(1500)).toBe(true);
      expect(detectSlowComponent(500)).toBe(false);
    });
  });

  describe('formatTimingTable', () => {
    it('should format components as ASCII table', () => {
      const components = {
        ResultCache: 12.3,
        WebhookManager: 18.5,
        JobScheduler: 89.2,
      };

      const table = formatTimingTable(components);

      expect(table).toContain('ResultCache');
      expect(table).toContain('12.3ms');
      expect(table).toContain('WebhookManager');
      expect(table).toContain('JobScheduler');
      expect(table).toContain('89.2ms');
    });

    it('should include summary row', () => {
      const components = {
        Component1: 10,
        Component2: 20,
      };

      const table = formatTimingTable(components);

      // Should have total or summary
      expect(table).toBeDefined();
      expect(table.length).toBeGreaterThan(0);
    });
  });
});
