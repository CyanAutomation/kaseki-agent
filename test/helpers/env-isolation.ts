/**
 * Test Environment Helpers
 *
 * Utilities for managing environment variable isolation in tests.
 */

/**
 * CloudFlare Gateway Metadata Environment Variables
 * These are set by kaseki workers and must be cleaned up in isolation tests
 */
export const CLOUDFLARE_METADATA_ENV_VARS = [
  'KASEKI_INSTANCE',
  'KASEKI_INFERENCE_PHASE',
  'KASEKI_INFERENCE_ATTEMPT',
  'KASEKI_INFERENCE_REQUEST_ID',
] as const;

/**
 * Gateway Configuration Environment Variables
 */
export const GATEWAY_CONFIG_ENV_VARS = [
  'LLM_GATEWAY_URL',
  'LLM_GATEWAY_API_KEY',
  'LLM_GATEWAY_MODEL',
  'LLM_GATEWAY_MAX_OUTPUT_TOKENS',
  'KASEKI_GATEWAY_LOG_PAYLOADS',
] as const;

/**
 * Snapshot environment variable state for restoration
 * @param keys - Environment variable keys to snapshot
 * @returns Object mapping keys to their original values (undefined if not set)
 */
export function snapshotEnv(
  keys: readonly string[]
): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

/**
 * Restore environment variables from a snapshot
 * @param snapshot - Snapshot created by snapshotEnv()
 */
export function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Delete environment variables (for isolation tests)
 * @param keys - Environment variable keys to delete
 */
export function deleteEnv(keys: readonly string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

/**
 * Execute a function with isolated environment variables
 * Automatically snapshots, cleans up, and restores specified variables
 *
 * @example
 * ```typescript
 * await withIsolatedEnv(
 *   CLOUDFLARE_METADATA_ENV_VARS,
 *   async () => {
 *     // Test code here - metadata vars are deleted
 *     registerGatewayProvider(mockPi);
 *     expect(mockPi.registerProvider).toHaveBeenCalledWith(...);
 *   }
 * );
 * // Original values automatically restored
 * ```
 */
export async function withIsolatedEnv<T>(
  keysToDelete: readonly string[],
  fn: () => T | Promise<T>
): Promise<T> {
  const snapshot = snapshotEnv(keysToDelete);
  deleteEnv(keysToDelete);

  try {
    return await fn();
  } finally {
    restoreEnv(snapshot);
  }
}

/**
 * Execute a synchronous function with isolated environment variables
 * Automatically snapshots, cleans up, and restores specified variables
 *
 * @example
 * ```typescript
 * withIsolatedEnvSync(
 *   CLOUDFLARE_METADATA_ENV_VARS,
 *   () => {
 *     // Test code here - metadata vars are deleted
 *     registerGatewayProvider(mockPi);
 *     expect(mockPi.registerProvider).toHaveBeenCalledWith(...);
 *   }
 * );
 * // Original values automatically restored
 * ```
 */
export function withIsolatedEnvSync<T>(
  keysToDelete: readonly string[],
  fn: () => T
): T {
  const snapshot = snapshotEnv(keysToDelete);
  deleteEnv(keysToDelete);

  try {
    return fn();
  } finally {
    restoreEnv(snapshot);
  }
}
