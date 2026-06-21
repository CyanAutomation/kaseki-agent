/**
 * Run Context - Context enrichment utilities for error tracking
 *
 * Provides helpers to enrich Sentry error events with run-specific context:
 * - Instance ID (kaseki-123)
 * - Operation timing
 * - Task metadata (prompt, repo, branch)
 * - Validation gate names
 * - Agent configuration
 */

/**
 * Represents the context of a kaseki run
 */
export interface RunContext {
  instanceId?: string; // e.g., "kaseki-123"
  repoUrl?: string;
  gitRef?: string;
  taskPrompt?: string;
  model?: string;
  provider?: string;
  timeoutSeconds?: number;
  startTime?: Date;
  phase?: string; // Current execution phase
  validationGates?: string[]; // Gates that failed (if applicable)
}

/**
 * Global context holder for the current run
 * This gets populated during execution and used to enrich errors
 */
let globalRunContext: RunContext = {};

/**
 * Set the global run context for error enrichment
 *
 * @param context - The context to set (can be partial, merges with existing)
 *
 * @example
 * ```typescript
 * setRunContext({
 *   instanceId: 'kaseki-123',
 *   repoUrl: 'https://github.com/org/repo',
 *   gitRef: 'main',
 *   model: 'openrouter/free'
 * });
 * ```
 */
export function setRunContext(context: Partial<RunContext>): void {
  globalRunContext = { ...globalRunContext, ...context };
}

/**
 * Get the current global run context
 *
 * @returns The current global run context
 */
export function getRunContext(): RunContext {
  return { ...globalRunContext };
}

/**
 * Clear the global run context
 * Useful for test isolation or between runs
 */
export function clearRunContext(): void {
  globalRunContext = {};
}

/**
 * Enrich an error context object with run context information
 * Sanitizes sensitive data (API keys, full prompts) to prevent leaks
 *
 * @param errorContext - The error context to enrich
 * @returns The enriched context
 *
 * @example
 * ```typescript
 * const enriched = enrichErrorContext({
 *   command: 'run',
 *   exitCode: 1
 * });
 * // Returns: { command: 'run', exitCode: 1, instanceId: 'kaseki-123', ... }
 * ```
 */
export function enrichErrorContext(errorContext: Record<string, unknown>): Record<string, unknown> {
  const runCtx = getRunContext();

  return {
    ...errorContext,
    run: {
      instanceId: runCtx.instanceId,
      repo: sanitizeUrl(runCtx.repoUrl),
      ref: runCtx.gitRef,
      model: runCtx.model,
      provider: runCtx.provider,
      timeoutSeconds: runCtx.timeoutSeconds,
      phase: runCtx.phase,
      elapsedSeconds: runCtx.startTime ? Math.round((Date.now() - runCtx.startTime.getTime()) / 1000) : undefined,
      failedGates: runCtx.validationGates,
    },
  };
}

/**
 * Sanitize a URL to prevent credential leaks
 * Removes query parameters and password info from URLs
 *
 * @param url - The URL to sanitize
 * @returns The sanitized URL, or undefined if input was undefined
 *
 * @example
 * ```typescript
 * sanitizeUrl('https://user:pass@github.com/org/repo?token=abc');
 * // Returns: 'https://github.com/org/repo'
 * ```
 */
export function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    // Remove auth and search params
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    // If URL parsing fails, return a generic placeholder
    return '<invalid-url>';
  }
}

/**
 * Create a timing marker for measuring operation duration
 *
 * @returns An object with start time and a function to get elapsed time
 *
 * @example
 * ```typescript
 * const timer = createTimer();
 * // ... do work ...
 * console.log(`Elapsed: ${timer.elapsed()}ms`);
 * ```
 */
export function createTimer(): { elapsed: () => number; startTime: Date } {
  const startTime = new Date();

  return {
    startTime,
    elapsed: () => Date.now() - startTime.getTime(),
  };
}

/**
 * Update the current phase in the global context
 * Useful for tracking which stage of execution failed
 *
 * @param phase - The name of the phase (e.g., 'git-clone', 'npm-ci', 'pi-invocation', 'validation')
 *
 * @example
 * ```typescript
 * updatePhase('npm-ci');
 * try {
 *   await runNpmCi();
 * } catch (error) {
 *   // Error will be enriched with phase: 'npm-ci'
 *   captureException(error, enrichErrorContext({}));
 * }
 * ```
 */
export function updatePhase(phase: string): void {
  setRunContext({ phase });
}

/**
 * Record a failed validation gate in the context
 * Useful for tracking which quality gates failed
 *
 * @param gateName - The name of the gate (e.g., 'diff-size', 'secret-scan', 'allowlist')
 *
 * @example
 * ```typescript
 * recordFailedGate('diff-size');
 * recordFailedGate('allowlist');
 * ```
 */
export function recordFailedGate(gateName: string): void {
  const current = getRunContext();
  const gates = current.validationGates || [];
  if (!gates.includes(gateName)) {
    setRunContext({ validationGates: [...gates, gateName] });
  }
}
