/**
 * Utility functions for extracting and normalizing evidence data types
 * Consolidates evidence-values.ts and evidence-helpers.ts
 */

// Import for use in this file
import { object as guardObject, number as guardNumber, stagePhase as guardStagePhase } from './run-scorecard-guards';

export function computePhaseDurations(stageRows: unknown[]): { phaseDurationsMs: Record<string, number>; stageElapsed: number; preAgentValidationMs: number } {
  const phaseDurationsMs: Record<string, number> = {};
  let stageElapsed = 0;
  let preAgentValidationMs = 0;
  for (const row of Array.isArray(stageRows) ? stageRows : []) {
    const entry = guardObject(row);
    const seconds = guardNumber(entry?.elapsed_seconds);
    const stage = String(entry?.stage ?? '').toLowerCase();
    if (seconds !== undefined) stageElapsed += seconds;
    if (/pre[- ]agent validation/.test(stage) && seconds !== undefined) {
      preAgentValidationMs += seconds * 1000;
      continue;
    }
    const phase = guardStagePhase(entry?.stage);
    if (phase && seconds !== undefined) phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + seconds * 1000;
  }
  return { phaseDurationsMs, stageElapsed, preAgentValidationMs };
}
