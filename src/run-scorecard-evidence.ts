import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { number, object, bool } from './run-scorecard-evidence-values';
import { lifecycle, statusFrom } from './run-scorecard-evidence-status';
import type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  // failure.json is written from the terminal worker state and can contain
  // more accurate phase exits than metadata captured before finalization.
  const failure = object(snapshot.json['failure.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const goal = object(snapshot.json['goal-check.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']);
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const stageElapsed = stageRows.reduce((total, row) => total + (number(object(row)?.elapsed_seconds) ?? 0), 0);
  const phaseDurationsMs: Record<string, number> = {};
  const stagePhase = (value: unknown): string | undefined => {
    const stage = String(value ?? '').toLowerCase();
    if (/goal.setting/.test(stage)) return 'goal_setting';
    if (/scouting/.test(stage)) return 'scouting';
    if (/coding/.test(stage)) return 'coding';
    if (/goal.check/.test(stage)) return 'goal_check';
    if (/run.evaluation/.test(stage)) return 'run_evaluation';
    if (/validation/.test(stage)) return 'validation';
    return undefined;
  };
  for (const row of stageRows) {
    const entry = object(row);
    const phase = stagePhase(entry?.stage);
    const seconds = number(entry?.elapsed_seconds);
    if (phase && seconds !== undefined) phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + seconds * 1000;
  }
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const validationRows = [...(Array.isArray(timing.validation_timings) ? timing.validation_timings : []), ...(Array.isArray(timing.pre_validation_timings) ? timing.pre_validation_timings : [])];
  const failureValidationExit = number(failure.validation_exit_code);
  const validation = failureValidationExit !== undefined && failureValidationExit !== 0
    ? 'failed'
    : validationRows.length
      ? validationRows.every(row => (number(object(row)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed'
      : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  const quality = statusFrom(metadata, ['quality_exit_code', 'quality_exit', 'quality_status'], object(metadata.phases)?.quality_gates);
  const tokenEvidence = aggregateTokenUsage(snapshot.summaries);
  const phaseRetries = providerRetryCounts(snapshot);
  const evaluationExit = number(metadata.run_evaluation_exit_code);
  const evaluationWarning = String(metadata.run_evaluation_warning ?? '').trim();
  const goalCheckWarning = String(metadata.goal_check_evaluation_warning ?? '').trim();
  const goalCheckAvailable = Boolean(goal) && goal.evaluation_unavailable !== true && !goalCheckWarning;
  const evaluatorFailed = String(failure.provider_error_phase ?? '').trim() === 'run-evaluation'
    || String(failure.failed_command ?? '').trim() === 'run evaluation';
  const evaluatorAvailable = Boolean(evaluation) && !evaluatorFailed && !(Number.isFinite(evaluationExit) && evaluationExit !== 0)
    && (!evaluationWarning || evaluationWarning === 'run_evaluation_recovered_invalid_artifact');
  return {
    metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, phaseDurationsMs, validation, quality,
    goalMet: goalCheckAvailable ? (bool(goal.met) ?? bool(metadata.goal_check_met)) : undefined,
    goalCheckAvailable,
    goalCheckFailed: !goalCheckAvailable || String(metadata.failed_command ?? '').toLowerCase() === 'goal check'
      || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
