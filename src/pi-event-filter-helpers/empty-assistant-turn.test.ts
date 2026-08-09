import { describe, expect, it } from '@jest/globals';
import {
  extractEmptyAssistantTurn,
  recordAssistantTurnState,
} from './empty-assistant-turn.js';

function event(overrides: Record<string, unknown> = {}): any {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      stopReason: 'stop',
      content: null,
      provider: 'gateway',
      api: 'openai-responses',
      model: 'auto',
      response_id: 'resp-empty',
      usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      ...overrides,
    },
  };
}

describe('empty assistant turn classifier', () => {
  it('classifies a successful stop with output tokens and no output', () => {
    const result = extractEmptyAssistantTurn(event(), new Map());

    expect(result).toMatchObject({
      type: 'provider_empty_assistant_turn',
      provider: 'gateway',
      response_id: 'resp-empty',
      input_tokens: 10,
      output_tokens: 4,
      total_tokens: 14,
    });
  });

  it.each([
    ['not an assistant', { role: 'user' }],
    ['wrong stop reason', { stopReason: 'length' }],
    ['missing usage', { usage: undefined }],
    ['zero output tokens', { usage: { output_tokens: 0 } }],
    ['positive text output', { content: 'hello' }],
  ])('ignores %s', (_name, overrides) => {
    expect(extractEmptyAssistantTurn(event(overrides), new Map())).toBeNull();
  });

  it('supports alternate usage keys and omits absent metadata', () => {
    const result = extractEmptyAssistantTurn(event({
      provider: undefined,
      api: undefined,
      model: undefined,
      response_id: undefined,
      usage: { input: 7, output: 3, total: 10 },
    }), new Map());

    expect(result).toMatchObject({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
    expect(result?.message).toContain('output_tokens=3');
  });

  it('ignores a response that previously emitted text or tool results', () => {
    const states = new Map();
    recordAssistantTurnState({
      type: 'message_delta',
      message: { role: 'assistant', response_id: 'resp-empty', content: 'partial' },
    } as any, states);
    expect(extractEmptyAssistantTurn(event(), states)).toBeNull();

    const toolState = new Map([['resp-empty', { textLength: 0, toolResultCount: 1 }]]);
    expect(extractEmptyAssistantTurn(event(), toolState)).toBeNull();
  });

  it('recognizes response identifiers and state from alternate event shapes', () => {
    const states = new Map<string, { textLength: number; toolResultCount: number }>();
    recordAssistantTurnState({
      type: 'message_delta',
      assistantMessageEvent: {
        message: { responseId: 'alternate', content: 'partial' },
      },
    } as any, states);
    expect(states.get('alternate')).toEqual({ textLength: 7, toolResultCount: 0 });

    expect(extractEmptyAssistantTurn({
      type: 'message_end',
      message: {
        role: 'assistant', stopReason: ' stop ', responseId: 'new-response',
        content: null, usage: { completion_tokens: 2, prompt_tokens: 3, total: 5 },
        toolCalls: [],
      },
    } as any, states)).toMatchObject({ response_id: 'new-response', output_tokens: 2 });
  });

  it.each([
    ['assistant event usage', { assistantMessageEvent: { usage: { output: 2 } } }],
    ['direct usage', { usage: { output_tokens: 2 } }],
  ])('reads %s and reports diagnostic metadata', (_name, overrides) => {
    const result = extractEmptyAssistantTurn(event({
      provider: 'provider', api: 'api', model: 'model', ...overrides,
    }), new Map());
    expect(result).not.toBeNull();
    expect(result?.message).toContain('provider=provider');
    expect(result?.message).toContain('api=api');
  });

  it('ignores malformed usage, non-stop, negative, and tool-call output', () => {
    expect(extractEmptyAssistantTurn(event({ stopReason: 'STOP' }), new Map())).toBeNull();
    expect(extractEmptyAssistantTurn(event({ usage: { output_tokens: -1 } }), new Map())).toBeNull();
    expect(extractEmptyAssistantTurn(event({ usage: 'invalid' }), new Map())).toBeNull();
    expect(extractEmptyAssistantTurn(event({ toolCalls: [{ id: 'call-1' }] }), new Map())).toBeNull();
  });
});
