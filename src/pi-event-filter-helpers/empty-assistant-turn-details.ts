import type { PiEvent } from '../lib/event-timestamp-helpers.js';
import { extractMessageTextLength } from '../pi-event-filter-helpers.js';
import {
  assistantToolResultCount,
  type AssistantTurnState,
} from './assistant-turn-state.js';

type Usage = Record<string, unknown> | null | undefined;

export function usageValue(usage: Usage, keys: string[]): number | undefined {
  if (!usage) return undefined;

  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }

  return undefined;
}

export function extractUsage(event: PiEvent): Usage {
  const candidate = (event as any).message?.usage
    ?? (event as any).usage
    ?? (event as any).assistantMessageEvent?.usage;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

export function responseId(message: any): string | undefined {
  const value = message?.responseId ?? message?.response_id;
  return typeof value === 'string' ? value : undefined;
}

export function hasAssistantOutput(event: PiEvent, priorState?: AssistantTurnState): boolean {
  return extractMessageTextLength((event as any).message) > 0
    || assistantToolResultCount(event) > 0
    || (priorState?.textLength ?? 0) > 0
    || (priorState?.toolResultCount ?? 0) > 0;
}

export function diagnosticDetails(
  message: any,
  response: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number,
  totalTokens: number | undefined,
): string {
  return [
    typeof message.provider === 'string' ? `provider=${message.provider}` : '',
    typeof message.api === 'string' ? `api=${message.api}` : '',
    typeof message.model === 'string' ? `model=${message.model}` : '',
    response ? `response_id=${response}` : '',
    inputTokens !== undefined ? `input_tokens=${inputTokens}` : '',
    `output_tokens=${outputTokens}`,
    totalTokens !== undefined ? `total_tokens=${totalTokens}` : '',
  ].filter(Boolean).join(' ');
}
