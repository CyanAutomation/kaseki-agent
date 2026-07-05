import {
  classifyProviderError,
  extractMessageTextLength,
  extractProviderError,
  isProviderErrorRetryable,
} from './pi-event-filter-helpers';

// ─── isProviderErrorRetryable ────────────────────────────────────────────────

describe('isProviderErrorRetryable', () => {
  it('returns true for 503 Service Unavailable', () => {
    expect(isProviderErrorRetryable('HTTP 503 Service Unavailable')).toBe(true);
  });

  it('returns true for 429 rate limited', () => {
    expect(isProviderErrorRetryable('429 Too Many Requests')).toBe(true);
  });

  it('returns true for connection reset', () => {
    expect(isProviderErrorRetryable('ECONNRESET connection error')).toBe(true);
  });

  it('returns true for timeout', () => {
    expect(isProviderErrorRetryable('Connection timeout after 30s')).toBe(true);
  });

  it('returns true for model unavailable (transient)', () => {
    expect(isProviderErrorRetryable('Model is temporarily unavailable')).toBe(true);
  });

  it('returns true for service is down', () => {
    expect(isProviderErrorRetryable('Service is down for maintenance')).toBe(true);
  });

  it('returns false for 404 model not found', () => {
    expect(isProviderErrorRetryable('404 model not found')).toBe(false);
  });

  it('returns false for deprecated model', () => {
    expect(isProviderErrorRetryable('This model is deprecated')).toBe(false);
  });

  it('returns false for unknown error', () => {
    expect(isProviderErrorRetryable('Something went wrong unexpectedly')).toBe(false);
  });

  it('returns true for an opaque gateway finish reason error', () => {
    expect(isProviderErrorRetryable('Provider finish_reason: error')).toBe(true);
  });

  it('returns true for malformed tool-call JSON', () => {
    expect(isProviderErrorRetryable('Tool call arguments contain malformed JSON')).toBe(true);
  });

  it.each(['401 Unauthorized', '403 Forbidden', 'Invalid API key'])(
    'returns false for permanent authentication error %s',
    (message) => {
      expect(isProviderErrorRetryable(message)).toBe(false);
    }
  );
});

// ─── classifyProviderError ───────────────────────────────────────────────────

describe('classifyProviderError', () => {
  it('classifies model unavailable', () => {
    const result = classifyProviderError('model is unavailable for this region');
    expect(result.type).toBe('model_unavailable');
  });

  it('classifies model_not_found', () => {
    const result = classifyProviderError('model_not_found: gpt-x');
    expect(result.type).toBe('model_unavailable');
  });

  it('classifies no endpoints found as model_unavailable', () => {
    const result = classifyProviderError('no endpoints found for the requested model');
    expect(result.type).toBe('model_unavailable');
  });

  it('classifies generic provider_error', () => {
    const result = classifyProviderError('Internal server error');
    expect(result.type).toBe('provider_error');
  });

  it('classifies malformed tool-call JSON with corrective recovery guidance', () => {
    const result = classifyProviderError('Failed to parse malformed JSON in tool call arguments');
    expect(result).toEqual({ type: 'malformed_tool_call', retryable: true });
  });

  it('propagates retryable from isProviderErrorRetryable', () => {
    expect(classifyProviderError('503 unavailable').retryable).toBe(true);
    expect(classifyProviderError('404 model not found').retryable).toBe(false);
  });
});

// ─── extractProviderError ────────────────────────────────────────────────────

const makeErrorEvent = (overrides: Record<string, any> = {}) => ({
  message: {
    stopReason: 'error',
    errorMessage: 'Service unavailable 503',
    provider: 'openai',
    api: 'chat',
    model: 'gpt-4',
    ...overrides,
  },
});

