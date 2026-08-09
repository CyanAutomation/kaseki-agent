import fs from 'node:fs';
import path from 'node:path';
import type { ArtifactSnapshot } from './run-scorecard-evidence';

const JSON_ARTIFACTS = [
  'metadata.json', 'timings-manifest.json', 'all-phase-summaries.json', 'performance-metrics.json',
  'goal-setting.json', 'scouting.json', 'goal-check.json', 'run-evaluation.json', 'quality-gates.json',
  'validation-status.json', 'restoration.json', 'retry-diagnostics.json',
];
const TEXT_ARTIFACTS = [
  'stage-timings.tsv', 'validation-timings.tsv', 'pre-validation-timings.tsv', 'quality-gate-timings.tsv',
  'changed-files.txt', 'git.diff', 'provider-attempts.jsonl', 'restoration.jsonl', 'token-ledger.jsonl',
];

export function readArtifactSnapshot(dir: string): ArtifactSnapshot {
  const json: Record<string, unknown> = {};
  const text: Record<string, string> = {};
  for (const name of JSON_ARTIFACTS) {
    try { json[name] = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as unknown; } catch { /* optional */ }
  }
  for (const name of TEXT_ARTIFACTS) {
    try { text[name] = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* optional */ }
  }
  const ledger = (text['token-ledger.jsonl'] ?? '').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as unknown]; } catch { return []; }
  });
  const consolidated = json['all-phase-summaries.json'] as { phases?: unknown[] } | undefined;
  const summaries = ledger.length > 0 ? ledger : Array.isArray(consolidated?.phases) ? [...consolidated.phases] : [];
  if (!summaries.length) {
    for (const name of fs.readdirSync(dir).filter(file => file.endsWith('-summary.json'))) {
      try { summaries.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); } catch { /* optional */ }
    }
  }
  return { json, text, summaries };
}

export function writeAtomic(file: string, value: unknown): void {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* absent */ }
    throw error;
  }
}
