#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @private
 */
function clean(value) {
  if (value === undefined || value === null) return '';
  const model = String(value).trim();
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower === 'unknown' || lower === 'null' || lower === 'undefined') return '';
  if (/[\r\n\0]/.test(model)) return '';
  return model;
}

/**
 * @private
 */
function modelFromEventStream(eventsPath) {
  if (!eventsPath) return '';
  let content;
  try {
    content = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return '';
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed);
      const model = clean(event && event.model);
      if (model) return model;
    } catch {
      // Ignore malformed event lines; attribution is best-effort metadata.
    }
  }
  return '';
}

function modelFromSummaryCounters(summary) {
  const counters = summary && summary.counters && summary.counters.models;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return '';

  const entries = Object.entries(counters).filter(([model, count]) => clean(model) && Number(count) > 0);
  if (entries.length !== 1) return '';
  return clean(entries[0][0]);
}

/**
 * @private
 */
function modelFromSummary(summaryPath) {
  if (!summaryPath) return '';
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch {
    return '';
  }

  return clean(summary.selected_model) || clean(summary.model) || modelFromSummaryCounters(summary);
}

export function resolveActualModel({ summaryPath, eventsPath } = {}) {
  return modelFromEventStream(eventsPath) || modelFromSummary(summaryPath) || 'unknown';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [summaryPath, eventsPath] = process.argv.slice(2);
  if (!summaryPath || !eventsPath) {
    console.error('Usage: resolve-actual-model.js <summaryPath> <eventsPath>');
    process.exit(1);
  }
  process.stdout.write(`${resolveActualModel({ summaryPath, eventsPath })}\n`);
}
