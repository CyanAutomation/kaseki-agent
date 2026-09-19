/**
 * Token usage accounting helpers extracted from run-scorecard-evidence-tokens.ts
 * Handles token field normalization, usage validation, and phase tracking
 */

import type { UsageObject } from './pi-event-aggregation/token-usage-aggregator';
import { number, object } from './run-scorecard-guards';

const phases = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;

/**
 * Normalize a phase name to its canonical form.
 * @param value Raw phase identifier (may use hyphens, spaces, mixed case)
 * @returns Canonical phase key, or 'coding' if unrecognized
 */
export function canonicalPhase(value: string): typeof phases[number] {
  const normalized = value.toLowerCase().replace(/[- ]/g, '_');
  return (phases as readonly string[]).includes(normalized) ? (normalized as typeof phases[number]) : 'coding';
}

/**
 * Normalize token usage fields to standard keys.
 * Handles multiple naming conventions used by different providers.
 * @param raw Token usage object with variant field names
 * @returns Normalized UsageObject with standard keys
 */
export function normalizedUsage(raw: Record<string, unknown>): UsageObject {
  return {
    prompt_tokens: number(raw.prompt_tokens) ?? number(raw.total_input_tokens) ?? number(raw.input_tokens),
    completion_tokens: number(raw.completion_tokens) ?? number(raw.total_output_tokens) ?? number(raw.output_tokens),
    input: number(raw.input),
    output: number(raw.output),
    cacheRead: number(raw.cacheRead) ?? number(raw.total_cache_read_tokens) ?? number(raw.cache_read_tokens),
    cacheWrite: number(raw.cacheWrite) ?? number(raw.total_cache_creation_tokens) ?? number(raw.cache_creation_tokens),
    prompt_tokens_details: object(raw.prompt_tokens_details) as UsageObject['prompt_tokens_details'],
  };
}

/**
 * Check if a usage object contains any meaningful token counts.
 * @param value UsageObject to validate
 * @returns true if at least one token field has a value, false if completely empty
 */
export function hasUsage(value: UsageObject): boolean {
  return [
    value.prompt_tokens,
    value.completion_tokens,
    value.input,
    value.output,
    value.cacheRead,
    value.cacheWrite,
  ].some(item => number(item) !== undefined) || value.prompt_tokens_details !== undefined;
}

/**
 * Generate a unique identity for deduplication.
 * Uses response ID if available, falls back to request ID + turn, then index.
 * @param phase Phase name
 * @param responseId Response identifier (preferred)
 * @param requestId Request identifier (fallback)
 * @param turn Turn number (only with requestId)
 * @param index Array index (last resort)
 * @returns Unique identity string for tracking duplicates
 */
export function generateIdentity(
  phase: string,
  responseId: unknown,
  requestId: unknown,
  turn: number | undefined,
  index: number,
): string {
  if (responseId !== undefined) {
    return `${phase}:response:${String(responseId)}`;
  }
  if (requestId !== undefined && turn !== undefined) {
    return `${phase}:request:${String(requestId)}:turn:${turn}`;
  }
  return `${phase}:${String(requestId ?? index)}`;
}

/**
 * Extract and normalize a usage object from various raw formats.
 * @param summary Raw summary object that may have token_usage or usage fields
 * @returns Normalized UsageObject
 */
export function extractUsageFromSummary(summary: Record<string, unknown>): UsageObject {
  const usageField = object(summary.usage) ?? object(summary.token_usage) ?? summary;
  return normalizedUsage(usageField as Record<string, unknown>);
}

/**
 * Extract model name from summary with fallback handling.
 * @param summary Raw summary object
 * @returns Model name or 'unknown' if not found
 */
export function extractModelName(summary: Record<string, unknown>): string {
  return String(summary.model ?? summary.selected_model ?? 'unknown');
}
