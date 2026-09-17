/**
 * Utility functions for extracting and normalizing evidence data types
 * Consolidates evidence-values.ts and evidence-helpers.ts
 * Guard functions (object, number, bool, stagePhase) re-exported from run-scorecard-guards
 */

// Import for use in this file, then re-export for backward compatibility
import { object as guardObject, number as guardNumber, stagePhase as guardStagePhase } from './run-scorecard-guards';

export { object, number, bool, stagePhase } from './run-scorecard-guards';

export function computePhaseDurations(stageRows: unknown[]): { phaseDurationsMs: Record<string, number>; stageElapsed: number } {
  const phaseDurationsMs: Record<string, number> = {};
  let stageElapsed = 0;
  for (const row of Array.isArray(stageRows) ? stageRows : []) {
    const entry = guardObject(row);
    const phase = guardStagePhase(entry?.stage);
    const seconds = guardNumber(entry?.elapsed_seconds);
    if (seconds !== undefined) stageElapsed += seconds;
    if (phase && seconds !== undefined) phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + seconds * 1000;
  }
  return { phaseDurationsMs, stageElapsed };
}
