/**
 * Type guard utilities for common type checks.
 * Reduces verbosity and provides reusable predicates across the codebase.
 */

/**
 * Check if value is a string.
 */
export const isString = (value: unknown): value is string => typeof value === 'string';

/**
 * Check if value is a number.
 */
export const isNumber = (value: unknown): value is number => typeof value === 'number';

/**
 * Check if value is a boolean.
 */
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Check if value is a record (plain object).
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Check if value is an array.
 */
export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/**
 * Check if value is an array of strings.
 */
export const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
};

/**
 * Check if value is an array of objects (records).
 */
export const isRecordArray = (value: unknown): value is Record<string, unknown>[] => {
  return Array.isArray(value) && value.every((item) => isRecord(item));
};

/**
 * Check if value is an object with specific keys (shallow validation).
 */
export const hasKeys = (value: unknown, ...keys: string[]): value is Record<string, unknown> => {
  return isRecord(value) && keys.every((key) => key in value);
};