describe('extractProviderError', () => {
  it('returns null when message is absent', () => {
    expect(extractProviderError({} as any)).toBeNull();
  });

  it('returns null when stopReason is not "error"', () => {
    expect(extractProviderError(makeErrorEvent({ stopReason: 'stop' }) as any)).toBeNull();
  });

  it('returns null when errorMessage is absent', () => {
    expect(extractProviderError(makeErrorEvent({ errorMessage: undefined }) as any)).toBeNull();
  });

  it('returns null when errorMessage is empty string', () => {
    expect(extractProviderError(makeErrorEvent({ errorMessage: '' }) as any)).toBeNull();
  });

  it('extracts provider error summary', () => {
    const result = extractProviderError(makeErrorEvent() as any);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('Service unavailable 503');
    expect(result!.provider).toBe('openai');
    expect(result!.api).toBe('chat');
    expect(result!.model).toBe('gpt-4');
    expect(result!.stop_reason).toBe('error');
    expect(result!.retryable).toBe(true);
  });

  it('preserves gateway correlation IDs and malformed-tool recovery guidance', () => {
    const result = extractProviderError(makeErrorEvent({
      errorMessage: 'Tool call arguments contain malformed JSON',
      cloudflareLogId: '01KWFRREEX90G7DAQNM9A5K7ER',
      gatewayEventId: 'gateway-event-1',
    }) as any);
    expect(result).toMatchObject({
      type: 'malformed_tool_call',
      retryable: true,
      cloudflare_log_id: '01KWFRREEX90G7DAQNM9A5K7ER',
      gateway_event_id: 'gateway-event-1',
    });
    expect(result?.recovery_suggestion).toContain('valid JSON tool call');
  });

  it('preserves upstream gateway diagnostics', () => {
    const result = extractProviderError(
      makeErrorEvent({
        errorMessage: 'Provider finish_reason: error',
        statusCode: 503,
        errorCode: 'upstream_error',
        responseId: 'resp-123',
        retryAfter: 12,
        routedProvider: 'workers-ai',
        routedModel: '@cf/model',
        error: { message: 'upstream stream terminated' },
      }) as any
    );
    expect(result).toMatchObject({
      retryable: true,
      status_code: 503,
      error_code: 'upstream_error',
      response_id: 'resp-123',
      retry_after: '12',
      routed_provider: 'workers-ai',
      routed_model: '@cf/model',
      upstream_error: 'upstream stream terminated',
    });
  });

  it('converts non-string errorMessage to string', () => {
    const result = extractProviderError(makeErrorEvent({ errorMessage: { toString: () => '503 err' } }) as any);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('503 err');
  });

  it('handles provider fields being non-string gracefully', () => {
    const result = extractProviderError(makeErrorEvent({ provider: 42, api: null, model: undefined }) as any);
    expect(result).not.toBeNull();
    expect(result!.provider).toBeUndefined();
    expect(result!.api).toBeUndefined();
    expect(result!.model).toBeUndefined();
  });
});

// ─── extractMessageTextLength ─────────────────────────────────────────────────

describe('extractMessageTextLength', () => {
  it('returns 0 for null/undefined', () => {
    expect(extractMessageTextLength(null)).toBe(0);
    expect(extractMessageTextLength(undefined)).toBe(0);
  });

  it('returns 0 for empty message', () => {
    expect(extractMessageTextLength({})).toBe(0);
  });

  it('uses message.content string', () => {
    expect(extractMessageTextLength({ content: 'hello' })).toBe(5);
  });

  it('returns 0 for whitespace-only content string', () => {
    expect(extractMessageTextLength({ content: '   ' })).toBe(0);
  });

  it('uses message.content array with text parts', () => {
    // 'hi'=2 + 'there'=5 (trimmed from ' there')
    expect(extractMessageTextLength({ content: [{ text: 'hi' }, { text: ' there' }] })).toBe(7);
  });

  it('uses output_text in content array parts', () => {
    expect(extractMessageTextLength({ content: [{ output_text: 'answer' }] })).toBe(6);
  });

  it('falls back to message.text', () => {
    expect(extractMessageTextLength({ text: 'fallback text' })).toBe(13);
  });

  it('falls back to message.output_text', () => {
    expect(extractMessageTextLength({ output_text: 'alt response' })).toBe(12);
  });

  it('falls back to body.output[].content[].text (OpenRouter format)', () => {
    const message = {
      body: {
        output: [{ content: [{ text: 'nested' }] }],
      },
    };
    expect(extractMessageTextLength(message)).toBe(6);
  });

  it('prefers content array over fallback paths', () => {
    const message = { content: [{ text: 'primary' }], text: 'secondary' };
    expect(extractMessageTextLength(message)).toBe(7);
  });

  it('skips empty content array and falls back to message.text', () => {
    const message = { content: [{ text: '  ' }], text: 'fallback' };
    // content array produces 0, falls back to message.text
    expect(extractMessageTextLength(message)).toBe(8);
  });

  it('handles string items in content array', () => {
    // 'hello'=5 + ' world' trimmed='world'=5
    expect(extractMessageTextLength({ content: ['hello', ' world'] })).toBe(10);
  });
});
