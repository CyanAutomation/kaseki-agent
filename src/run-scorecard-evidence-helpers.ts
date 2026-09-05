import { number, object } from './run-scorecard-evidence-values';

export function stagePhase(value: unknown): string | undefined {
  const stage = String(value ?? '').toLowerCase();
  if (/goal.setting/.test(stage)) return 'goal_setting';
  if (/scouting/.test(stage)) return 'scouting';
  if (/coding/.test(stage)) return 'coding';
  if (/goal.check/.test(stage)) return 'goal_check';
  if (/run.evaluation/.test(stage)) return 'run_evaluation';
  if (/validation/.test(stage)) return 'validation';
  return undefined;
}

export function computePhaseDurations(stageRows: unknown[]): { phaseDurationsMs: Record<string, number>; stageElapsed: number } {
  const phaseDurationsMs: Record<string, number> = {};
  let stageElapsed = 0;
  for (const row of Array.isArray(stageRows) ? stageRows : []) {
    const entry = object(row);
    const phase = stagePhase(entry?.stage);
    const seconds = number(entry?.elapsed_seconds);
    if (seconds !== undefined) stageElapsed += seconds;
    if (phase && seconds !== undefined) phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + seconds * 1000;
  }
  return { phaseDurationsMs, stageElapsed };
}
