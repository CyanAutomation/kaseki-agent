import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { number, object, computePhaseDurations } from './run-scorecard-evidence-utils';
import { lifecycle } from './run-scorecard-evidence-status';
import { collectGoalCheckEvidence } from './run-scorecard-evidence-goal-check';
import { collectValidationEvidence } from './run-scorecard-evidence-validation';
import { collectEvaluationEvidence } from './run-scorecard-evidence-evaluation';
import { detectPhaseReached, detectPhaseFailures } from './run-scorecard-evidence-phases';
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

  const phaseReached = detectPhaseReached(snapshot, metadata, stageRows, {
    evaluation,
    evaluatorFailed,
    noChangeAccepted,
    executedValidationRowsCount: executedValidationRows.length,
    validationExitCode: number(failure.validation_exit_code),
  });
  const phaseFailures = detectPhaseFailures(metadata, failure, evaluatorFailed);
  return {
    metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, phaseDurationsMs, phaseReached, phaseFailures, validation, quality,
    goalMet, goalCheckAvailable, goalCheckFailed, noChangeAccepted,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
