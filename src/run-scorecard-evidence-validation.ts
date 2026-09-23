import { number, object } from './run-scorecard-guards';
import type { StatusValue } from './run-scorecard-evidence-status';
import { statusFrom } from './run-scorecard-evidence-status';

export interface ValidationEvidence {
  validation: StatusValue;
  executedValidationRows: any[];
}

export function collectValidationEvidence(snapshot: any): ValidationEvidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const failure = object(snapshot.json['failure.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const validationRows = Array.isArray(timing.validation_timings) ? timing.validation_timings : [];
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const failureValidationExit = number(failure.validation_exit_code);
  const validationCommandsAttempted = number(metadata.validation_commands_attempted) ?? 0;
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
          ? stageRows.some((row) => String(object(row)?.stage ?? '').trim().toLowerCase() === 'validation'
            && number(object(row)?.exit_code) === 0)
            ? 'passed'
            : 'unknown'
          : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  return { validation, executedValidationRows };
}
