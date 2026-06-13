/**
 * Tests for Timing Formatter
 *
 * Collapsed into snapshot and semantic tests to reduce test maintenance cost.
 * Low-value formatting utility tests combined into minimal coverage.
 */

import {
  formatTimingMs,
  formatComponentTiming,
  formatTimingTable,
  detectSlowComponent,
} from './timing-formatter';

describe('Timing Formatter', () => {
  // Snapshot test for overall format consistency across all functions
  it('should produce consistent formatted output', () => {
    const components = {
      ResultCache: 12.3,
      WebhookManager: 18.5,
      JobScheduler: 89.2,
    };

    expect({
      ms100: formatTimingMs(100),
      ms1234: formatTimingMs(1234.567),
      component: formatComponentTiming('ResultCache', 12.3),
      slowComponent: formatComponentTiming('SlowComponent', 1200),
      fastComponent: formatComponentTiming('FastComponent', 50),
      table: formatTimingTable(components),
    }).toMatchSnapshot();
  });

  // Semantic assertions (behavior, not formatting)
  it('should detect slow vs fast components correctly', () => {
    expect(detectSlowComponent(1200, 1000)).toBe(true);
    expect(detectSlowComponent(900, 1000)).toBe(false);
    expect(detectSlowComponent(1500)).toBe(true); // with default threshold
  });
});
