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
 * Snapshot environment variable state for restoration
 * @param keys - Environment variable keys to snapshot
 * @returns Object mapping keys to their original values (undefined if not set)
 */
function snapshotEnv(
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
function restoreEnv(snapshot: Record<string, string | undefined>): void {
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
function deleteEnv(keys: readonly string[]): void {
  for (const key of keys) {
    delete process.env[key];
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
