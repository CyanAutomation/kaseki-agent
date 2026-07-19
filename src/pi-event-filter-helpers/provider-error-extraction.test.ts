/**
 * Unit Tests for Provider Error Field Extraction Helpers
 *
 * Tests all 13 field extractors with comprehensive edge cases,
 * type coercion, fallback paths, and malformed input handling.
 */

import {
  extractErrorMessage,
  extractStopReason,
  extractNestedError,
  extractStatusCode,
  extractErrorCode,
  extractResponseId,
  extractCloudflareLogId,
  extractGatewayEventId,
  extractUpstreamError,
  extractRetryAfter,
  extractRoutedProvider,
  extractRoutedModel,
  extractRecoverySuggestion,
} from './provider-error-extraction';
import type { PiEvent } from '../lib/event-timestamp-helpers';

describe('extractErrorMessage', () => {
  it('should extract errorMessage string field', () => {
    expect(extractErrorMessage({ errorMessage: 'API error' })).toBe('API error');
  });

  it('should trim whitespace', () => {
    expect(extractErrorMessage({ errorMessage: '  API error  ' })).toBe('API error');
  });

  it('should coerce non-string errorMessage to string', () => {
    expect(extractErrorMessage({ errorMessage: 12345 })).toBe('12345');
  });

  it('should handle null errorMessage', () => {
    expect(extractErrorMessage({ errorMessage: null })).toBe('');
  });

  it('should handle undefined errorMessage', () => {
    expect(extractErrorMessage({ errorMessage: undefined })).toBe('');
  });

  it('should return empty string for missing field', () => {
    expect(extractErrorMessage({})).toBe('');
  });

  it('should handle object without errorMessage', () => {
    expect(extractErrorMessage({ other: 'value' })).toBe('');
  });

  it('should return empty string when errorMessage stringification throws', () => {
    const message = {
      errorMessage: {
        toString() {
          throw new Error('cannot stringify');
        },
      },
    };

    expect(extractErrorMessage(message)).toBe('');
  });
});

describe('extractStopReason', () => {
  it('should extract stopReason string field', () => {
    expect(extractStopReason({ stopReason: 'error' })).toBe('error');
  });

  it('should trim whitespace', () => {
    expect(extractStopReason({ stopReason: '  error  ' })).toBe('error');
  });

  it('should return empty string for non-string stopReason', () => {
    expect(extractStopReason({ stopReason: 123 })).toBe('');
  });

  it('should return empty string for missing field', () => {
    expect(extractStopReason({})).toBe('');
  });

  it('should handle null stopReason', () => {
    expect(extractStopReason({ stopReason: null })).toBe('');
  });
});

describe('extractNestedError', () => {
  it('should extract nested error object', () => {
    const error = { code: 'INVALID' };
    expect(extractNestedError({ error })).toBe(error);
  });

  it('should return undefined if error is not an object', () => {
    expect(extractNestedError({ error: 'string error' })).toBeUndefined();
  });

  it('should return undefined if error is null', () => {
    expect(extractNestedError({ error: null })).toBeUndefined();
  });

  it('should return undefined if error field missing', () => {
    expect(extractNestedError({})).toBeUndefined();
  });

  it('should handle nested error that is an empty object', () => {
    expect(extractNestedError({ error: {} })).toEqual({});
  });

  it('should handle deeply nested error object', () => {
    const nestedError = { nested: { code: 'DEEP' } };
    expect(extractNestedError({ error: nestedError })).toEqual(nestedError);
  });

  it('should accept array error values because arrays are objects under the existing contract', () => {
    const nestedError = [{ code: 'ARRAY_ERROR' }];
    expect(extractNestedError({ error: nestedError })).toBe(nestedError);
  });
});

