import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { computePhaseDurations } from './run-scorecard-evidence-utils';
import { number, object } from './run-scorecard-guards';
import { lifecycle } from './run-scorecard-evidence-status';
import { collectGoalCheckEvidence } from './run-scorecard-evidence-goal-check';
import { collectValidationEvidence } from './run-scorecard-evidence-validation';
import { collectEvaluationEvidence } from './run-scorecard-evidence-evaluation';
import { detectPhaseReached, detectPhaseFailures } from './run-scorecard-evidence-phases';
import type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

function elapsedSeconds(performanceMetrics: Record<string, unknown>, metadata: Record<string, unknown>, stageElapsed: number): number | undefined {
  return number(performanceMetrics.elapsed_seconds)
    ?? number(metadata.total_duration_seconds)
    ?? number(metadata.duration_seconds)
    ?? (stageElapsed || undefined);
}

function evaluatorFailed(failure: Record<string, unknown>): boolean {
  return String(failure.provider_error_phase ?? '').trim() === 'run-evaluation'
    || String(failure.failed_command ?? '').trim() === 'run evaluation';
}

function noChangeWasAccepted(metadata: Record<string, unknown>, snapshot: ArtifactSnapshot): boolean {
  const explicitlyAccepted = metadata.task_mode === 'inspect'
    || metadata.no_change_accepted === true
    || metadata.allow_empty_diff === '1'
    || metadata.allow_empty_diff === true;
  return lifecycle(metadata) === 'completed'
    && explicitlyAccepted
    && (snapshot.text['git.diff'] ?? '').trim().length === 0;
}

function fallbackUsed(metadata: Record<string, unknown>, artifact: Record<string, unknown>): boolean {
  return metadata.scouting_fallback_used === true
    || artifact.fallback === true
    || (typeof artifact.fallback_reason === 'string' && artifact.fallback_reason.trim().length > 0);
}

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const failure = object(snapshot.json['failure.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const { phaseDurationsMs, stageElapsed, preAgentValidationMs } = computePhaseDurations(stageRows);
  const elapsed = elapsedSeconds(perf, metadata, stageElapsed);
  const { validation, executedValidationRows } = collectValidationEvidence(snapshot);
  const { quality, evaluation, evaluatorAvailable } = collectEvaluationEvidence(snapshot);
  const { goalCheckAvailable, goalCheckFailed, goalMet } = collectGoalCheckEvidence(snapshot);
  const tokenEvidence = aggregateTokenUsage(snapshot.summaries);
  const phaseRetries = providerRetryCounts(snapshot);
  const didEvaluatorFail = evaluatorFailed(failure);
  const noChangeAccepted = noChangeWasAccepted(metadata, snapshot);

  const phaseReached = detectPhaseReached(snapshot, metadata, stageRows, {
    evaluation,
    evaluatorFailed: didEvaluatorFail,
    noChangeAccepted,
    executedValidationRowsCount: executedValidationRows.length,
    validationExitCode: number(failure.validation_exit_code),
  });
  const phaseFailures = detectPhaseFailures(metadata, failure, didEvaluatorFail);
  const goalSetting = object(snapshot.json['goal-setting.json']) ?? {};
  const scouting = object(snapshot.json['scouting.json']) ?? {};
  const goalSettingFallback = metadata.goal_setting_fallback_used === true
    || goalSetting.fallback === true;
  const scoutingFallback = fallbackUsed(metadata, scouting);
  return {
    metadata: {
      ...metadata,
      started_at: metadata.started_at ?? failure.started_at,
      ended_at: metadata.ended_at ?? failure.ended_at,
    },
    status: lifecycle(metadata), elapsedSeconds: elapsed,
    stageElapsedSeconds: stageRows.length ? stageElapsed : undefined,
    preAgentValidationMs,
    ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, phaseDurationsMs, phaseReached, phaseFailures, validation, quality,
    goalMet, goalCheckAvailable, goalCheckFailed, noChangeAccepted,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    goalSettingFallback, scoutingFallback,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
