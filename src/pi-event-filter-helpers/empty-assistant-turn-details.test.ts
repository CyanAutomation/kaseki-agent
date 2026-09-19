import { describe, expect, it } from '@jest/globals';
import {
  diagnosticDetails,
  extractUsage,
  hasAssistantOutput,
  responseId,
  usageValue,
} from './empty-assistant-turn-details.js';

describe('empty assistant turn details', () => {
  it('reads finite usage values using the first matching key', () => {
    expect(usageValue({ output: Number.NaN, output_tokens: 4 }, ['output', 'output_tokens'])).toBe(4);
    expect(usageValue({ output: '4' }, ['output'])).toBeUndefined();
    expect(usageValue(null, ['output'])).toBeUndefined();
  });

  it('supports the event usage locations used by Pi adapters', () => {
    expect(extractUsage({ message: { usage: { output: 1 } } } as any)).toEqual({ output: 1 });
    expect(extractUsage({ usage: { output: 2 } } as any)).toEqual({ output: 2 });
    expect(extractUsage({ assistantMessageEvent: { usage: { output: 3 } } } as any)).toEqual({ output: 3 });
    expect(extractUsage({ usage: 'invalid' } as any)).toBeNull();
  });

  it('normalizes both response identifier spellings', () => {
    expect(responseId({ responseId: 'camel', response_id: 'snake' })).toBe('camel');
    expect(responseId({ response_id: 'snake' })).toBe('snake');
    expect(responseId({ responseId: 42 })).toBeUndefined();
  });

  it('detects text, tool, and prior-state output', () => {
    expect(hasAssistantOutput({ message: { content: 'text' } } as any)).toBe(true);
    expect(hasAssistantOutput({ message: { content: null, tool_calls: [{ id: 'tool' }] } } as any)).toBe(true);
    expect(hasAssistantOutput({ message: { content: null } } as any, { textLength: 1, toolResultCount: 0 })).toBe(true);
    expect(hasAssistantOutput({ message: { content: null } } as any, { textLength: 0, toolResultCount: 0 })).toBe(false);
  });

  it('formats only available diagnostic fields', () => {
    expect(diagnosticDetails({ provider: 'gateway', model: 'auto' }, undefined, undefined, 4, undefined))
      .toBe('provider=gateway model=auto output_tokens=4');
  });

  describe('usageValue edge cases', () => {
    it('returns undefined for infinity', () => {
      expect(usageValue({ output: Infinity }, ['output'])).toBeUndefined();
      expect(usageValue({ output: -Infinity }, ['output'])).toBeUndefined();
    });

    it('returns undefined for negative infinity', () => {
      expect(usageValue({ output: -Infinity }, ['output'])).toBeUndefined();
    });

    it('returns 0 as a valid value', () => {
      expect(usageValue({ output: 0 }, ['output'])).toBe(0);
    });

    it('ignores non-finite values and continues to next key', () => {
      expect(usageValue({ output: NaN, output_tokens: 100 }, ['output', 'output_tokens'])).toBe(100);
      expect(usageValue({ output: Infinity, output_tokens: 50 }, ['output', 'output_tokens'])).toBe(50);
    });

    it('returns undefined when all keys map to non-finite numbers', () => {
      expect(usageValue({ output: NaN, output_tokens: Infinity }, ['output', 'output_tokens'])).toBeUndefined();
    });

    it('returns first valid key when multiple match', () => {
      expect(usageValue({ output_tokens: 100, cache_tokens: 50 }, ['output_tokens', 'cache_tokens'])).toBe(100);
    });
  });

  describe('extractUsage edge cases', () => {
    it('returns null for undefined usage', () => {
      expect(extractUsage({ message: { usage: undefined } } as any)).toBeNull();
    });

    it('returns null for null usage', () => {
      expect(extractUsage({ message: { usage: null } } as any)).toBeNull();
    });

    it('returns null for string usage', () => {
      expect(extractUsage({ message: { usage: 'invalid' } } as any)).toBeNull();
    });

    it('returns array usage as-is (arrays are objects)', () => {
      expect(extractUsage({ message: { usage: [] } } as any)).toEqual([]);
    });

    it('prioritizes message.usage over usage', () => {
      const event = {
        message: { usage: { output: 1 } },
        usage: { output: 2 },
      };
      expect(extractUsage(event as any)).toEqual({ output: 1 });
    });

    it('prioritizes usage over assistantMessageEvent.usage', () => {
      const event = {
        usage: { output: 2 },
        assistantMessageEvent: { usage: { output: 3 } },
      };
      expect(extractUsage(event as any)).toEqual({ output: 2 });
    });

    it('returns empty object when present', () => {
      expect(extractUsage({ message: { usage: {} } } as any)).toEqual({});
    });
  });

  describe('responseId edge cases', () => {
    it('returns undefined for null responseId', () => {
      expect(responseId({ responseId: null })).toBeUndefined();
    });

    it('returns undefined for number responseId', () => {
      expect(responseId({ responseId: 123 })).toBeUndefined();
    });

    it('returns undefined for undefined responseId', () => {
      expect(responseId({ responseId: undefined })).toBeUndefined();
    });

    it('prefers responseId (camelCase) over response_id', () => {
      expect(responseId({ responseId: 'camel', response_id: 'snake' })).toBe('camel');
    });

    it('handles empty string responseId', () => {
      expect(responseId({ responseId: '' })).toBe('');
    });

    it('handles null and undefined together', () => {
      expect(responseId({})).toBeUndefined();
      expect(responseId(null)).toBeUndefined();
    });
  });

  describe('hasAssistantOutput edge cases', () => {
    it('returns false for empty event with no prior state', () => {
      expect(hasAssistantOutput({ type: 'message_delta' } as any)).toBe(false);
    });

    it('returns true for prior state text', () => {
      expect(hasAssistantOutput({ message: {} } as any, { textLength: 100, toolResultCount: 0 })).toBe(true);
    });

    it('returns true for prior state tool results', () => {
      expect(hasAssistantOutput({ message: { content: null } } as any, { textLength: 0, toolResultCount: 5 })).toBe(true);
    });

    it('returns true when both current and prior state have output', () => {
      expect(hasAssistantOutput(
        { message: { content: 'text', tool_calls: [{ id: '1' }] } } as any,
        { textLength: 50, toolResultCount: 2 },
      )).toBe(true);
    });

    it('detects message content text length > 0', () => {
      expect(hasAssistantOutput({ message: { content: 'x' } } as any)).toBe(true);
    });

    it('detects message tool calls', () => {
      expect(hasAssistantOutput({ message: { tool_calls: [{ id: '1' }, { id: '2' }] } } as any)).toBe(true);
    });

    it('treats undefined prior state as zero values', () => {
      expect(hasAssistantOutput({ message: { content: null } } as any, undefined)).toBe(false);
    });

    it('handles prior state with only textLength', () => {
      expect(hasAssistantOutput({ message: { content: null } } as any, { textLength: 1, toolResultCount: 0 })).toBe(true);
    });

    it('handles prior state with only toolResultCount', () => {
      expect(hasAssistantOutput({ message: { content: null } } as any, { textLength: 0, toolResultCount: 1 })).toBe(true);
    });
  });

  describe('diagnosticDetails formatting', () => {
    it('includes all fields when present', () => {
      const result = diagnosticDetails(
        { provider: 'openai', api: 'v1', model: 'gpt-4' },
        'resp-123',
        1000,
        500,
        1500,
      );
      expect(result).toContain('provider=openai');
      expect(result).toContain('api=v1');
      expect(result).toContain('model=gpt-4');
      expect(result).toContain('response_id=resp-123');
      expect(result).toContain('input_tokens=1000');
      expect(result).toContain('output_tokens=500');
      expect(result).toContain('total_tokens=1500');
    });

    it('omits undefined inputTokens', () => {
      const result = diagnosticDetails(
        { provider: 'openai', model: 'gpt-4' },
        'resp-123',
        undefined,
        500,
        1500,
      );
      expect(result).not.toContain('input_tokens');
      expect(result).toContain('output_tokens=500');
    });

    it('omits undefined totalTokens', () => {
      const result = diagnosticDetails(
        { provider: 'openai', model: 'gpt-4' },
        'resp-123',
        1000,
        500,
        undefined,
      );
      expect(result).not.toContain('total_tokens');
      expect(result).toContain('output_tokens=500');
    });

    it('includes 0 values for tokens', () => {
      const result = diagnosticDetails(
        { provider: 'openai', model: 'gpt-4' },
        'resp-123',
        0,
        0,
        0,
      );
      expect(result).toContain('input_tokens=0');
      expect(result).toContain('output_tokens=0');
      expect(result).toContain('total_tokens=0');
    });

    it('omits non-string fields', () => {
      const result = diagnosticDetails(
        { provider: 123, api: null, model: {} } as any,
        'resp-123',
        1000,
        500,
        1500,
      );
      expect(result).not.toContain('provider');
      expect(result).not.toContain('api');
      expect(result).not.toContain('model');
      expect(result).toContain('response_id=resp-123');
    });

    it('omits null response ID', () => {
      const result = diagnosticDetails(
        { provider: 'openai', model: 'gpt-4' },
        undefined,
        1000,
        500,
        1500,
      );
      expect(result).not.toContain('response_id');
    });

    it('joins fields with spaces', () => {
      const result = diagnosticDetails(
        { provider: 'openai', api: 'v1', model: 'gpt-4' },
        'resp-123',
        1000,
        500,
        1500,
      );
      const fields = result.split(' ');
      expect(fields.length).toBe(7);
      fields.forEach(field => {
        expect(field).toMatch(/^\w+=.+$/);
      });
    });
  });
});
