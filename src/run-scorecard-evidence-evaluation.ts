import { number, object } from './run-scorecard-evidence-utils';
import type { StatusValue } from './run-scorecard-evidence-status';
import { statusFrom } from './run-scorecard-evidence-status';

export interface EvaluationEvidence {
  quality: StatusValue;
  evaluation: any;
  evaluatorAvailable: boolean;
}

export function collectEvaluationEvidence(snapshot: any): EvaluationEvidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const failure = object(snapshot.json['failure.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']);
  const evaluationExit = number(metadata.run_evaluation_exit_code);
  const evaluationWarning = String(metadata.run_evaluation_warning ?? '').trim();
  const evaluatorFailed = String(failure.provider_error_phase ?? '').trim() === 'run-evaluation'
    || String(failure.failed_command ?? '').trim() === 'run evaluation';
  const quality = statusFrom(metadata, ['quality_exit_code', 'quality_exit', 'quality_status'], object(metadata.phases)?.quality_gates);
  const evaluatorAvailable = Boolean(evaluation) && !evaluatorFailed && !(Number.isFinite(evaluationExit) && evaluationExit !== 0)
    && (!evaluationWarning || evaluationWarning === 'run_evaluation_recovered_invalid_artifact');
  return { quality, evaluation, evaluatorAvailable };
}
