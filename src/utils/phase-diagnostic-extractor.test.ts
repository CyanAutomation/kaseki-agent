import {
  filterPhaseDiagnostics,
  phaseDiagnosticsFromErrors,
  resolvePrimaryDiagnosticReason,
} from './phase-diagnostic-extractor';
import type { StatusResponse } from '../kaseki-api-types';

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;

describe('phase-diagnostic-extractor', () => {
  it('extracts sanitized phase diagnostics and limits noisy error arrays', () => {
    const diagnostics = phaseDiagnosticsFromErrors('scouting', [
      {
        reason_code: 'schema_mismatch',
        severity: 'critical',
        field: 'candidate',
        actual: '\u001b[31mmissing\u001b[0m',
        expected: 'object',
        suggestion: 'Regenerate artifact',
        recovered: 'true',
      },
      { reason: 'second' },
      { reason: 'third' },
      { reason: 'fourth' },
      { reason: 'fifth' },
      { reason: 'sixth' },
    ], ansiPattern);

    expect(diagnostics).toHaveLength(5);
    expect(diagnostics[0]).toMatchObject({
      phase: 'scouting',
      severity: 'critical',
      reason: 'schema_mismatch',
      field: 'candidate',
      detail: 'schema_mismatch; actual: missing; expected: object',
      suggestion: 'Regenerate artifact',
      recovered: true,
    });
  });

  it('keeps non-fallback diagnostics when provider errors suppress recovery noise', () => {
    const filtered = filterPhaseDiagnostics([
      { phase: 'goal-setting', reason: 'patch_fallback', field: 'candidate' },
      { phase: 'goal-setting', reason: 'patch_fallback_recovered', field: 'candidate' },
      { phase: 'goal-setting', reason: 'schema_mismatch', field: 'goal' },
      { phase: 'scouting', reason: 'missing_candidate' },
    ], 'provider_error: gateway unavailable');

    expect(filtered).toEqual([
      { phase: 'goal-setting', reason: 'schema_mismatch', field: 'goal' },
      { phase: 'scouting', reason: 'missing_candidate' },
    ]);
  });

  it('resolves primary diagnostics by precedence and sanitizes candidate text', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        diagnostic_reason: 'fallback diagnostic',
        failed_command: 'npm test',
      },
      validationFailureReason: '\u001b[31mvalidation failed\u001b[0m',
      error: 'last resort',
    } as unknown as StatusResponse;

    const result = resolvePrimaryDiagnosticReason(
      response,
      [{ phase: 'goal-check', detail: 'phase detail' }],
      () => undefined,
      () => undefined,
      () => 'runtime error',
      (value) => value.replace(ansiPattern, '').trim(),
    );

    expect(result).toBe('validation failed');
  });
});
