#!/usr/bin/env node
/** Offline, read-only calibration report for historical run-scorecard artifacts. */
import fs from 'node:fs';
import path from 'node:path';

interface Card {
  overall_score?: number;
  rubric_version?: string;
  scoring_config?: { task_size?: string };
  dimensions?: Array<{ id?: string; normalized_score?: number }>;
  timing_totals?: { wall_clock_ms?: number };
  token_totals?: Record<string, number>;
  model?: string;
}

interface Row {
  band: string;
  model: string;
  rubric: string;
  score: number;
  duration: number;
  tokens: number;
  dimensions: Record<string, number>;
}

function readRow(file: string): Row {
  const card = JSON.parse(fs.readFileSync(file, 'utf8')) as Card;
  if (typeof card.overall_score !== 'number') throw new Error('missing score');
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'metadata.json'), 'utf8')) as Record<string, unknown>; } catch { /* optional */ }
  const usage = card.token_totals ?? {};
  return {
    band: card.scoring_config?.task_size ?? 'unknown',
    model: card.model ?? String(metadata.actual_model ?? metadata.model ?? metadata.selected_model ?? 'unknown'),
    rubric: card.rubric_version ?? 'unknown',
    score: card.overall_score,
    duration: card.timing_totals?.wall_clock_ms ?? 0,
    tokens: ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'].reduce((total, key) => total + (usage[key] ?? 0), 0),
    dimensions: Object.fromEntries((card.dimensions ?? []).map(dimension => [dimension.id ?? 'unknown', dimension.normalized_score ?? 0])),
  };
}

function dimensionDiscrimination(rows: Row[]) {
  const ids = [...new Set(rows.flatMap(row => Object.keys(row.dimensions)))].sort();
  return Object.fromEntries(ids.map(id => {
    const values = rows.map(row => row.dimensions[id]).filter((value): value is number => typeof value === 'number');
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
    return [id, { range, standard_deviation: Number(Math.sqrt(variance).toFixed(2)), low_discrimination: values.length > 1 && range < 10 }];
  }));
}

const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

function find(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name === 'run-scorecard.json') found.push(file);
      }
    } catch {
      // Historical result trees may contain directories unreadable by this user.
    }
  };
  visit(root);
  return found.sort();
}

function group(rows: Row[], key: (row: Row) => string) {
  return Object.fromEntries([...new Set(rows.map(key))].sort().map(value => {
    const selected = rows.filter(row => key(row) === value);
    return [value, {
      runs: selected.length,
      score: {
        p10: percentile(selected.map(row => row.score), .1),
        median: percentile(selected.map(row => row.score), .5),
        p90: percentile(selected.map(row => row.score), .9),
      },
      recommended_targets: {
        duration_seconds_p75: Math.round(percentile(selected.map(row => row.duration), .75) / 1000),
        tokens_p75: Math.round(percentile(selected.map(row => row.tokens), .75)),
      },
    }];
  }));
}

export function calibrate(root: string) {
  const invalid: string[] = [];
  const rows: Row[] = [];
  for (const file of find(root)) {
    try { rows.push(readRow(file)); } catch { invalid.push(file); }
  }

  return {
    source: path.resolve(root),
    read_only: true,
    runs: rows.length,
    invalid_files: invalid,
    distributions: {
      task_size: group(rows, row => row.band),
      model: group(rows, row => row.model),
      rubric_version: group(rows, row => row.rubric),
    },
    dimension_discrimination: dimensionDiscrimination(rows),
  };
}

if (process.argv[1]?.includes('calibrate-scorecards')) {
  const root = process.argv[2];
  if (!root) {
    console.error('Usage: calibrate-scorecards <historical-results-directory>');
    process.exitCode = 2;
  } else {
    try {
      const stats = fs.statSync(root);
      if (!stats.isDirectory()) {
        console.error(`Error: Not a directory: ${root}`);
        process.exitCode = 2;
      } else {
        console.log(JSON.stringify(calibrate(root), null, 2));
      }
    } catch {
      console.error(`Error: Directory not found or inaccessible: ${root}`);
      process.exitCode = 2;
    }
  }
}
