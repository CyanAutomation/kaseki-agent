import { ProviderErrorFormatter } from './provider-error-formatter';

describe('ProviderErrorFormatter', () => {
  const formatter = new ProviderErrorFormatter();

  it('formats structured provider errors with sanitized context', () => {
    const result = formatter.formatStructuredProviderError({
      type: 'model_unavailable',
      message: '\u001b[31mGateway unavailable\u001b[0m',
      phase: 'coding',
      provider: 'gateway',
      model: 'dynamic/kaseki-agent',
    });

    expect(result).toBe('model_unavailable: Gateway unavailable (phase: coding, provider: gateway, model: dynamic/kaseki-agent)');
  });

  it('returns undefined for structured provider errors without a message', () => {
    expect(formatter.formatStructuredProviderError({ type: 'provider_error' })).toBeUndefined();
    expect(formatter.formatStructuredProviderError(null)).toBeUndefined();
    expect(formatter.formatStructuredProviderError([])).toBeUndefined();
  });

  it('formats legacy provider error metadata and omits missing context', () => {
    const result = formatter.formatProviderError({
      provider_error_message: '  Retry budget exhausted  ',
      provider_error_type: 'provider_error',
      provider_error_model: 'gpt-test',
    });

    expect(result).toBe('provider_error: Retry budget exhausted (model: gpt-test)');
  });

  it('returns undefined for legacy provider metadata without a message', () => {
    expect(formatter.formatProviderError({ provider_error_type: 'provider_error' })).toBeUndefined();
  });
});
