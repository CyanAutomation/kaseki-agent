/**
 * Phase Diagnostic Extractor
 *
 * Extracts and analyzes diagnostic information from validation errors
 * across different phases (goal-setting, scouting, goal-check).
 */

import { StatusResponse } from '../kaseki-api-types';

type PhaseDiagnostic = {
  phase: 'goal-setting' | 'scouting' | 'goal-check';
  severity?: string;
  reason?: string;
  field?: string;
  detail?: string;
  suggestion?: string;
  recovered?: boolean;
};

function isRecoveredReason(reason: string | undefined): boolean {
  return Boolean(reason?.endsWith('_recovered'));
}

function isRecoveryMarker(diagnostic: PhaseDiagnostic): boolean {
  return diagnostic.recovered === true || isRecoveredReason(diagnostic.reason);
}

function isFallbackContextReason(reason: string | undefined): boolean {
  return Boolean(reason && (
    reason === 'patch_fallback' ||
    reason === 'inspect_fallback' ||
    reason.includes('missing_candidate') ||
    reason === 'missing_file'
  ));
}

/**
 * Clean diagnostic text by removing ANSI codes and normalizing whitespace
 */
function cleanDiagnosticText(value: string, ansiPattern: RegExp): string {
  return value.replace(ansiPattern, '').replace(/\s+/g, ' ').trim();
}

/**
 * Extract string field from error object
 */
function stringField(record: Record<string, unknown>, key: string, ansiPattern: RegExp): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? cleanDiagnosticText(value, ansiPattern) : undefined;
}

/**
 * Extract phase diagnostics from validation errors
 */
export function phaseDiagnosticsFromErrors(
  phase: PhaseDiagnostic['phase'],
  errors: Array<Record<string, unknown>> | undefined,
  ansiPattern: RegExp
): PhaseDiagnostic[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.slice(0, 5).map((error) => {
    const reason = stringField(error, 'reason_code', ansiPattern) ?? stringField(error, 'reason', ansiPattern);
    const actual = stringField(error, 'actual', ansiPattern);
    const expected = stringField(error, 'expected', ansiPattern);
    const detail = [reason, actual ? `actual: ${actual}` : undefined, expected ? `expected: ${expected}` : undefined]
      .filter(Boolean)
      .join('; ');
    return {
      phase,
      ...(stringField(error, 'severity', ansiPattern) ? { severity: stringField(error, 'severity', ansiPattern) } : {}),
      ...(reason ? { reason } : {}),
      ...(stringField(error, 'field', ansiPattern) ? { field: stringField(error, 'field', ansiPattern) } : {}),
      ...(detail ? { detail: cleanDiagnosticText(detail, ansiPattern) } : {}),
      ...(stringField(error, 'suggestion', ansiPattern) ? { suggestion: cleanDiagnosticText(stringField(error, 'suggestion', ansiPattern) as string, ansiPattern) } : {}),
      ...(error.recovered === true || error.recovered === 'true' || isRecoveredReason(reason) ? { recovered: true } : {}),
    };
  });
}

/**
 * Filter phase diagnostics based on primary reason
 */
export function filterPhaseDiagnostics(
  phaseDiagnostics: PhaseDiagnostic[],
  primaryReason: string | undefined,
  hasTerminalPrimaryReason = isProviderPrimaryReason(primaryReason ?? '')
): PhaseDiagnostic[] {
  if (!primaryReason || !hasTerminalPrimaryReason) {
    return phaseDiagnostics;
  }

  const recoveryMarkers = phaseDiagnostics.filter(isRecoveryMarker);
  return phaseDiagnostics.filter((diagnostic) => {
    if (isRecoveryMarker(diagnostic)) {
      return false;
    }

    if (isProviderPrimaryReason(primaryReason) && diagnostic.reason === 'placeholder_content') {
      return false;
    }

    if (!isFallbackContextReason(diagnostic.reason)) {
      return true;
    }

    return !recoveryMarkers.some((marker) =>
      marker.phase === diagnostic.phase &&
      (!marker.field || !diagnostic.field || marker.field === diagnostic.field)
    );
  });
}

/**
 * Check if primary reason is a provider error
 */
function isProviderPrimaryReason(primaryReason: string): boolean {
  return /provider_error|model_unavailable|OpenAI API error|Bad Gateway|gateway/i.test(primaryReason);
}

/**
 * Resolve primary diagnostic reason from multiple sources
 */
export function resolvePrimaryDiagnosticReason(
  response: StatusResponse,
  phaseDiagnostics: PhaseDiagnostic[],
  formatStructuredProviderError: (value: unknown) => string | undefined,
  formatProviderError: (failureJson: Record<string, unknown>) => string | undefined,
  extractTerminalRuntimeError: (failureJson: Record<string, unknown>) => string | undefined,
  cleanDiagnosticTextFn: (value: string) => string
): string | undefined {
  const failureJson = response.failureJsonContent ?? {};
  const candidates = [
    formatStructuredProviderError(failureJson.provider_error_primary),
    formatProviderError(failureJson),
    response.goalCheckFailureReason,
    response.validationAllowlistFailureReason,
    response.validationFailureReason,
    response.qualityFailureReason,
    typeof failureJson.goal_check_failure_reason === 'string' ? failureJson.goal_check_failure_reason : undefined,
    extractTerminalRuntimeError(failureJson),
    typeof failureJson.diagnostic_reason === 'string' ? failureJson.diagnostic_reason : undefined,
    typeof failureJson.failed_command === 'string' ? failureJson.failed_command : undefined,
    response.error,
    phaseDiagnostics[0]?.detail,
  ];

  return candidates
    .map((candidate) => typeof candidate === 'string' ? cleanDiagnosticTextFn(candidate) : undefined)
    .find((candidate): candidate is string => Boolean(candidate));
}
