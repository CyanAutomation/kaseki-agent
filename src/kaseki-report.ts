#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { normalizeExitCodeCandidate } from './instance-state-derivation';

const resultDir = process.argv[2] ?? '/results';

interface Metadata {
  instance?: string;
  exit_code?: number | string;
  failed_command?: string;
  pi_exit_code?: number | string;
  validation_exit_code?: number | string;
  validation_failed_command?: string;
  validation_fail_fast_mode?: boolean;
  validation_stopped_early?: boolean;
  validation_commands_attempted?: number;
  quality_exit_code?: number | string;
  secret_scan_exit_code?: number | string;
  model?: string;
  actual_model?: string;
  pi_version?: string;
  duration_seconds?: number;
  pi_duration_seconds?: number;
  diff_nonempty?: boolean;
  [key: string]: any;
}

interface PiSummary {
  selected_model?: string;
  [key: string]: any;
}

interface FileContent {
  name: string;
  text: string;
}

function readText(name: string): string {
  try {
    return fs.readFileSync(path.join(resultDir, name), 'utf8');
  } catch {
    return '';
  }
}

function readJson(name: string): Record<string, any> {
  const text = readText(name);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function firstReadableNonEmpty(names: string[]): FileContent | null {
  for (const name of names) {
    try {
      const text = fs.readFileSync(path.join(resultDir, name), 'utf8');
      if (text.trim()) return { name, text };
    } catch {
      // ignore files that cannot be read at decision time
    }
  }
  return null;
}

function normalizeExitCode(value: any): number | null {
  return normalizeExitCodeCandidate(value);
}

function printableExitCode(value: any): string {
  const normalized = normalizeExitCode(value);
  return normalized === null ? 'unknown' : String(normalized);
}

function printList(title: string, values: string[]): void {
  console.log(`${title}:`);
  if (values.length === 0) {
    console.log('  none');
    return;
  }
  for (const value of values) console.log(`  ${value}`);
}

if (!fs.existsSync(resultDir)) {
  console.error(`Result directory not found: ${resultDir}`);
  process.exit(2);
}

const metadata: Metadata = readJson('metadata.json');
const summary: PiSummary = readJson('pi-summary.json');
const changedFiles = readText('changed-files.txt')
  .split(/\r?\n/)
  .filter(Boolean);
const timings = readText('validation-timings.tsv')
  .split(/\r?\n/)
  .filter(Boolean);
const stageTimings = readText('stage-timings.tsv')
  .split(/\r?\n/)
  .filter(Boolean);
const dependencyCache = readText('dependency-cache.log')
  .split(/\r?\n/)
  .filter(Boolean);
const secretScanBytes = Buffer.byteLength(readText('secret-scan.log'));

// Parse restoration.jsonl for metrics
interface RestorationEvent {
  status: 'restored' | 'kept';
  file: string;
  [key: string]: any;
}

function parseRestorationMetrics(): { restored: number; kept: number } {
  const restorationJsonl = readText('restoration.jsonl');
  if (!restorationJsonl.trim()) return { restored: 0, kept: 0 };

  let restored = 0, kept = 0;
  for (const line of restorationJsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as RestorationEvent;
      if (event.status === 'restored') restored++;
      else if (event.status === 'kept') kept++;
    } catch {
      // ignore malformed lines
    }
  }
  return { restored, kept };
}

const { restored: restoredCount, kept: keptCount } = parseRestorationMetrics();
const normalizedExitCode = normalizeExitCode(metadata.exit_code);
const status = normalizedExitCode === 0 ? 'passed' : 'failed';
const resultName = metadata.instance || path.basename(resultDir);
const nextDiagnostic =
  normalizedExitCode === 0
    ? 'none'
    : firstReadableNonEmpty([
      'failure.json',
      'quality.log',
      'secret-scan.log',
      'pi-stderr.log',
      'validation.log',
      'preflight-git.log',
      'stderr.log',
    ])?.name ?? 'metadata.json';

console.log(`Kaseki result: ${resultName}`);
console.log(`Status: ${status}`);
console.log(`Failed command: ${metadata.failed_command || 'none'}`);
console.log(`Exit code: ${printableExitCode(metadata.exit_code)}`);
console.log(`Pi exit code: ${printableExitCode(metadata.pi_exit_code)}`);
console.log(
  `Validation exit code: ${printableExitCode(metadata.validation_exit_code)}`
);
console.log(
  `Validation failed command: ${metadata.validation_failed_command || 'none'}`
);
if (metadata.validation_stopped_early) {
  console.log(
    `⚠️  Validation stopped early (fail-fast mode): ${metadata.validation_commands_attempted ?? 'unknown'} command(s) attempted`
  );
}
console.log(`Quality exit code: ${printableExitCode(metadata.quality_exit_code)}`);
console.log(
  `Secret scan exit code: ${printableExitCode(metadata.secret_scan_exit_code)}`
);
console.log(`Requested model: ${metadata.model || 'unknown'}`);
console.log(
  `Actual model: ${metadata.actual_model || summary.selected_model || 'unknown'}`
);
console.log(`Pi version: ${metadata.pi_version || 'unknown'}`);
console.log(`Duration seconds: ${metadata.duration_seconds ?? 'unknown'}`);
console.log(
  `Agent duration seconds: ${metadata.pi_duration_seconds ?? 'unknown'}`
);
console.log(`Diff non-empty: ${metadata.diff_nonempty ?? 'unknown'}`);
printList('Changed files', changedFiles);
if (restoredCount > 0 || keptCount > 0) {
  const totalFiles = restoredCount + keptCount;
  const coverage = totalFiles > 0 ? Math.round((keptCount * 100) / totalFiles) : 0;
  console.log(`Allowlist coverage: ${keptCount}/${totalFiles} files (${coverage}%)`);
  console.log(`Files restored: ${restoredCount}`);
  console.log(`Files kept (allowlist match): ${keptCount}`);
}
printList('Stage timings', stageTimings);
printList('Validation timings', timings);
printList('Dependency cache', dependencyCache);
console.log(`Secret scan bytes: ${secretScanBytes}`);
console.log(`Next diagnostic: ${nextDiagnostic}`);
