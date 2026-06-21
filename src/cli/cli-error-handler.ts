/**
 * CLI Error Handler
 *
 * Captures CLI errors and reports them to Sentry with rich context.
 * Provides a wrapper function for error-safe CLI execution and utilities
 * for capturing errors with command context.
 */

import { captureException } from '../sentry-integration';

/**
 * Error context for CLI operations
 */
export interface CLIErrorContext {
  command?: string;
  args?: string[];
  exitCode?: number;
  phase?: string;
  duration?: number;
}

/**
 * Wraps a CLI command execution and captures errors to Sentry
 *
 * @param commandName - Name of the CLI command being executed
 * @param executeFunc - Async function that executes the command and returns an exit code
 * @param context - Additional context to attach to the error
 * @returns The exit code from the command or 1 if an error occurred
 *
 * @example
 * ```typescript
 * const exitCode = await wrapCLIExecution('run', async () => {
 *   return await runCommand.execute(args);
 * }, { args });
 * ```
 */
export async function wrapCLIExecution(
  commandName: string,
  executeFunc: () => Promise<number>,
  context?: Partial<CLIErrorContext>
): Promise<number> {
  const startTime = Date.now();

  try {
    const exitCode = await executeFunc();
    return exitCode;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorContext: CLIErrorContext = {
      command: commandName,
      duration,
      ...context,
    };

    captureException(error, {
      cli: errorContext,
      type: 'cli_error',
    });

    return 1;
  }
}

/**
 * Captures a CLI error with context
 *
 * @param error - The error that occurred
 * @param commandName - Name of the command where the error occurred
 * @param context - Additional context (args, exit code, phase, etc.)
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   captureCLIError(error, 'run', { args, exitCode: 1 });
 * }
 * ```
 */
export function captureCLIError(
  error: unknown,
  commandName: string,
  context?: Partial<CLIErrorContext>
): void {
  const errorContext: CLIErrorContext = {
    command: commandName,
    ...context,
  };

  captureException(error, {
    cli: errorContext,
    type: 'cli_error',
  });
}

/**
 * Marks the start of a CLI operation phase for timing tracking
 *
 * @returns A function to call when the phase completes (returns duration in ms)
 *
 * @example
 * ```typescript
 * const endPhase = startCLIPhase();
 * // ... do work ...
 * const duration = endPhase();
 * ```
 */
export function startCLIPhase(): () => number {
  const startTime = Date.now();
  return () => Date.now() - startTime;
}

/**
 * Enriches a CLI error context with timing information
 *
 * @param context - The CLI error context to enrich
 * @param phase - The phase that failed
 * @param duration - Duration of the phase in milliseconds
 * @returns The enriched context
 */
export function enrichCLIErrorContext(
  context: CLIErrorContext,
  phase: string,
  duration: number
): CLIErrorContext {
  return {
    ...context,
    phase,
    duration,
  };
}
