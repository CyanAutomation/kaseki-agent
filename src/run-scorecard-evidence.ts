import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { number, object, bool } from './run-scorecard-evidence-values';
import { computePhaseDurations } from './run-scorecard-evidence-helpers';
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
  const { phaseDurationsMs, stageElapsed } = computePhaseDurations(stageRows);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  // Only post-change validation can support the validation score. Baseline
  // checks are useful diagnostics, but mixing them in can claim a successful
  // validation stage even when the run stopped before it executed one.
  const validationRows = Array.isArray(timing.validation_timings) ? timing.validation_timings : [];
  const failureValidationExit = number(failure.validation_exit_code);
  const validationCommandsAttempted = number(metadata.validation_commands_attempted);
  const executedValidationRows = validationRows.filter((row) => {
    const item = object(row);
    return !String(item?.details ?? item?.detail ?? item?.status ?? '').includes('skipped=missing_npm_script')
      && String(item?.status ?? '') !== 'skipped';
  });
  const validation = failureValidationExit !== undefined && failureValidationExit !== 0
    ? 'failed'
    : executedValidationRows.length
      ? executedValidationRows.every(row => (number(object(row)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed'
      : validationRows.length
        ? 'unknown'
        : validationCommandsAttempted === 0
          ? 'unknown'
          : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  const quality = statusFrom(metadata, ['quality_exit_code', 'quality_exit', 'quality_status'], object(metadata.phases)?.quality_gates);
  const tokenEvidence = aggregateTokenUsage(snapshot.summaries);
  const phaseRetries = providerRetryCounts(snapshot);
  const evaluationExit = number(metadata.run_evaluation_exit_code);
  const evaluationWarning = String(metadata.run_evaluation_warning ?? '').trim();
  const goalCheckWarning = String(metadata.goal_check_evaluation_warning ?? '').trim();
  const goalCheckAvailable = Boolean(goal) && goal.evaluation_unavailable !== true
    && (!goalCheckWarning || goalCheckWarning.startsWith('goal_check_deterministic_fallback:'));
  const evaluatorFailed = String(failure.provider_error_phase ?? '').trim() === 'run-evaluation'
    || String(failure.failed_command ?? '').trim() === 'run evaluation';
  const evaluatorAvailable = Boolean(evaluation) && !evaluatorFailed && !(Number.isFinite(evaluationExit) && evaluationExit !== 0)
    && (!evaluationWarning || evaluationWarning === 'run_evaluation_recovered_invalid_artifact');
  const noChangeAccepted = lifecycle(metadata) === 'completed'
    && (metadata.no_change_accepted === true || metadata.allow_empty_diff === '1' || metadata.allow_empty_diff === true)
    && (snapshot.text['git.diff'] ?? '').trim().length === 0;
  const hasStage = (pattern: RegExp) => stageRows.some(row => pattern.test(String(object(row)?.stage ?? '')));
  const phaseReached = {
    goal_setting: Boolean(snapshot.json['goal-setting.json']) || hasStage(/goal.setting/i) || (number(metadata.goal_setting_duration_seconds) ?? 0) > 0,
    scouting: Boolean(snapshot.json['scouting.json']) || hasStage(/scouting/i) || (number(metadata.scouting_duration_seconds) ?? 0) > 0,
    coding: Boolean(snapshot.json['pi-summary.json']) || Boolean(snapshot.text['pi-events.jsonl']) || hasStage(/pi coding agent/i) || (snapshot.text['git.diff'] ?? '').trim().length > 0 || noChangeAccepted,
    validation: executedValidationRows.length > 0 || (number(metadata.validation_commands_attempted) ?? 0) > 0 || (failureValidationExit !== undefined && failureValidationExit !== 0),
    goal_check: Boolean(snapshot.json['goal-check.json']) || hasStage(/goal check/i) || (number(metadata.goal_check_duration_seconds) ?? 0) > 0 || String(failure.failed_command ?? '').toLowerCase() === 'goal check' || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    run_evaluation: Boolean(evaluation) || hasStage(/run evaluation/i) || (number(metadata.run_evaluation_duration_seconds) ?? 0) > 0 || evaluatorFailed,
  };
  return {
    metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, phaseDurationsMs, phaseReached, validation, quality,
    goalMet: goalCheckAvailable ? (bool(goal.met) ?? bool(metadata.goal_check_met)) : undefined,
    goalCheckAvailable,
    goalCheckFailed: !goalCheckAvailable || String(metadata.failed_command ?? '').toLowerCase() === 'goal check'
      || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    noChangeAccepted,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
