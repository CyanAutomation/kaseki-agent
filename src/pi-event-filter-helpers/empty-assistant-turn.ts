import type { PiEvent } from '../lib/event-timestamp-helpers.js';
import {
  type AssistantTurnState,
} from './assistant-turn-state.js';
import {
  diagnosticDetails,
  extractUsage,
  hasAssistantOutput,
  responseId,
  usageValue,
} from './empty-assistant-turn-details.js';
import type { ProviderErrorSummary } from './types.js';

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
