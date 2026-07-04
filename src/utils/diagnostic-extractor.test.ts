import { DiagnosticExtractor } from './diagnostic-extractor';
import type { StatusResponse } from '../kaseki-api-types';

describe('DiagnosticExtractor', () => {
  const extractor = new DiagnosticExtractor();

  test('keeps the primary provider failure separate from fallback recovery failure', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_primary: {
          type: 'provider_error', phase: 'coding', provider: 'gateway',
          model: 'dynamic/kaseki-agent', message: '503 upstream unavailable',
        },
        provider_error_recovery: {
          type: 'provider_error', phase: 'coding', provider: 'openrouter',
          model: 'auto', message: '401 Missing Authentication header',
        },
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('503 upstream unavailable');
    expect(response.diagnosticSummary?.primaryReason).toContain('dynamic/kaseki-agent');
    expect(response.diagnosticSummary?.recoveryFailure).toContain('401 Missing Authentication header');
    expect(response.diagnosticSummary?.recoveryFailure).toContain('openrouter');
  });

  test('prioritizes a terminal module failure over downstream missing artifacts', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        failed_command: 'kaseki-pi-event-filter',
        diagnostic_reason: 'goal-setting-validation-errors.jsonl: candidate artifact file not found',
        stderr_tail: [
          "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/usr/local/bin/pi-event-aggregation/event-counter-aggregator.js'",
          'ERROR: pi event export incomplete; raw events are non-empty',
        ].join('\n'),
      },
      goalSettingValidationErrorsContent: [{ reason: 'candidate artifact file not found' }],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('ERR_MODULE_NOT_FOUND');
    expect(response.diagnosticSummary?.primaryReason).not.toContain('candidate artifact file not found');
  });

  test('extracts terminal runtime error with Error [CODE] pattern', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        failed_command: 'npm test',
        stderr_tail: 'Error [ERR_REQUIRE_ESM]: mylib must be imported\nOther error line',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('npm test:');
    expect(response.diagnosticSummary?.primaryReason).toContain('ERR_REQUIRE_ESM');
  });

  test('extracts terminal runtime error with Error: pattern', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        stderr_tail: 'Error: ENOENT file not found',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('ENOENT');
  });

  test('formats legacy provider error fields correctly', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_type: 'model_unavailable',
        provider_error_message: 'gpt-4-turbo not available in region us-west',
        provider_error_phase: 'coding',
        provider_error_model: 'gpt-4-turbo',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('model_unavailable');
    expect(response.diagnosticSummary?.primaryReason).toContain('gpt-4-turbo not available');
    expect(response.diagnosticSummary?.primaryReason).toContain('phase: coding');
  });

  test('extracts phase diagnostics with all fields populated', () => {
    const response = {
      status: 'failed',
      goalSettingValidationErrorsContent: [
        {
          reason_code: 'invalid_prompt',
          severity: 'error',
          field: 'original_prompt',
          actual: 'null',
          expected: 'non-empty string',
          suggestion: 'Provide a clear task description',
          recovered: true,
        },
      ],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const phaseDiag = response.diagnosticSummary?.phaseDiagnostics?.[0];
    expect(phaseDiag?.phase).toBe('goal-setting');
    expect(phaseDiag?.severity).toBe('error');
    expect(phaseDiag?.reason).toBe('invalid_prompt');
    expect(phaseDiag?.field).toBe('original_prompt');
    expect(phaseDiag?.detail).toContain('actual: null');
    expect(phaseDiag?.detail).toContain('expected: non-empty string');
    expect(phaseDiag?.suggestion).toContain('Provide a clear task description');
    expect(phaseDiag?.recovered).toBe(true);
  });

  test('extracts phase diagnostics with fallback reason field', () => {
    const response = {
      status: 'failed',
      scoutingValidationErrorsContent: [
        {
          reason: 'missing_field',
        },
      ],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const phaseDiag = response.diagnosticSummary?.phaseDiagnostics?.[0];
    expect(phaseDiag?.phase).toBe('scouting');
    expect(phaseDiag?.reason).toBe('missing_field');
  });

  test('filters recovered phase diagnostics when provider error is primary', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_primary: {
          type: 'provider_error',
          message: 'Gateway timeout',
        },
      },
      goalCheckValidationErrorsContent: [
        {
          reason: 'placeholder_content',
          recovered: true,
        },
        {
          reason: 'invalid_format',
          recovered: false,
        },
      ],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    // When provider error is primary, recovered diagnostics should be filtered out
    const phaseDiags = response.diagnosticSummary?.phaseDiagnostics ?? [];
    expect(phaseDiags.length).toBeLessThanOrEqual(1);
    expect(phaseDiags.every((d) => !d.recovered)).toBe(true);
  });

  test('filters fallback reason codes when provider error is primary', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_primary: {
          type: 'provider_error',
          message: 'Service unavailable',
        },
      },
      goalSettingValidationErrorsContent: [
        { reason: 'patch_fallback' },
        { reason: 'patch_fallback_recovered' },
        { reason: 'invalid_goal' },
      ],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const reasons = (response.diagnosticSummary?.phaseDiagnostics ?? []).map((d) => d.reason);
    expect(reasons).toContain('invalid_goal');
    expect(reasons).not.toContain('patch_fallback');
    expect(reasons).not.toContain('patch_fallback_recovered');
  });

  test('includes phase diagnostics when primary reason is not provider error', () => {
    const response = {
      status: 'failed',
      validationFailureReason: 'Validation command exited with code 1',
      goalSettingValidationErrorsContent: [
        {
          reason: 'schema_mismatch',
          recovered: true,
        },
      ],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    // When primary reason is not provider error, recovered diagnostics should be kept
    const phaseDiags = response.diagnosticSummary?.phaseDiagnostics ?? [];
    expect(phaseDiags.length).toBeGreaterThan(0);
    expect(phaseDiags[0]?.recovered).toBe(true);
  });

  test('limits phase diagnostics to first 5 errors', () => {
    const response = {
      status: 'failed',
      goalSettingValidationErrorsContent: Array.from({ length: 10 }, (_, i) => ({
        reason: `error_${i}`,
      })),
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const phaseDiags = response.diagnosticSummary?.phaseDiagnostics ?? [];
    expect(phaseDiags.length).toBe(5);
    expect(phaseDiags[0]?.reason).toBe('error_0');
    expect(phaseDiags[4]?.reason).toBe('error_4');
  });

  test('cleans ANSI escape codes and normalizes whitespace in diagnostics', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        diagnostic_reason: '\u001b[31mError message\u001b[0m   with   spaces',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const reason = response.diagnosticSummary?.primaryReason ?? '';
    expect(reason).toBe('Error message with spaces');
    expect(reason).not.toContain('\u001b');
  });

  test('extracts dependency cache diagnostics from stdout', () => {
    const response = {
      status: 'completed',
    } as unknown as StatusResponse;

    const mockReadArtifact = (filePath: string): string | null => {
      if (filePath.endsWith('stdout.log')) {
        return `Starting build...
Dependency cache status: restoring node_modules from /cache/abc123
Dependency cache status: running npm install to validate cache
Dependency cache status: restored dependency cache failed validation, reinstalling
Done`;
      }
      return null;
    };

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', mockReadArtifact);

    const cache = response.diagnosticSummary?.dependencyCache;
    expect(cache?.restored).toBe(true);
    expect(cache?.reinstallTriggered).toBe(true);
    expect(cache?.validationFailed).toBe(true);
    expect(cache?.messages).toHaveLength(3);
  });

  test('returns no diagnostic summary when status is neither completed nor failed', () => {
    const response = {
      status: 'queued',
      failureJsonContent: {
        diagnostic_reason: 'This should be ignored',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary).toBeUndefined();
  });

  test('returns no diagnostic summary when no diagnostic information available', () => {
    const response = {
      status: 'completed',
      failureJsonContent: {},
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary).toBeUndefined();
  });

  test('resolves diagnostic from goalCheckFailureReason', () => {
    const response = {
      status: 'failed',
      goalCheckFailureReason: 'Goal check validation failed: missing success criteria',
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('missing success criteria');
  });

  test('prioritizes provider error over other failure reasons', () => {
    const response = {
      status: 'failed',
      failureJsonContent: {
        provider_error_message: 'API rate limit exceeded',
        provider_error_type: 'rate_limit_error',
      },
      validationFailureReason: 'Test suite failed',
      qualityFailureReason: 'Diff size exceeded',
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const reason = response.diagnosticSummary?.primaryReason ?? '';
    expect(reason).toContain('rate_limit_error');
    expect(reason).toContain('API rate limit');
    expect(reason).not.toContain('Test suite failed');
  });

  test('includes diagnostic entry point when provided', () => {
    const response = {
      status: 'failed',
      diagnosticEntryPoint: 'https://dashboard.example.com/run/kaseki-123',
      failureJsonContent: {
        diagnostic_reason: 'Some error',
      },
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.recommendedEntryPoint).toBe(
      'https://dashboard.example.com/run/kaseki-123'
    );
  });

  test('combines multiple phase diagnostics sources', () => {
    const response = {
      status: 'failed',
      goalSettingValidationErrorsContent: [{ reason: 'gs_error' }],
      scoutingValidationErrorsContent: [{ reason: 'sc_error' }],
      goalCheckValidationErrorsContent: [{ reason: 'gc_error' }],
    } as unknown as StatusResponse;

    extractor.extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    const phaseDiags = response.diagnosticSummary?.phaseDiagnostics ?? [];
    expect(phaseDiags.length).toBe(3);
    expect(phaseDiags.map((d) => d.phase)).toEqual(['goal-setting', 'scouting', 'goal-check']);
    expect(phaseDiags.map((d) => d.reason)).toEqual(['gs_error', 'sc_error', 'gc_error']);
  });
});
