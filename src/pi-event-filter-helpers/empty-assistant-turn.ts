import type { PiEvent } from '../lib/event-timestamp-helpers.js';
import { extractMessageTextLength } from '../pi-event-filter-helpers.js';
import type { ProviderErrorSummary } from './types.js';

export interface AssistantTurnState {
  textLength: number;
  toolResultCount: number;
}

type Usage = Record<string, unknown> | null | undefined;

function usageValue(usage: Usage, keys: string[]): number | undefined {
  if (!usage) return undefined;

  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }

  return undefined;
}

function extractUsage(event: PiEvent): Usage {
  const candidate = (event as any).message?.usage
    ?? (event as any).usage
    ?? (event as any).assistantMessageEvent?.usage;
  return candidate && typeof candidate === 'object' ? candidate : null;
}

function responseId(message: any): string | undefined {
  const value = message?.responseId ?? message?.response_id;
  return typeof value === 'string' ? value : undefined;
}

function toolResultCount(event: PiEvent): number {
  const direct = (event as any).toolResults;
  if (Array.isArray(direct)) return direct.length;

  const calls = (event as any).message?.toolCalls ?? (event as any).message?.tool_calls;
  return Array.isArray(calls) ? calls.length : 0;
}

function hasAssistantOutput(event: PiEvent, priorState?: AssistantTurnState): boolean {
  return extractMessageTextLength((event as any).message) > 0
    || toolResultCount(event) > 0
    || (priorState?.textLength ?? 0) > 0
    || (priorState?.toolResultCount ?? 0) > 0;
}

function diagnosticDetails(
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

export function recordAssistantTurnState(event: PiEvent, states: Map<string, AssistantTurnState>): void {
  const id = responseId((event as any).message)
    ?? responseId((event as any).assistantMessageEvent?.message)
    ?? responseId((event as any).assistantMessageEvent?.partial);
  if (!id) return;

  const current = states.get(id) ?? { textLength: 0, toolResultCount: 0 };
  current.textLength += extractMessageTextLength((event as any).message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.message);
  current.textLength += extractMessageTextLength((event as any).assistantMessageEvent?.partial);
  current.toolResultCount += toolResultCount(event);
  states.set(id, current);
}

export function extractEmptyAssistantTurn(
  event: PiEvent,
  states: Map<string, AssistantTurnState>,
): ProviderErrorSummary | null {
  const message = (event as any).message;
  if (!message || typeof message !== 'object' || message.role !== 'assistant') return null;

  const stopReason = typeof message.stopReason === 'string' ? message.stopReason.trim() : '';
  if (stopReason !== 'stop') return null;

  const usage = extractUsage(event);
  const outputTokens = usageValue(usage, ['output', 'output_tokens', 'completion_tokens']);
  if (!outputTokens || outputTokens <= 0) return null;

  const id = responseId(message);
  if (hasAssistantOutput(event, id ? states.get(id) : undefined)) return null;

  const inputTokens = usageValue(usage, ['input', 'input_tokens', 'prompt_tokens']);
  const totalTokens = usageValue(usage, ['totalTokens', 'total_tokens', 'total']);
  const details = diagnosticDetails(message, id, inputTokens, outputTokens, totalTokens);

  return {
    type: 'provider_empty_assistant_turn',
    provider: typeof message.provider === 'string' ? message.provider : undefined,
    api: typeof message.api === 'string' ? message.api : undefined,
    model: typeof message.model === 'string' ? message.model : undefined,
    stop_reason: stopReason,
    response_id: id,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    message: `Provider returned a successful stop response with output tokens but no assistant text or tool calls. ${details}`.trim(),
  };
}
