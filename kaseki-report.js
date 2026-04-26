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
const secretScanBytes = Buffer.byteLength(readText('secret-scan.log'));
const status = metadata.exit_code === 0 ? 'passed' : 'failed';
const resultName = metadata.instance || path.basename(resultDir);
const nextDiagnostic =
  metadata.exit_code === 0
    ? 'none'
    : firstExisting(['quality.log', 'secret-scan.log', 'pi-stderr.log', 'validation.log', 'stderr.log']) ??
      'metadata.json';

console.log(`Kaseki result: ${resultName}`);
console.log(`Status: ${status}`);
console.log(`Failed command: ${metadata.failed_command || 'none'}`);
console.log(`Exit code: ${metadata.exit_code ?? 'unknown'}`);
console.log(`Pi exit code: ${metadata.pi_exit_code ?? 'unknown'}`);
console.log(`Validation exit code: ${metadata.validation_exit_code ?? 'unknown'}`);
console.log(`Quality exit code: ${metadata.quality_exit_code ?? 'unknown'}`);
console.log(`Secret scan exit code: ${metadata.secret_scan_exit_code ?? 'unknown'}`);
console.log(`Requested model: ${metadata.model || 'unknown'}`);
console.log(`Actual model: ${metadata.actual_model || summary.selected_model || 'unknown'}`);
console.log(`Pi version: ${metadata.pi_version || 'unknown'}`);
console.log(`Duration seconds: ${metadata.duration_seconds ?? 'unknown'}`);
console.log(`Diff non-empty: ${metadata.diff_nonempty ?? 'unknown'}`);
printList('Changed files', changedFiles);
printList('Validation timings', timings);
console.log(`Secret scan bytes: ${secretScanBytes}`);
console.log(`Next diagnostic: ${nextDiagnostic}`);
