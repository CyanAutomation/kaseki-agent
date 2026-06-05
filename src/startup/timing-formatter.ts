/**
 * Timing Formatter
 *
 * Provides consistent formatting for startup timing data across all components
 * - Milliseconds internally
 * - Human-friendly display (ms or seconds as appropriate)
 * - Visual indicators for slow components
 */

/**
 * Format milliseconds as human-readable string
 * Uses ms for all values, with appropriate precision
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "123.4ms"
 */
export function formatTimingMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

/**
 * Detect if a component took longer than threshold
 *
 * @param durationMs - Duration in milliseconds
 * @param thresholdMs - Threshold in milliseconds (default 1000ms)
 * @returns true if duration exceeds threshold
 */
export function detectSlowComponent(
  durationMs: number,
  thresholdMs: number = 1000
): boolean {
  return durationMs > thresholdMs;
}

/**
 * Format a single component's timing with status indicator
 *
 * @param name - Component name
 * @param durationMs - Duration in milliseconds
 * @param thresholdMs - Slow component threshold (default 1000ms)
 * @returns Formatted string like "✓ ResultCache (12.3ms)" or "⚠️ SlowComponent (1.2s) — above threshold"
 */
export function formatComponentTiming(
  name: string,
  durationMs: number,
  thresholdMs: number = 1000
): string {
  const formatted = formatTimingMs(durationMs);
  const isSlow = detectSlowComponent(durationMs, thresholdMs);

  if (isSlow) {
    return `⚠️  ${name} initialized (${formatted}) — above threshold (${thresholdMs}ms)`;
  }

  return `✓ ${name} initialized (${formatted})`;
}

/**
 * Format multiple components as an ASCII table
 *
 * @param components - Map of component names to durations in ms
 * @returns ASCII table string with all components and summary
 */
export function formatTimingTable(components: Record<string, number>): string {
  const lines: string[] = [];

  // Header
  lines.push('Component'.padEnd(30) + 'Duration');
  lines.push('-'.repeat(50));

  // Rows
  let total = 0;
  for (const [name, durationMs] of Object.entries(components)) {
    const formatted = formatTimingMs(durationMs);
    const isSlow = detectSlowComponent(durationMs);
    const icon = isSlow ? '⚠️ ' : '✓ ';

    lines.push(
      `${icon}${name.padEnd(28)} ${formatted.padStart(10)}`
    );
    total += durationMs;
  }

  // Summary
  lines.push('-'.repeat(50));
  lines.push(`${'TOTAL'.padEnd(30)} ${formatTimingMs(total).padStart(10)}`);

  return lines.join('\n');
}

/**
 * Create a summary line showing all components with status
 *
 * @param bootstrapMs - Bootstrap duration
 * @param preflightMs - Preflight duration
 * @returns Summary line like "Bootstrap: 156ms | Preflight: 42ms | Total: 198ms"
 */
export function formatBootstrapSummary(bootstrapMs: number, preflightMs: number): string {
  const total = bootstrapMs + preflightMs;
  return (
    `Bootstrap: ${formatTimingMs(bootstrapMs)} | ` +
    `Preflight: ${formatTimingMs(preflightMs)} | ` +
    `Total: ${formatTimingMs(total)}`
  );
}

/**
 * Highlight slow checks with visual indicator
 *
 * @param checkName - Check name
 * @param durationMs - Duration in milliseconds
 * @param thresholdMs - Slow check threshold (default 100ms)
 * @returns Formatted string with status
 */
export function formatCheckTiming(
  checkName: string,
  durationMs: number,
  thresholdMs: number = 100
): string {
  const formatted = formatTimingMs(durationMs);
  const isSlow = durationMs > thresholdMs;

  if (isSlow) {
    return `⚠️ ${checkName} (${formatted}) — slow`;
  }

  return `✓ ${checkName} (${formatted})`;
}
