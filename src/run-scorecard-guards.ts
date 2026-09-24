/**
 * Type guard functions for evidence data
 * Extracted from run-scorecard-evidence-utils for cleaner separation of concerns
 */

export const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const bool = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined;

export function stagePhase(value: unknown): string | undefined {
  const stage = String(value ?? '').toLowerCase();
  if (/pre[- ]agent validation/.test(stage)) return undefined;
  if (/goal.setting/.test(stage)) return 'goal_setting';
  if (/scouting/.test(stage)) return 'scouting';
  if (/coding/.test(stage)) return 'coding';
  if (/goal.check/.test(stage)) return 'goal_check';
  if (/run.evaluation/.test(stage)) return 'run_evaluation';
  if (/validation/.test(stage)) return 'validation';
  return undefined;
}