describe('extractStatusCode', () => {
  it('should extract numeric status code from message', () => {
    expect(extractStatusCode({ statusCode: 429 }, {})).toBe(429);
  });

  it('should extract status_code snake_case variant', () => {
    expect(extractStatusCode({ status_code: 503 }, {})).toBe(503);
  });

  it('should extract statusCode from nested error', () => {
    expect(extractStatusCode({}, { statusCode: 400 })).toBe(400);
  });

  it('should extract status_code from nested error', () => {
    expect(extractStatusCode({}, { status_code: 401 })).toBe(401);
  });

  it('should coerce string status code to number', () => {
    expect(extractStatusCode({ statusCode: '429' }, {})).toBe(429);
  });

  it('should not coerce non-3-digit strings', () => {
    expect(extractStatusCode({ statusCode: 'error' }, {})).toBeUndefined();
  });

  it('should prioritize message over nested error', () => {
    expect(extractStatusCode({ statusCode: 400 }, { statusCode: 500 })).toBe(400);
  });

  it('should not fall back when the first present status candidate has an invalid type', () => {
    expect(extractStatusCode({ statusCode: false, status_code: 429 }, { statusCode: 500 })).toBeUndefined();
  });

  it('should return undefined for missing status code', () => {
    expect(extractStatusCode({}, {})).toBeUndefined();
  });

  it('should reject float status codes', () => {
    expect(extractStatusCode({ statusCode: 429.5 }, {})).toBeUndefined();
  });

  it('should reject status codes outside valid range', () => {
    expect(extractStatusCode({ statusCode: 99 }, {})).toBeUndefined();
    expect(extractStatusCode({ statusCode: 600 }, {})).toBeUndefined();
    expect(extractStatusCode({ statusCode: -1 }, {})).toBeUndefined();
  });

  it('should accept valid integer status codes', () => {
    expect(extractStatusCode({ statusCode: 200 }, {})).toBe(200);
    expect(extractStatusCode({ statusCode: 404 }, {})).toBe(404);
    expect(extractStatusCode({ statusCode: 500 }, {})).toBe(500);
    expect(extractStatusCode({ statusCode: 599 }, {})).toBe(599);
  });
});

describe('extractErrorCode', () => {
  it('should extract errorCode string from message', () => {
    expect(extractErrorCode({ errorCode: 'RATE_LIMITED' }, {})).toBe('RATE_LIMITED');
  });

  it('should extract error_code snake_case variant', () => {
    expect(extractErrorCode({ error_code: 'INVALID_PARAM' }, {})).toBe('INVALID_PARAM');
  });

  it('should extract code from nested error', () => {
    expect(extractErrorCode({}, { code: 'AUTH_FAILED' })).toBe('AUTH_FAILED');
  });

  it('should prioritize message over nested error', () => {
    expect(extractErrorCode({ errorCode: 'MSG_ERROR' }, { code: 'NESTED_ERROR' })).toBe('MSG_ERROR');
  });

  it('should not coerce non-string errorCode', () => {
    expect(extractErrorCode({ errorCode: 429 }, {})).toBeUndefined();
  });

  it('should not fall back when the first present error code candidate is not a string', () => {
    expect(extractErrorCode({ errorCode: 429, error_code: 'MESSAGE_FALLBACK' }, { code: 'NESTED' })).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractErrorCode({}, {})).toBeUndefined();
  });
});

describe('extractResponseId', () => {
  it('should extract responseId from message', () => {
    expect(extractResponseId({ responseId: 'resp-123' }, {} as PiEvent)).toBe('resp-123');
  });

  it('should extract response_id snake_case variant', () => {
    expect(extractResponseId({ response_id: 'resp-456' }, {} as PiEvent)).toBe('resp-456');
  });

  it('should extract responseId from event level', () => {
    const event = { responseId: 'event-resp-789' } as any;
    expect(extractResponseId({}, event)).toBe('event-resp-789');
  });

  it('should prioritize message over event', () => {
    const event = { responseId: 'event-resp' } as any;
    expect(extractResponseId({ responseId: 'msg-resp' }, event)).toBe('msg-resp');
  });

  it('should not coerce non-string response id', () => {
    expect(extractResponseId({ responseId: 123 }, {} as PiEvent)).toBeUndefined();
  });

  it('should not fall back to event responseId when message responseId is present with the wrong type', () => {
    expect(extractResponseId({ responseId: 123 }, { responseId: 'event-resp' } as any)).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractResponseId({}, {} as PiEvent)).toBeUndefined();
  });
});

