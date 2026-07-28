import {
  filterPhaseDiagnostics,
  phaseDiagnosticsFromErrors,
  resolvePrimaryDiagnosticReason,
} from './phase-diagnostic-extractor';
import type { StatusResponse } from '../kaseki-api-types';

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

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

  it('returns diagnostics unchanged when primary reason is absent or non-terminal', () => {
    const diagnostics = [
      { phase: 'goal-setting' as const, reason: 'patch_fallback', field: 'candidate' },
      { phase: 'goal-setting' as const, reason: 'patch_fallback_recovered', field: 'candidate', recovered: true },
    ];

    expect(filterPhaseDiagnostics(diagnostics, undefined)).toEqual(diagnostics);
    expect(filterPhaseDiagnostics(diagnostics, 'provider_error', false)).toEqual(diagnostics);
  });

  it('keeps fallback context only when no recovery marker matches the same phase and field', () => {
    const filtered = filterPhaseDiagnostics([
      { phase: 'goal-setting', reason: 'patch_fallback', field: 'candidate' },
      { phase: 'scouting', reason: 'patch_fallback_recovered', field: 'candidate', recovered: true },
      { phase: 'goal-setting', reason: 'missing_file', field: 'other' },
      { phase: 'goal-setting', reason: 'missing_file_recovered', field: 'candidate', recovered: true },
    ], 'Bad Gateway');

    expect(filtered).toEqual([
      { phase: 'goal-setting', reason: 'missing_file', field: 'other' },
    ]);
  });

  it('suppresses placeholder content only for provider primary reasons', () => {
    const diagnostics = [
      { phase: 'scouting' as const, reason: 'placeholder_content', field: 'candidate' },
      { phase: 'scouting' as const, reason: 'schema_mismatch', field: 'candidate' },
    ];

    expect(filterPhaseDiagnostics(diagnostics, 'gateway timeout')).toEqual([
      { phase: 'scouting', reason: 'schema_mismatch', field: 'candidate' },
    ]);
    expect(filterPhaseDiagnostics(diagnostics, 'schema validation failed')).toEqual(diagnostics);
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

  it('resolves structured provider errors before legacy and response fallbacks', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_primary: { message: 'structured' },
        provider_error_message: 'legacy',
        diagnostic_reason: 'diagnostic',
      },
      validationFailureReason: 'validation',
      error: 'error',
    } as unknown as StatusResponse;

    const result = resolvePrimaryDiagnosticReason(
      response,
      [{ phase: 'goal-check', detail: 'phase detail' }],
      () => 'provider_error: structured',
      () => 'provider_error: legacy',
      () => 'runtime error',
      (value) => value.trim(),
    );

    expect(result).toBe('provider_error: structured');
  });

  it('falls back through terminal runtime, failed command, response error, and phase detail', () => {
    const clean = (value: string) => value.replace(ansiPattern, '').trim();

    expect(resolvePrimaryDiagnosticReason(
      { failureJsonContent: {} } as StatusResponse,
      [{ phase: 'goal-check', detail: '\u001b[31mphase detail\u001b[0m' }],
      () => undefined,
      () => undefined,
      () => undefined,
      clean,
    )).toBe('phase detail');

    expect(resolvePrimaryDiagnosticReason(
      { failureJsonContent: { failed_command: 'npm test' }, error: 'response error' } as StatusResponse,
      [],
      () => undefined,
      () => undefined,
      () => undefined,
      clean,
    )).toBe('npm test');

    expect(resolvePrimaryDiagnosticReason(
      { failureJsonContent: {}, error: 'response error' } as StatusResponse,
      [],
      () => undefined,
      () => undefined,
      () => 'runtime error',
      clean,
    )).toBe('runtime error');
  });
});
