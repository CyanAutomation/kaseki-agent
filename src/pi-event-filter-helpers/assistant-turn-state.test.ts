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

  it('accumulates text length across multiple events for the same response ID', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-1', content: 'hello' },
    } as any, states);

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-1', content: ' world' },
    } as any, states);

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-1', content: '!' },
    } as any, states);

    const state = states.get('resp-1');
    // 'hello' (5) + 'world' trimmed (5) + '!' (1) = 11
    expect(state?.textLength).toBe(11);
    expect(state?.toolResultCount).toBe(0);
  });

  it('tracks multiple response IDs independently', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-1', content: 'first' },
    } as any, states);

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-2', content: 'second' },
    } as any, states);

    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'resp-1', content: ' again' },
    } as any, states);

    expect(states.size).toBe(2);
    expect(states.has('resp-1')).toBe(true);
    expect(states.has('resp-2')).toBe(true);
    expect(states.get('resp-1')?.textLength).toBeGreaterThan(states.get('resp-2')?.textLength || 0);
  });

  it('accumulates tool result counts across multiple events', () => {
    const states = new Map();

    recordAssistantTurnState({
      type: 'tool_result',
      message: { response_id: 'resp-3', tool_calls: [{ id: 'call-1' }] },
    } as any, states);

    recordAssistantTurnState({
      type: 'tool_result',
      message: { response_id: 'resp-3' },
      toolResults: [{ id: 'result-1' }, { id: 'result-2' }],
    } as any, states);

    const state = states.get('resp-3');
    expect(state?.toolResultCount).toBe(3); // 1 tool call + 2 tool results
  });

  it('handles events with toolResults in message shape', () => {
    expect(assistantToolResultCount({
      message: { response_id: 'resp-1', tool_calls: [{ id: 'call-1' }, { id: 'call-2' }, { id: 'call-3' }] },
    } as any)).toBe(3);
  });

  it('handles events with no toolResults or tool_calls', () => {
    expect(assistantToolResultCount({ message: { response_id: 'resp-1', content: 'text only' } } as any)).toBe(0);
    expect(assistantToolResultCount({ type: 'message_delta' } as any)).toBe(0);
  });

  it('prioritizes direct toolResults over nested tool_calls in assistantToolResultCount', () => {
    // When both direct toolResults and nested tool_calls exist, direct takes precedence
    expect(assistantToolResultCount({
      toolResults: [{ id: 'result-1' }],
      message: { tool_calls: [{ id: 'call-1' }, { id: 'call-2' }] },
    } as any)).toBe(1); // Returns direct toolResults length
  });

  it('handles empty tool arrays correctly', () => {
    expect(assistantToolResultCount({ toolResults: [] } as any)).toBe(0);
    expect(assistantToolResultCount({ message: { tool_calls: [] } } as any)).toBe(0);
  });

  it('preserves state across fallback response ID lookups', () => {
    const states = new Map();

    // Event with response ID in assistantMessageEvent.message (2nd fallback)
    recordAssistantTurnState({
      type: 'message_delta',
      assistantMessageEvent: {
        message: { responseId: 'fallback-resp', content: 'first' },
      },
    } as any, states);

    // Same response ID from another location
    recordAssistantTurnState({
      type: 'message_delta',
      message: { response_id: 'fallback-resp', content: ' second' },
    } as any, states);

    const state = states.get('fallback-resp');
    expect(state?.textLength).toBeGreaterThan(0);
  });
});
