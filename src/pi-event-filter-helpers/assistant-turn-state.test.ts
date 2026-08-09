import { describe, expect, it } from '@jest/globals';
import {
  assistantToolResultCount,
  recordAssistantTurnState,
} from './assistant-turn-state.js';

describe('assistant turn state', () => {
  it('records text from message and alternate assistant event shapes', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'response-1', content: 'hello' },
      assistantMessageEvent: {
        message: { responseId: 'ignored', content: 'alternate' },
      },
    } as any, states);

    expect(states.get('response-1')).toEqual({ textLength: 14, toolResultCount: 0 });
  });

  it('uses response IDs from assistant message events when the direct message has none', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'message_delta',
      assistantMessageEvent: {
        partial: { responseId: 'response-2', content: [{ type: 'text', text: 'partial' }] },
      },
    } as any, states);

    expect(states.get('response-2')).toEqual({ textLength: 7, toolResultCount: 0 });
  });

  it('counts direct tool results and message tool calls', () => {
    expect(assistantToolResultCount({ toolResults: [{ id: 'result-1' }] } as any)).toBe(1);
    expect(assistantToolResultCount({ message: { tool_calls: [{ id: 'call-1' }, { id: 'call-2' }] } } as any)).toBe(2);
  });

  it('ignores events without a response ID', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'message_delta',
      message: { content: 'untracked' },
    } as any, states);

    expect(states.size).toBe(0);
  });
});
