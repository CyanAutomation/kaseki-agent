import { aggregateTokenUsage, countRetries, providerRetryCounts } from './run-scorecard-evidence-tokens';
import { number, object, bool } from './run-scorecard-evidence-values';
import { lifecycle, statusFrom } from './run-scorecard-evidence-status';
import type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export type { ArtifactSnapshot, Evidence } from './run-scorecard-evidence-types';

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const goal = object(snapshot.json['goal-check.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']);
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const stageElapsed = stageRows.reduce((total, row) => total + (number(object(row)?.elapsed_seconds) ?? 0), 0);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const validationRows = [...(Array.isArray(timing.validation_timings) ? timing.validation_timings : []), ...(Array.isArray(timing.pre_validation_timings) ? timing.pre_validation_timings : [])];
  const validation = validationRows.length
    ? validationRows.every(row => (number(object(row)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed'
    : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  const quality = statusFrom(metadata, ['quality_exit_code', 'quality_exit', 'quality_status'], object(metadata.phases)?.quality_gates);
  const tokenEvidence = aggregateTokenUsage(snapshot.summaries);
  const phaseRetries = providerRetryCounts(snapshot);
  const evaluationExit = number(metadata.run_evaluation_exit_code);
  const evaluationWarning = String(metadata.run_evaluation_warning ?? '').trim();
  const evaluatorAvailable = Boolean(evaluation) && !(Number.isFinite(evaluationExit) && evaluationExit !== 0)
    && (!evaluationWarning || evaluationWarning === 'run_evaluation_recovered_invalid_artifact');
  return {
    metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, ...tokenEvidence,
    retries: countRetries(snapshot), phaseRetries, validation, quality,
    goalMet: bool(goal.met) ?? bool(metadata.goal_check_met),
    goalCheckFailed: String(metadata.failed_command ?? '').toLowerCase() === 'goal check'
      || String(metadata.goal_check_failure_reason ?? '').trim().length > 0,
    changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length,
    diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, evaluatorAvailable,
    present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)],
  };
}
