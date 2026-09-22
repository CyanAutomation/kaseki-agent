/**
 * Shared environment variable parsing utilities.
 */

/**
 * Parse a positive integer from an environment variable.
 * Falls back to defaultValue when the env var is unset, empty,
 * non-numeric, zero, negative, or not a finite number.
 */
export function parsePositiveInt(
  name: string,
  defaultValue: number,
): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}
