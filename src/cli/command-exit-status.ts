/**
 * Command exit status mapping for a run's exit code.
 *
 * Both the status and the report command must exit 0 when a run finished
 * successfully (exit code 0 or no recorded exit code) and 1 otherwise.
 */

export function exitStatusForRun(exitCode: number | undefined): number {
  return exitCode === undefined || exitCode === 0 ? 0 : 1;
}
