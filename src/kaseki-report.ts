#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { basename } from 'node:path';
import { normalizeExitCodeCandidate } from './instance-state-derivation';

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

function readText(resultDir: string, name: string): string {
  try {
    return fs.readFileSync(path.join(resultDir, name), 'utf8');
  } catch {
    return '';
  }
}

function readJson(resultDir: string, name: string): Record<string, any> {
  const text = readText(resultDir, name);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function firstReadableNonEmpty(resultDir: string, names: string[]): FileContent | null {
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

function appendList(lines: string[], title: string, values: string[]): void {
  lines.push(`${title}:`);
  if (values.length === 0) {
    lines.push('  none');
    return;
  }
  for (const value of values) lines.push(`  ${value}`);
}

// Parse restoration.jsonl for metrics
interface RestorationEvent {
  status: 'restored' | 'kept';
  file: string;
  [key: string]: any;
}

function parseRestorationMetrics(resultDir: string): { restored: number; kept: number } {
  const restorationJsonl = readText(resultDir, 'restoration.jsonl');
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

export function generateKasekiReport(resultDir: string): string {
  const metadata: Metadata = readJson(resultDir, 'metadata.json');
  const summary: PiSummary = readJson(resultDir, 'pi-summary.json');
  const changedFiles = readText(resultDir, 'changed-files.txt')
    .split(/\r?\n/)
    .filter(Boolean);
  const timings = readText(resultDir, 'validation-timings.tsv')
    .split(/\r?\n/)
    .filter(Boolean);
  const stageTimings = readText(resultDir, 'stage-timings.tsv')
    .split(/\r?\n/)
    .filter(Boolean);
  const dependencyCache = readText(resultDir, 'dependency-cache.log')
    .split(/\r?\n/)
    .filter(Boolean);
  const secretScanBytes = Buffer.byteLength(readText(resultDir, 'secret-scan.log'));
  const { restored: restoredCount, kept: keptCount } = parseRestorationMetrics(resultDir);
  const normalizedExitCode = normalizeExitCode(metadata.exit_code);
  const status = normalizedExitCode === 0 ? 'passed' : 'failed';
  const resultName = metadata.instance || path.basename(resultDir);
  const nextDiagnostic =
    normalizedExitCode === 0
      ? 'none'
      : firstReadableNonEmpty(resultDir, [
        'failure.json',
        'quality.log',
        'secret-scan.log',
        'pi-stderr.log',
        'validation.log',
        'preflight-git.log',
        'stderr.log',
      ])?.name ?? 'metadata.json';
  const lines = [
    `Kaseki result: ${resultName}`,
    `Status: ${status}`,
    `Failed command: ${metadata.failed_command || 'none'}`,
    `Exit code: ${printableExitCode(metadata.exit_code)}`,
    `Pi exit code: ${printableExitCode(metadata.pi_exit_code)}`,
    `Validation exit code: ${printableExitCode(metadata.validation_exit_code)}`,
    `Validation failed command: ${metadata.validation_failed_command || 'none'}`,
  ];

  if (metadata.validation_stopped_early) {
    lines.push(
      `⚠️  Validation stopped early (fail-fast mode): ${metadata.validation_commands_attempted ?? 'unknown'} command(s) attempted`
    );
  }

  lines.push(
    `Quality exit code: ${printableExitCode(metadata.quality_exit_code)}`,
    `Secret scan exit code: ${printableExitCode(metadata.secret_scan_exit_code)}`,
    `Requested model: ${metadata.model || 'unknown'}`,
    `Actual model: ${metadata.actual_model || summary.selected_model || 'unknown'}`,
    `Pi version: ${metadata.pi_version || 'unknown'}`,
    `Duration seconds: ${metadata.duration_seconds ?? 'unknown'}`,
    `Agent duration seconds: ${metadata.pi_duration_seconds ?? 'unknown'}`,
    `Diff non-empty: ${metadata.diff_nonempty ?? 'unknown'}`
  );

  appendList(lines, 'Changed files', changedFiles);
  if (restoredCount > 0 || keptCount > 0) {
    const totalFiles = restoredCount + keptCount;
    const coverage = totalFiles > 0 ? Math.round((keptCount * 100) / totalFiles) : 0;
    lines.push(
      `Allowlist coverage: ${keptCount}/${totalFiles} files (${coverage}%)`,
      `Files restored: ${restoredCount}`,
      `Files kept (allowlist match): ${keptCount}`
    );
  }

  appendList(lines, 'Stage timings', stageTimings);
  appendList(lines, 'Validation timings', timings);
  appendList(lines, 'Dependency cache', dependencyCache);
  lines.push(`Secret scan bytes: ${secretScanBytes}`);
  lines.push(`Next diagnostic: ${nextDiagnostic}`);

  return `${lines.join('\n')}\n`;
}

function main(): void {
  const resultDir = process.argv[2] ?? '/results';

  if (!fs.existsSync(resultDir)) {
    console.error(`Result directory not found: ${resultDir}`);
    process.exit(2);
  }

  process.stdout.write(generateKasekiReport(resultDir));
}

const entrypoint = process.argv[1] ? basename(process.argv[1]) : '';

if (entrypoint === 'kaseki-report.js' || entrypoint === 'kaseki-report.ts') {
  main();
}
