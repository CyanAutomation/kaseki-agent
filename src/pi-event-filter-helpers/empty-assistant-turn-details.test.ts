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
});
