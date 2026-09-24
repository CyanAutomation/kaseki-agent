import { number, object } from './run-scorecard-guards';
import type { StatusValue } from './run-scorecard-evidence-status';
import { statusFrom } from './run-scorecard-evidence-status';
import { latestValidationResults } from './validation-evidence';

export interface ValidationEvidence {
  validation: StatusValue;
  executedValidationRows: any[];
}

export function collectValidationEvidence(snapshot: any): ValidationEvidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const failure = object(snapshot.json['failure.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const validationRows = Array.isArray(timing.validation_timings) ? timing.validation_timings : [];
  const failureValidationExit = number(failure.validation_exit_code);
  const phases = object(metadata.phases) ?? {};
  const phaseValidation = object(phases.validation) ?? {};
  const phaseResults = Array.isArray(phaseValidation.results) ? phaseValidation.results : [];
  const latestRows = latestValidationResults(phaseResults, validationRows);
  const executedRows = latestRows.filter((row) => row.status !== 'skipped'
    && !String(row.details ?? row.detail ?? '').includes('skipped=missing_npm_script'));
  const validationCommandsAttempted = Math.max(
    number(metadata.validation_commands_attempted) ?? 0,
    number(phaseValidation.commands_attempted) ?? 0,
    executedRows.length,
  );
  const executedValidationRows = executedRows;
  const validation = failureValidationExit !== undefined && failureValidationExit !== 0
    ? 'failed'
    : executedValidationRows.some((row) => row.status === 'failed' || (number(object(row)?.exit_code) !== undefined && number(object(row)?.exit_code) !== 0))
      ? 'failed'
      : executedValidationRows.length && executedValidationRows.every((row) => row.status === 'passed' || number(object(row)?.exit_code) === 0)
        ? 'passed'
        : latestRows.length > 0
          ? 'unknown'
          : validationCommandsAttempted === 0
            ? 'unknown'
            : statusFrom(metadata, ['validation_exit_code', 'validation_exit', 'validation_status']);
  return { validation, executedValidationRows };
}
