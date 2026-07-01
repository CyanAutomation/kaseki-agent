import { DiagnosticExtractor } from './diagnostic-extractor';
import type { StatusResponse } from '../kaseki-api-types';

describe('DiagnosticExtractor', () => {
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

    new DiagnosticExtractor().extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

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

    new DiagnosticExtractor().extractDiagnosticSummary(response, '/results/kaseki-test', () => null);

    expect(response.diagnosticSummary?.primaryReason).toContain('ERR_MODULE_NOT_FOUND');
    expect(response.diagnosticSummary?.primaryReason).not.toContain('candidate artifact file not found');
  });
});