describe('extractCloudflareLogId', () => {
  it('should extract cloudflareLogId from message', () => {
    expect(extractCloudflareLogId({ cloudflareLogId: 'cf-log-123' }, {})).toBe('cf-log-123');
  });

  it('should extract cloudflare_log_id snake_case variant', () => {
    expect(extractCloudflareLogId({ cloudflare_log_id: 'cf-log-456' }, {})).toBe('cf-log-456');
  });

  it('should extract cloudflareLogId from nested error', () => {
    expect(extractCloudflareLogId({}, { cloudflareLogId: 'cf-error-789' })).toBe('cf-error-789');
  });

  it('should extract cloudflare_log_id from nested error', () => {
    expect(extractCloudflareLogId({}, { cloudflare_log_id: 'cf-error-000' })).toBe('cf-error-000');
  });

  it('should prioritize message over nested error', () => {
    expect(
      extractCloudflareLogId({ cloudflareLogId: 'msg-cf' }, { cloudflareLogId: 'err-cf' })
    ).toBe('msg-cf');
  });

  it('should not coerce non-string cloudflare log id', () => {
    expect(extractCloudflareLogId({ cloudflareLogId: 123 }, {})).toBeUndefined();
  });

  it('should not fall back when the first present Cloudflare log id is not a string', () => {
    expect(
      extractCloudflareLogId({ cloudflareLogId: 123, cloudflare_log_id: 'msg-cf' }, { cloudflareLogId: 'err-cf' })
    ).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractCloudflareLogId({}, {})).toBeUndefined();
  });
});

describe('extractGatewayEventId', () => {
  it('should extract gatewayEventId from message', () => {
    expect(extractGatewayEventId({ gatewayEventId: 'gw-event-1' }, {})).toBe('gw-event-1');
  });

  it('should extract gateway_event_id snake_case variant', () => {
    expect(extractGatewayEventId({ gateway_event_id: 'gw-event-2' }, {})).toBe('gw-event-2');
  });

  it('should extract eventId from nested error', () => {
    expect(extractGatewayEventId({}, { eventId: 'err-event-3' })).toBe('err-event-3');
  });

  it('should extract event_id snake_case from nested error', () => {
    expect(extractGatewayEventId({}, { event_id: 'err-event-4' })).toBe('err-event-4');
  });

  it('should prioritize message gatewayEventId', () => {
    expect(
      extractGatewayEventId(
        { gatewayEventId: 'msg-gw', eventId: 'msg-event' },
        { eventId: 'err-event' }
      )
    ).toBe('msg-gw');
  });

  it('should not coerce non-string gateway event id', () => {
    expect(extractGatewayEventId({ gatewayEventId: 12345 }, {})).toBeUndefined();
  });

  it('should not fall back when the first present gateway event id is not a string', () => {
    expect(
      extractGatewayEventId({ gatewayEventId: 12345, gateway_event_id: 'msg-gw' }, { eventId: 'err-event' })
    ).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractGatewayEventId({}, {})).toBeUndefined();
  });
});

describe('extractUpstreamError', () => {
  it('should extract message from nested error', () => {
    expect(extractUpstreamError({}, { message: 'Upstream service error' })).toBe(
      'Upstream service error'
    );
  });

  it('should extract detail from nested error', () => {
    expect(extractUpstreamError({}, { detail: 'Error detail' })).toBe('Error detail');
  });

  it('should extract errorDetail from message', () => {
    expect(extractUpstreamError({ errorDetail: 'Message error detail' }, {})).toBe(
      'Message error detail'
    );
  });

  it('should extract error_detail snake_case from message', () => {
    expect(extractUpstreamError({ error_detail: 'Message error detail 2' }, {})).toBe(
      'Message error detail 2'
    );
  });

  it('should prioritize nested error message', () => {
    expect(
      extractUpstreamError({ errorDetail: 'msg-detail' }, { message: 'nested-msg' })
    ).toBe('nested-msg');
  });

  it('should truncate to 1000 characters', () => {
    const longString = 'a'.repeat(2000);
    expect(extractUpstreamError({}, { message: longString })?.length).toBe(1000);
  });

  it('should not coerce non-string upstream error', () => {
    expect(extractUpstreamError({}, { message: 12345 })).toBeUndefined();
  });

  it('should not fall back when the first present upstream error candidate is not a string', () => {
    expect(extractUpstreamError({ errorDetail: 'message-detail' }, { message: 12345, detail: 'nested-detail' })).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractUpstreamError({}, {})).toBeUndefined();
  });
});

