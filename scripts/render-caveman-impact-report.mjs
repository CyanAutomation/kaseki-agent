#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function readLedger(runDirectory) {
  const ledgerPath = path.join(runDirectory, 'token-ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Invalid token ledger JSON at ${ledgerPath}:${index + 1}`);
      }
    });
}

function runExitCode(runDirectory, override) {
  if (override !== undefined && override !== '') {
    const parsed = Number(override);
    return Number.isFinite(parsed) ? parsed : override;
  }
  const metadata = readJson(path.join(runDirectory, 'metadata.json'));
  const value = metadata.exit_codes?.overall ?? metadata.exit_code ?? metadata.exitCode;
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

const [verboseDirectory, terseDirectory, task = '', repository = '', ref = '', measuredAt, verboseExitCode, terseExitCode] = process.argv.slice(2);
if (!verboseDirectory || !terseDirectory) {
  console.error('Usage: render-caveman-impact-report.mjs <verbose-results-dir> <terse-results-dir> [task] [repository] [ref] [measured-at]');
  process.exit(2);
}

try {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const reportModuleUrl = pathToFileURL(path.join(appRoot, 'dist/caveman/impact-report.js')).href;
  const { buildCavemanImpactReport } = await import(reportModuleUrl);
  const report = buildCavemanImpactReport({
    task,
    repository,
    ref,
    measuredAt,
    verbose: { ledger: readLedger(verboseDirectory), exitCode: runExitCode(verboseDirectory, verboseExitCode) },
    terse: { ledger: readLedger(terseDirectory), exitCode: runExitCode(terseDirectory, terseExitCode) },
  });
  process.stdout.write(report);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
