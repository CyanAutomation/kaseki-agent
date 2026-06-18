#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function clean(value) {
  if (value === undefined || value === null) return '';
  const model = String(value).trim();
  if (!model) return '';
  const lower = model.toLowerCase();
  if (lower === 'unknown' || lower === 'null') return '';
  return model;
}

export function modelFromEventStream(eventsPath) {
  if (!eventsPath) return '';
  let content;
  try {
    content = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return '';
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
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

export function modelFromSummary(summaryPath) {
  if (!summaryPath) return '';
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  } catch {
    return '';
const modelId = process.argv[2];
if (!modelId) {
  console.error('Error: Model ID argument is required');
  process.exit(1);
}
  } catch (error) {
    // Check for specific error types
    if (error.name === 'ResourceNotFoundException' || error.name === 'ValidationException') {
      // Model not found or invalid - return fallback
      console.log(JSON.stringify({ modelId: modelId }));
    } else {
      // Re-throw other errors (permissions, network, etc.)
      console.error(`Error resolving model: ${error.message}`);
      process.exit(1);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [summaryPath, eventsPath] = process.argv.slice(2);
  process.stdout.write(`${resolveActualModel({ summaryPath, eventsPath })}\n`);
}