describe('extractRetryAfter', () => {
  it('should extract retryAfter string from message', () => {
    expect(extractRetryAfter({ retryAfter: '60' }, {})).toBe('60');
  });

  it('should extract retry_after snake_case from message', () => {
    expect(extractRetryAfter({ retry_after: '120' }, {})).toBe('120');
  });

  it('should extract retryAfter from nested error', () => {
    expect(extractRetryAfter({}, { retryAfter: '90' })).toBe('90');
  });

  it('should extract retry_after from nested error', () => {
    expect(extractRetryAfter({}, { retry_after: '30' })).toBe('30');
  });

  it('should coerce numeric retryAfter to string', () => {
    expect(extractRetryAfter({ retryAfter: 45 }, {})).toBe('45');
  });

  it('should coerce numeric nested error retry_after to string', () => {
    expect(extractRetryAfter({}, { retry_after: 75 })).toBe('75');
  });

  it('should prioritize message retryAfter', () => {
    expect(extractRetryAfter({ retryAfter: '60' }, { retryAfter: '120' })).toBe('60');
  });

  it('should not extract non-string/non-number retryAfter', () => {
    expect(extractRetryAfter({ retryAfter: [] }, {})).toBeUndefined();
  });

  it('should not fall back when the first present retryAfter candidate is not string or number', () => {
    expect(extractRetryAfter({ retryAfter: [], retry_after: '60' }, { retryAfter: '120' })).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractRetryAfter({}, {})).toBeUndefined();
  });
});

describe('extractRoutedProvider', () => {
  it('should extract routedProvider from message', () => {
    expect(extractRoutedProvider({ routedProvider: 'openai' }, {})).toBe('openai');
  });

  it('should extract routed_provider snake_case from message', () => {
    expect(extractRoutedProvider({ routed_provider: 'anthropic' }, {})).toBe('anthropic');
  });

  it('should extract provider from nested error', () => {
    expect(extractRoutedProvider({}, { provider: 'gemini' })).toBe('gemini');
  });

  it('should extract routed_provider from nested error', () => {
    expect(extractRoutedProvider({}, { routed_provider: 'mistral' })).toBe('mistral');
  });

  it('should prioritize message routedProvider', () => {
    expect(
      extractRoutedProvider({ routedProvider: 'msg-provider' }, { provider: 'err-provider' })
    ).toBe('msg-provider');
  });

  it('should not coerce non-string routed provider', () => {
    expect(extractRoutedProvider({ routedProvider: 123 }, {})).toBeUndefined();
  });

  it('should not fall back when the first present routed provider candidate is not a string', () => {
    expect(extractRoutedProvider({ routedProvider: 123, routed_provider: 'message-provider' }, { provider: 'nested' })).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractRoutedProvider({}, {})).toBeUndefined();
  });
});

describe('extractRoutedModel', () => {
  it('should extract routedModel from message', () => {
    expect(extractRoutedModel({ routedModel: 'gpt-4' }, {})).toBe('gpt-4');
  });

  it('should extract routed_model snake_case from message', () => {
    expect(extractRoutedModel({ routed_model: 'gpt-3.5-turbo' }, {})).toBe('gpt-3.5-turbo');
  });

  it('should extract model from nested error', () => {
    expect(extractRoutedModel({}, { model: 'claude-2' })).toBe('claude-2');
  });

  it('should extract routed_model from nested error', () => {
    expect(extractRoutedModel({}, { routed_model: 'llama-70b' })).toBe('llama-70b');
  });

  it('should prioritize message routedModel', () => {
    expect(extractRoutedModel({ routedModel: 'msg-model' }, { model: 'err-model' })).toBe(
      'msg-model'
    );
  });

  it('should not coerce non-string routed model', () => {
    expect(extractRoutedModel({ routedModel: 123 }, {})).toBeUndefined();
  });

  it('should not fall back when the first present routed model candidate is not a string', () => {
    expect(extractRoutedModel({ routedModel: 123, routed_model: 'message-model' }, { model: 'nested' })).toBeUndefined();
  });

  it('should return undefined for missing field', () => {
    expect(extractRoutedModel({}, {})).toBeUndefined();
  });
});

