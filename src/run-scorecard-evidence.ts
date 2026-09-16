import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { number, object } from './run-scorecard-evidence-values';
import { computePhaseDurations } from './run-scorecard-evidence-helpers';
import { lifecycle } from './run-scorecard-evidence-status';
import { collectGoalCheckEvidence } from './run-scorecard-evidence-goal-check';
import { collectValidationEvidence } from './run-scorecard-evidence-validation';
import { collectEvaluationEvidence } from './run-scorecard-evidence-evaluation';
import type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const failure = object(snapshot.json['failure.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const { phaseDurationsMs, stageElapsed } = computePhaseDurations(stageRows);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const { validation, executedValidationRows } = collectValidationEvidence(snapshot);
  const { quality, evaluation, evaluatorAvailable } = collectEvaluationEvidence(snapshot);
  const { goalCheckAvailable, goalCheckFailed, goalMet } = collectGoalCheckEvidence(snapshot);
  const tokenEvidence = aggregateTokenUsage(snapshot.summaries);
  const phaseRetries = providerRetryCounts(snapshot);
  const evaluatorFailed = String(failure.provider_error_phase ?? '').trim() === 'run-evaluation'
    || String(failure.failed_command ?? '').trim() === 'run evaluation';
  const noChangeAccepted = lifecycle(metadata) === 'completed'
    && (metadata.no_change_accepted === true || metadata.allow_empty_diff === '1' || metadata.allow_empty_diff === true)
    && (snapshot.text['git.diff'] ?? '').trim().length === 0;
  const hasStage = (pattern: RegExp) => stageRows.some(row => pattern.test(String(object(row)?.stage ?? '')));
  const phaseReached = {
    goal_setting: Boolean(snapshot.json['goal-setting.json']) || hasStage(/goal.setting/i) || (number(metadata.goal_setting_duration_seconds) ?? 0) > 0,
    scouting: Boolean(snapshot.json['scouting.json']) || hasStage(/scouting/i) || (number(metadata.scouting_duration_seconds) ?? 0) > 0,
    coding: Boolean(snapshot.json['pi-summary.json']) || Boolean(snapshot.text['pi-events.jsonl']) || hasStage(/pi coding agent/i) || (snapshot.text['git.diff'] ?? '').trim().length > 0 || noChangeAccepted,
    validation: executedValidationRows.length > 0 || (number(metadata.validation_commands_attempted) ?? 0) > 0 || (number(failure.validation_exit_code) !== undefined && number(failure.validation_exit_code) !== 0),
    goal_check: Boolean(snapshot.json['goal-check.json']) || hasStage(/goal check/i) || (number(metadata.goal_check_duration_seconds) ?? 0) > 0 || String(failure.failed_command ?? '').toLowerCase() === 'goal check' || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    run_evaluation: Boolean(evaluation) || hasStage(/run evaluation/i) || (number(metadata.run_evaluation_duration_seconds) ?? 0) > 0 || evaluatorFailed,
  };
  const phaseFailures = {
    goal_setting: (number(failure.goal_setting_exit_code) ?? number(metadata.goal_setting_exit_code) ?? 0) !== 0,
    scouting: (number(failure.scouting_exit_code) ?? number(metadata.scouting_exit_code) ?? 0) !== 0,
    coding: (number(failure.pi_exit_code) ?? number(metadata.pi_exit_code) ?? 0) !== 0,
    validation: (number(failure.validation_exit_code) ?? number(metadata.validation_exit_code) ?? 0) !== 0,
    goal_check: (number(failure.goal_check_exit_code) ?? number(metadata.goal_check_exit_code) ?? 0) !== 0,
    run_evaluation: (number(failure.run_evaluation_exit_code) ?? number(metadata.run_evaluation_exit_code) ?? 0) !== 0 || evaluatorFailed,
  };
  return {
    metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, phaseDurationsMs, phaseReached, phaseFailures, validation, quality,
    goalMet, goalCheckAvailable, goalCheckFailed, noChangeAccepted,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
