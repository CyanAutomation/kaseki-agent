#!/usr/bin/env node

/**
 * Resolve Actual Model Attribution
 *
 * Attempts to determine the actual model used by a kaseki run via a 3-tier fallback chain:
 * 1. Event stream (pi-events.jsonl) - look for first model event
 * 2. Summary counters - if exactly 1 model used, extract from counters
 * 3. Summary metadata - if selected_model or model field exists
 *
 * Returns 'unknown' if all tiers fail.
 *
 * CLI Usage: npx ts-node scripts/resolve-actual-model.ts <summaryPath> <eventsPath>
 */

import fs from 'node:fs';

/**
 * Normalize and validate a model string
 * @internal
 */
function clean(value: unknown): string {
  if (value === undefined || value === null) return '';
  const model = String(value).trim();
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower === 'unknown' || lower === 'null' || lower === 'undefined') return '';
  if (/[\r\n\0]/.test(model)) return '';
  return model;
}

/**
 * Extract model from event stream (JSONL)
 * Scans lines sequentially; returns first valid model found
 * @internal
 */
function modelFromEventStream(eventsPath: string | undefined): string {
  if (!eventsPath) return '';
  let content: string;
  try {
    content = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return '';
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      const model = clean(event && event.model);
      if (model) return model;
    } catch {
      // Ignore malformed event lines; attribution is best-effort metadata.
    }
  }
  return '';
}

/**
 * Extract model from summary counters
 * Returns the model only if exactly 1 unique model was counted (no ambiguity)
 * @internal
 */
function modelFromSummaryCounters(summary: Record<string, unknown> | undefined): string {
  const counters = (summary && (summary as Record<string, unknown>).counters) as Record<string, unknown> | undefined;
  const models = (counters && typeof counters === 'object' && !Array.isArray(counters) ? (counters as Record<string, unknown>).models : undefined) as Record<string, unknown> | undefined;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return '';

  const entries = Object.entries(models).filter(([model, count]) => clean(model) && Number(count) > 0);
  if (entries.length !== 1) return '';
  return clean(entries[0][0]);
}

/**
 * Extract model from summary JSON
 * Tries selected_model, then model, then falls back to counters
 * @internal
 */
function modelFromSummary(summaryPath: string | undefined): string {
  if (!summaryPath) return '';
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return '';
  }

  return clean(summary.selected_model) || clean(summary.model) || modelFromSummaryCounters(summary);
}

/**
 * Resolve the actual model used in a kaseki run
 * Uses 3-tier fallback: event stream → summary → 'unknown'
 *
 * @param summaryPath - Path to pi-summary.json
 * @param eventsPath - Path to pi-events.jsonl
 * @returns Model string or 'unknown'
 */
export function resolveActualModel({ summaryPath, eventsPath }: { summaryPath?: string; eventsPath?: string } = {}): string {
  return modelFromEventStream(eventsPath) || modelFromSummary(summaryPath) || 'unknown';
}
