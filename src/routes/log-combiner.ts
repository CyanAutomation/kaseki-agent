import * as fs from 'fs';
import * as path from 'path';
import type { Request } from 'express';
import type { LogResponse, AnalysisResponse, DiagnosticEntryPoint } from '../kaseki-api-types';
import { readLogContent, logFileForType } from './log-reader';

const COMBINED_LOG_TYPES = ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan'] as const;
const DIAGNOSTIC_FILE_CANDIDATES: DiagnosticEntryPoint[] = [
  'goal-setting-validation-errors.jsonl', 'goal-setting-stderr.log',
  'scouting-validation-errors.jsonl', 'scouting-contract-diagnostics.jsonl',
  'scouting-retry-diagnostics.jsonl', 'scouting-stderr.log',
  'goal-check-validation-errors.jsonl', 'goal-check-stderr.log', 'failure.json',
  'analysis.md', 'result-summary.md', 'stderr.log', 'stdout.log',
];
const DIAGNOSTIC_INLINE_LIMIT_BYTES = 65536;

export function readCombinedLogs(runDir: string, req: Request): LogResponse | undefined {
  const parts: string[] = [];
  const sources: NonNullable<LogResponse['sources']> = [];
  for (const logType of COMBINED_LOG_TYPES) {
    const logFile = logFileForType(runDir, logType);
    if (!fs.existsSync(logFile)) continue;
    const { content, size } = readLogContent(logFile, req);
    sources.push({ logType, file: path.basename(logFile), size });
    parts.push(`===== ${logType} (${path.basename(logFile)}) =====\n${content}`);
  }
  if (!parts.length) return undefined;
  const content = parts.join('\n\n');
  return { logType: 'combined', content, size: Buffer.byteLength(content, 'utf-8'), sources };
}

function readJsonlRecords(filePath: string): Array<Record<string, unknown>> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.statSync(filePath);
  if (stat.size <= 0 || stat.size > DIAGNOSTIC_INLINE_LIMIT_BYTES) return undefined;
  try {
    const records = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown);
    return records.every((record) => record && typeof record === 'object' && !Array.isArray(record))
      ? records as Array<Record<string, unknown>> : undefined;
  } catch { return undefined; }
}

export function collectDiagnostics(runDir: string): AnalysisResponse['diagnostics'] | undefined {
  const files = DIAGNOSTIC_FILE_CANDIDATES.filter((fileName) => {
    const filePath = path.join(runDir, fileName);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  });
  if (!files.length) return undefined;
  const details = files
    .filter((fileName) => fileName.endsWith('-validation-errors.jsonl'))
    .flatMap((fileName) => readJsonlRecords(path.join(runDir, fileName)) ?? []);
  return { entryPoint: files[0], files, ...(details.length ? { details } : {}) };
}