describe('extractRecoverySuggestion', () => {
  it('should return recovery suggestion for malformed_tool_call type', () => {
    const suggestion = extractRecoverySuggestion('malformed_tool_call');
    expect(suggestion).toBeDefined();
    expect(suggestion).toContain('Retry');
    expect(suggestion).toContain('JSON');
    expect(suggestion).toContain('tool call');
  });

  it('should return undefined for other error types', () => {
    expect(extractRecoverySuggestion('auth_failed')).toBeUndefined();
    expect(extractRecoverySuggestion('rate_limited')).toBeUndefined();
    expect(extractRecoverySuggestion('model_unavailable')).toBeUndefined();
  });

  it('should consistently return same suggestion for malformed_tool_call', () => {
    const suggestion1 = extractRecoverySuggestion('malformed_tool_call');
    const suggestion2 = extractRecoverySuggestion('malformed_tool_call');
    expect(suggestion1).toBe(suggestion2);
  });
});

describe('Integration: Field extractors with realistic Pi event message', () => {
  it('should extract all fields from a complete error message', () => {
    const message = {
      errorMessage: 'API request failed',
      stopReason: 'error',
      error: {
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        cloudflareLogId: 'cf-log-abc123',
        eventId: 'evt-123',
        retryAfter: 60,
        provider: 'openai',
        model: 'gpt-4',
      },
      responseId: 'resp-xyz789',
      routedProvider: 'openai',
      routedModel: 'gpt-4-turbo',
    };

    expect(extractErrorMessage(message)).toBe('API request failed');
    expect(extractStopReason(message)).toBe('error');
    expect(extractNestedError(message)).toBeDefined();
    expect(extractStatusCode(message, message.error)).toBe(429);
    expect(extractErrorCode(message, message.error)).toBe('RATE_LIMITED');
    expect(extractResponseId(message, {} as PiEvent)).toBe('resp-xyz789');
    expect(extractCloudflareLogId(message, message.error)).toBe('cf-log-abc123');
    expect(extractGatewayEventId(message, message.error)).toBe('evt-123');
    expect(extractUpstreamError(message, message.error)).toBe('Too many requests');
    expect(extractRetryAfter(message, message.error)).toBe('60');
    expect(extractRoutedProvider(message, message.error)).toBe('openai');
    expect(extractRoutedModel(message, message.error)).toBe('gpt-4-turbo');
  });

  it('should handle partial error message with fallbacks', () => {
    const message = {
      errorMessage: 'Request timeout',
      stopReason: 'error',
      error: {
        status_code: '504',
        error_code: 'TIMEOUT',
        error_detail: 'Gateway did not respond',
      },
    };

    expect(extractErrorMessage(message)).toBe('Request timeout');
    expect(extractStatusCode(message, message.error)).toBe(504);
    expect(extractErrorCode(message, message.error)).toBe('TIMEOUT');
    expect(extractUpstreamError(message, message.error)).toBe('Gateway did not respond');
  });

  it('should handle empty or malformed error structures', () => {
    const emptyMessage = {};
    const nullMessage = null;
    const stringMessage = 'error';

    // Empty object should return empty/undefined values
    expect(extractErrorMessage(emptyMessage)).toBe('');
    expect(extractNestedError(emptyMessage)).toBeUndefined();
    expect(extractStatusCode(emptyMessage, {})).toBeUndefined();

    // Null and non-objects should be handled gracefully
    expect(extractErrorMessage(nullMessage as any)).toBe('');
    expect(extractNestedError(stringMessage as any)).toBeUndefined();
  });
});
