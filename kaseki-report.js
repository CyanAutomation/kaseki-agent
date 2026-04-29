#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const resultDir = process.argv[2] ?? '/results';

function readText(name) {
  try {
    return fs.readFileSync(path.join(resultDir, name), 'utf8');
  } catch {
    return '';
  }
}

function readJson(name) {
  const text = readText(name);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function firstExisting(names) {
  return names.find((name) => {
    try {
      return fs.statSync(path.join(resultDir, name)).size > 0;
    } catch {
      return false;
    }
  });
}

function normalizeExitCode(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  return null;
}

function printableExitCode(value) {
  const normalized = normalizeExitCode(value);
  return normalized === null ? 'unknown' : normalized;
}

function printList(title, values) {
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

const metadata = readJson('metadata.json');
const summary = readJson('pi-summary.json');
const changedFiles = readText('changed-files.txt').split(/\r?\n/).filter(Boolean);
const timings = readText('validation-timings.tsv').split(/\r?\n/).filter(Boolean);
const stageTimings = readText('stage-timings.tsv').split(/\r?\n/).filter(Boolean);
const dependencyCache = readText('dependency-cache.log').split(/\r?\n/).filter(Boolean);
const secretScanBytes = Buffer.byteLength(readText('secret-scan.log'));
const normalizedExitCode = normalizeExitCode(metadata.exit_code);
const status = normalizedExitCode === 0 ? 'passed' : normalizedExitCode === null ? 'unknown' : 'failed';
const resultName = metadata.instance || path.basename(resultDir);
const nextDiagnostic =
  normalizedExitCode === 0
    ? 'none'
    : firstExisting([
      'failure.json',
      'quality.log',
      'secret-scan.log',
      'pi-stderr.log',
      'validation.log',
      'preflight-git.log',
      'stderr.log',
    ]) ??
      'metadata.json';

console.log(`Kaseki result: ${resultName}`);
console.log(`Status: ${status}`);
console.log(`Failed command: ${metadata.failed_command || 'none'}`);
console.log(`Exit code: ${printableExitCode(metadata.exit_code)}`);
console.log(`Pi exit code: ${printableExitCode(metadata.pi_exit_code)}`);
console.log(`Validation exit code: ${printableExitCode(metadata.validation_exit_code)}`);
console.log(`Quality exit code: ${printableExitCode(metadata.quality_exit_code)}`);
console.log(`Secret scan exit code: ${printableExitCode(metadata.secret_scan_exit_code)}`);
console.log(`Requested model: ${metadata.model || 'unknown'}`);
console.log(`Actual model: ${metadata.actual_model || summary.selected_model || 'unknown'}`);
console.log(`Pi version: ${metadata.pi_version || 'unknown'}`);
console.log(`Duration seconds: ${metadata.duration_seconds ?? 'unknown'}`);
console.log(`Agent duration seconds: ${metadata.pi_duration_seconds ?? 'unknown'}`);
console.log(`Diff non-empty: ${metadata.diff_nonempty ?? 'unknown'}`);
printList('Changed files', changedFiles);
printList('Stage timings', stageTimings);
printList('Validation timings', timings);
printList('Dependency cache', dependencyCache);
console.log(`Secret scan bytes: ${secretScanBytes}`);
console.log(`Next diagnostic: ${nextDiagnostic}`);
