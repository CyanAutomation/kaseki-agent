import type { PiEvent } from '../lib/event-timestamp-helpers.js';
import { extractMessageTextLength } from '../pi-event-filter-helpers.js';

export interface AssistantTurnState {
  textLength: number;
  toolResultCount: number;
}

function responseId(message: any): string | undefined {
  const value = message?.responseId ?? message?.response_id;
  return typeof value === 'string' ? value : undefined;
}

export function assistantToolResultCount(event: PiEvent): number {
  const direct = (event as any).toolResults;
  if (Array.isArray(direct)) return direct.length;

  const calls = (event as any).message?.toolCalls ?? (event as any).message?.tool_calls;
  return Array.isArray(calls) ? calls.length : 0;
}

export function recordAssistantTurnState(event: PiEvent, states: Map<string, AssistantTurnState>): void {
  const id = responseId((event as any).message)
    ?? responseId((event as any).assistantMessageEvent?.message)
    ?? responseId((event as any).assistantMessageEvent?.partial);
  if (!id) return;

  const current = states.get(id) ?? { textLength: 0, toolResultCount: 0 };
  current.textLength += extractMessageTextLength((event as any).message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.partial);
  current.toolResultCount += assistantToolResultCount(event);
  states.set(id, current);
}
