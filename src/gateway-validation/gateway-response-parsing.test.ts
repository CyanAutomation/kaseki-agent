/**
 * Unit Tests for Gateway Response SSE Parsing
 *
 * Comprehensive tests for parseResponsesSse and token extraction functions,
 * covering SSE format variants, malformed input, and edge cases.
 */

import { parseResponsesSse, extractOutputTokens } from './gateway-response-parsing';

describe('parseResponsesSse', () => {
  it('should parse normal SSE with multiple delta events', () => {
    const sseResponse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_12345"}}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello "}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"world"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('Hello world');
    expect(result.responseId).toBe('resp_12345');
  });

  it('should extract responseId from response.id', () => {
    const sseResponse = [
      'data: {"response":{"id":"response_abc123"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.responseId).toBe('response_abc123');
  });

  it('should extract responseId from item.id as fallback', () => {
    const sseResponse = [
      'data: {"item":{"id":"item_xyz789"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.responseId).toBe('item_xyz789');
  });

  it('should prefer response.id over item.id', () => {
    const sseResponse = [
      'data: {"response":{"id":"response_first"},"item":{"id":"item_second"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.responseId).toBe('response_first');
  });

  it('should extract outputTokens from usage.output_tokens (OpenAI format)', () => {
    const sseResponse = [
      'data: {"response":{"usage":{"output_tokens":42}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.outputTokens).toBe(42);
  });

  it('should extract outputTokens from usage.completion_tokens (Anthropic format)', () => {
    const sseResponse = [
      'data: {"response":{"usage":{"completion_tokens":25}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.outputTokens).toBe(25);
  });

  it('should extract outputTokens from usage.output as fallback', () => {
    const sseResponse = [
      'data: {"response":{"usage":{"output":18}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.outputTokens).toBe(18);
  });

  it('should prefer output_tokens over completion_tokens', () => {
    const sseResponse = [
      'data: {"response":{"usage":{"output_tokens":100,"completion_tokens":50}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.outputTokens).toBe(100);
  });

  it('should handle [DONE] sentinel (skip [DONE] line but continue parsing)', () => {
    const sseResponse = [
      'data: {"delta":"Hello"}',
      '',
      'data: [DONE]',
      '',
      'data: {"delta":"After DONE"}',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    // [DONE] is skipped (not parsed as JSON), but subsequent lines are still processed
    expect(result.text).toBe('HelloAfter DONE');
  });

  it('should handle empty response with no data events', () => {
    const sseResponse = [
      'event: response.created',
      'data: {"type":"response.created"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('');
    expect(result.responseId).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
  });

  it('should handle malformed JSON in SSE line (gracefully skip)', () => {
    const sseResponse = [
      'data: {"delta":"Valid"}',
      '',
      'data: {invalid json here}',
      '',
      'data: {"delta":"After error"}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('ValidAfter error');
  });

  it('should handle escaped quotes in JSON', () => {
    const sseResponse = [
      'data: {"delta":"She said \\"Hello\\""}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('She said "Hello"');
  });

  it('should handle CRLF line endings', () => {
    const sseResponse = 'data: {"delta":"Line1"}\r\ndata: {"delta":"Line2"}\r\ndata: [DONE]\r\n';

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('Line1Line2');
  });

  it('should handle mixed response and delta formats', () => {
    const sseResponse = [
      'data: {"response":{"output_text":"Direct text"}}',
      '',
      'data: {"delta":"Streamed "}',
      '',
      'data: {"response":{"text":"More text"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toContain('Direct text');
    expect(result.text).toContain('Streamed');
    expect(result.text).toContain('More text');
  });

  it('should handle nested output arrays (complex format)', () => {
    const sseResponse = [
      'data: {"response":{"output":[{"type":"text","content":[{"text":"Nested"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toContain('Nested');
  });

  it('should ignore non-data lines (comments, empty)', () => {
    const sseResponse = [
      ': comment line',
      'event: created',
      'data: {"delta":"Text"}',
      '',
      'retry: 5000',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('Text');
  });

  it('should return empty result for completely empty input', () => {
    const result = parseResponsesSse('');
    expect(result).toEqual({
      text: '',
      responseId: undefined,
      outputTokens: undefined,
    });
  });

  it('should handle data lines with leading/trailing whitespace', () => {
    const sseResponse = [
      'data:  {"delta":"Padded"}  ',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('Padded');
  });

  it('should accumulate text across multiple response objects', () => {
    const sseResponse = [
      'data: {"response":{"output_text":"Part 1"}}',
      '',
      'data: {"response":{"text":"Part 2"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('Part 1Part 2');
  });

  it('should capture only first responseId (prevent overwrite)', () => {
    const sseResponse = [
      'data: {"response":{"id":"first_id"}}',
      '',
      'data: {"response":{"id":"second_id"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.responseId).toBe('first_id');
  });

  it('should capture only first outputTokens (prevent overwrite)', () => {
    const sseResponse = [
      'data: {"response":{"usage":{"output_tokens":10}}}',
      '',
      'data: {"response":{"usage":{"output_tokens":20}}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.outputTokens).toBe(10);
  });

  it('should handle null/undefined fields gracefully', () => {
    const sseResponse = [
      'data: {"response":null}',
      '',
      'data: {"delta":null}',
      '',
      'data: {"response":{"output_text":undefined}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const result = parseResponsesSse(sseResponse);
    expect(result.text).toBe('');
  });
});

describe('extractOutputTokens', () => {
  it('should extract output_tokens from usage object', () => {
    const response = { usage: { output_tokens: 123 } };
    expect(extractOutputTokens(response)).toBe(123);
  });

  it('should extract completion_tokens as fallback', () => {
    const response = { usage: { completion_tokens: 456 } };
    expect(extractOutputTokens(response)).toBe(456);
  });

  it('should extract output as second fallback', () => {
    const response = { usage: { output: 789 } };
    expect(extractOutputTokens(response)).toBe(789);
  });

  it('should prioritize output_tokens over completion_tokens', () => {
    const response = { usage: { output_tokens: 100, completion_tokens: 50 } };
    expect(extractOutputTokens(response)).toBe(100);
  });

  it('should return undefined when no token field present', () => {
    const response = { usage: {} };
    expect(extractOutputTokens(response)).toBeUndefined();
  });

  it('should return undefined when usage missing', () => {
    const response = {};
    expect(extractOutputTokens(response)).toBeUndefined();
  });

  it('should return undefined for non-finite values', () => {
    const response = { usage: { output_tokens: NaN } };
    expect(extractOutputTokens(response)).toBeUndefined();
  });

  it('should return undefined for non-number values', () => {
    const response = { usage: { output_tokens: 'not a number' } };
    expect(extractOutputTokens(response)).toBeUndefined();
  });

  it('should accept negative numbers as valid tokens (no validation)', () => {
    const response = { usage: { output_tokens: -5 } };
    expect(extractOutputTokens(response)).toBe(-5);
  });

  it('should handle float token counts (valid for some APIs)', () => {
    const response = { usage: { output_tokens: 123.5 } };
    expect(extractOutputTokens(response)).toBe(123.5);
  });

  it('should handle null value', () => {
    expect(extractOutputTokens(null)).toBeUndefined();
  });

  it('should handle undefined value', () => {
    expect(extractOutputTokens(undefined)).toBeUndefined();
  });

  it('should handle non-object value', () => {
    expect(extractOutputTokens('not an object')).toBeUndefined();
  });
});
