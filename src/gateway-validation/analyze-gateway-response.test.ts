import {
  analyzeMessageFields,
  analyzeResponseStructure,
  buildSuggestedPatterns,
  countPiJsonEvents,
  extractOutputTokens,
  extractSampleEventStructure,
  parseResponsesSse,
} from './analyze-gateway-response';

// ─── analyzeMessageFields ────────────────────────────────────────────────────

describe('analyzeMessageFields', () => {
  it('returns empty result for empty message', () => {
    const result = analyzeMessageFields({});
    expect(result.fieldsPresent).toEqual([]);
    expect(result.hasNonEmptyText).toBe(false);
  });

  it('detects message.text', () => {
    const result = analyzeMessageFields({ text: 'hello' });
    expect(result.fieldsPresent).toContain('message.text');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects message.text as present but empty', () => {
    const result = analyzeMessageFields({ text: '   ' });
    expect(result.fieldsPresent).toContain('message.text');
    expect(result.hasNonEmptyText).toBe(false);
  });

  it('detects message.output_text', () => {
    const result = analyzeMessageFields({ output_text: 'response text' });
    expect(result.fieldsPresent).toContain('message.output_text');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects message.content (string)', () => {
    const result = analyzeMessageFields({ content: 'some content' });
    expect(result.fieldsPresent).toContain('message.content (string)');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects message.content (array) with text parts', () => {
    const result = analyzeMessageFields({ content: [{ text: 'chunk' }] });
    expect(result.fieldsPresent).toContain('message.content (array)');
    expect(result.fieldsPresent).toContain('message.content[].text');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects choices[0].message.content', () => {
    const result = analyzeMessageFields({ choices: [{ message: { content: 'chat reply' } }] });
    expect(result.fieldsPresent).toContain('message.choices[]');
    expect(result.fieldsPresent).toContain('message.choices[0].message.content');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects choices[0].delta.content', () => {
    const result = analyzeMessageFields({ choices: [{ delta: { content: 'stream chunk' } }] });
    expect(result.fieldsPresent).toContain('message.choices[0].delta.content');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects message.delta.content (streaming direct)', () => {
    const result = analyzeMessageFields({ delta: { content: 'delta text' } });
    expect(result.fieldsPresent).toContain('message.delta.content');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('detects message.response.content (wrapped)', () => {
    const result = analyzeMessageFields({ response: { content: 'wrapped text' } });
    expect(result.fieldsPresent).toContain('message.response.content');
    expect(result.hasNonEmptyText).toBe(true);
  });

  it('ignores non-string field values', () => {
    const result = analyzeMessageFields({ text: 42, output_text: null });
    expect(result.fieldsPresent).toEqual([]);
    expect(result.hasNonEmptyText).toBe(false);
  });

  it('handles content array with output_text and content fields', () => {
    const result = analyzeMessageFields({ content: [{ output_text: 'ot' }, { content: 'c' }] });
    expect(result.fieldsPresent).toContain('message.content[].output_text');
    expect(result.fieldsPresent).toContain('message.content[].content');
    expect(result.hasNonEmptyText).toBe(true);
  });
});

// ─── buildSuggestedPatterns ───────────────────────────────────────────────────

describe('buildSuggestedPatterns', () => {
  it('returns empty array for empty set', () => {
    expect(buildSuggestedPatterns(new Set())).toEqual([]);
  });

  it('returns legacy Pi patterns', () => {
    const patterns = buildSuggestedPatterns(new Set(['message.text', 'message.output_text']));
    expect(patterns).toContain('message.text (legacy Pi)');
    expect(patterns).toContain('message.output_text (legacy Pi)');
  });

  it('returns chat completions pattern', () => {
    const patterns = buildSuggestedPatterns(new Set(['message.choices[0].message.content']));
    expect(patterns).toContain('choices[0].message.content (Chat Completions)');
  });

  it('returns streaming patterns', () => {
    const patterns = buildSuggestedPatterns(
      new Set(['message.choices[0].delta.content', 'message.delta.content']),
    );
    expect(patterns).toContain('choices[0].delta.content (streaming)');
    expect(patterns).toContain('message.delta.content (streaming direct)');
  });

  it('returns Cloudflare and wrapped patterns', () => {
    const patterns = buildSuggestedPatterns(
      new Set(['message.content (string)', 'message.response.content']),
    );
    expect(patterns).toContain('message.content string (Cloudflare)');
    expect(patterns).toContain('response.content (wrapped)');
  });
});

// ─── analyzeResponseStructure ────────────────────────────────────────────────

const makeEvent = (type: string, role: string, fields: Record<string, any>) =>
  JSON.stringify({ type, message: { role, ...fields } });

describe('analyzeResponseStructure', () => {
  it('handles empty input', () => {
    const result = analyzeResponseStructure('');
    expect(result.eventCount).toBe(0);
    expect(result.eventsByType).toEqual({});
    expect(result.fieldsFound).toEqual([]);
  });

  it('counts events by type', () => {
    const stdout = [
      makeEvent('message', 'assistant', { text: 'hi' }),
      makeEvent('message', 'assistant', { text: 'there' }),
      makeEvent('tool_result', 'user', { content: 'ok' }),
    ].join('\n');
    const result = analyzeResponseStructure(stdout);
    expect(result.eventCount).toBe(3);
    expect(result.eventsByType['message']).toBe(2);
    expect(result.eventsByType['tool_result']).toBe(1);
  });

  it('separates assistant fields from non-assistant fields', () => {
    const stdout = [
      makeEvent('message', 'assistant', { text: 'reply' }),
      makeEvent('message', 'user', { text: 'prompt' }),
    ].join('\n');
    const result = analyzeResponseStructure(stdout);
    expect(result.assistantFieldsFound).toContain('message.text');
    expect(result.nonAssistantFieldsFound.some((f) => f.includes('message.text'))).toBe(true);
    expect(result.assistantEventsWithText).toBe(1);
    expect(result.nonAssistantEventsWithText).toBe(1);
  });

  it('skips non-JSON lines', () => {
    const stdout = 'not json\n  \n' + makeEvent('message', 'assistant', { text: 'hi' });
    const result = analyzeResponseStructure(stdout);
    expect(result.eventCount).toBe(1);
  });

  it('skips events without message field', () => {
    const result = analyzeResponseStructure(JSON.stringify({ type: 'ping' }));
    expect(result.eventCount).toBe(1);
    expect(result.fieldsFound).toEqual([]);
  });

  it('populates suggestedPatterns from assistant fields', () => {
    const stdout = makeEvent('message', 'assistant', { text: 'hi' });
    const result = analyzeResponseStructure(stdout);
    expect(result.suggestedPatterns).toContain('message.text (legacy Pi)');
  });

  it('eventsWithText equals assistantEventsWithText', () => {
    const stdout = makeEvent('message', 'assistant', { text: 'hi' });
    const result = analyzeResponseStructure(stdout);
    expect(result.eventsWithText).toBe(result.assistantEventsWithText);
  });
});

// ─── countPiJsonEvents ────────────────────────────────────────────────────────

describe('countPiJsonEvents', () => {
  it('counts only lines starting with {', () => {
    const stdout = '{"a":1}\n  {"b":2}\nnot json\n{"c":3}';
    expect(countPiJsonEvents(stdout)).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countPiJsonEvents('')).toBe(0);
  });
});

// ─── extractOutputTokens ─────────────────────────────────────────────────────

describe('extractOutputTokens', () => {
  it('extracts output_tokens', () => {
    expect(extractOutputTokens({ usage: { output_tokens: 42 } })).toBe(42);
  });

  it('falls back to output', () => {
    expect(extractOutputTokens({ usage: { output: 10 } })).toBe(10);
  });

  it('falls back to completion_tokens', () => {
    expect(extractOutputTokens({ usage: { completion_tokens: 7 } })).toBe(7);
  });

  it('returns undefined for missing usage', () => {
    expect(extractOutputTokens({})).toBeUndefined();
  });

  it('ignores non-finite values', () => {
    expect(extractOutputTokens({ usage: { output_tokens: Infinity } })).toBeUndefined();
  });
});

// ─── parseResponsesSse ───────────────────────────────────────────────────────

describe('parseResponsesSse', () => {
  it('extracts delta text from SSE stream', () => {
    const body = 'data: {"delta":"hello "}\ndata: {"delta":"world"}\n';
    const result = parseResponsesSse(body);
    expect(result.text).toBe('hello world');
  });

  it('extracts responseId from response.id', () => {
    const body = 'data: {"delta":"x","response":{"id":"resp-123"}}\n';
    const result = parseResponsesSse(body);
    expect(result.responseId).toBe('resp-123');
  });

  it('extracts responseId from item.id', () => {
    const body = 'data: {"item":{"id":"item-456"}}\n';
    const result = parseResponsesSse(body);
    expect(result.responseId).toBe('item-456');
  });

  it('skips [DONE] lines', () => {
    const body = 'data: {"delta":"hi"}\ndata: [DONE]\n';
    const result = parseResponsesSse(body);
    expect(result.text).toBe('hi');
  });

  it('skips malformed JSON', () => {
    const body = 'data: {bad json}\ndata: {"delta":"ok"}\n';
    const result = parseResponsesSse(body);
    expect(result.text).toBe('ok');
  });

  it('extracts outputTokens via usage', () => {
    const body = 'data: {"response":{"usage":{"output_tokens":5}}}\n';
    const result = parseResponsesSse(body);
    expect(result.outputTokens).toBe(5);
  });
});

// ─── extractSampleEventStructure ─────────────────────────────────────────────

describe('extractSampleEventStructure', () => {
  it('returns empty array for non-JSON stdout', () => {
    expect(extractSampleEventStructure('no json here')).toEqual([]);
  });

  it('returns sanitized structures for JSON lines', () => {
    const stdout = '{"type":"message","text":"hello world"}\n';
    const result = extractSampleEventStructure(stdout);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('string(7)');
  });

  it('limits to 5 lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `{"n":${i}}`).join('\n');
    const result = extractSampleEventStructure(lines);
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
