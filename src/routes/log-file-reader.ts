import * as fs from 'fs';
import * as path from 'path';
import type { Request } from 'express';
import type { DiagnosticEntryPoint, LogResponse, AnalysisResponse } from '../kaseki-api-types';
import { decodeUtf8TailSafely, tailLogByLines, readTailBytes } from '../utils/utf8-helpers';

export const VALID_LOG_TYPES = [
  'stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan', 'combined',
  'goal-setting-stderr', 'scouting-stderr', 'goal-check-stderr', 'run-evaluation-stderr',
] as const;
const COMBINED_LOG_TYPES = ['stdout', 'stderr', 'validation', 'progress', 'quality', 'secret-scan'] as const;
const DIAGNOSTIC_FILE_CANDIDATES: DiagnosticEntryPoint[] = [
  'goal-setting-validation-errors.jsonl', 'goal-setting-stderr.log',
  'scouting-validation-errors.jsonl', 'scouting-contract-diagnostics.jsonl',
  'scouting-retry-diagnostics.jsonl', 'scouting-stderr.log',
  'goal-check-validation-errors.jsonl', 'goal-check-stderr.log', 'failure.json',
  'analysis.md', 'result-summary.md', 'stderr.log', 'stdout.log',
];
const DIAGNOSTIC_INLINE_LIMIT_BYTES = 65536;

/**
 * Logs are operator-facing API responses, not a secret store. Keep enough
 * context to diagnose a failure while removing credential-bearing paths and
 * values that occasionally appear in Docker/provider diagnostics.
 */
export function redactLogContent(content: string): string {
  return content
    .replace(/\/run\/secrets\/[^\s'"`]+/g, '[redacted secret path]')
    .replace(/\b(sha256_fingerprint\s*[=:]\s*)[a-f0-9]{32,}\b/gi, '$1[redacted]')
    .replace(/-----BEGIN [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g, '[redacted private key]');
}

export function logFileForType(runDir: string, logType: string): string {
  return logType.endsWith('-stderr')
    ? path.join(runDir, `${logType}.log`)
    : path.join(runDir, logType === 'stdout' ? 'stdout.log' : `${logType}.log`);
}

export function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function readLogContent(logFile: string, req: Request): { content: string; size: number } {
  const size = fs.statSync(logFile).size;
  const maxSize = 1024 * 100;
  if (size <= maxSize) return { content: redactLogContent(fs.readFileSync(logFile, 'utf-8')), size };
  const truncated = readTailBytes(logFile, size, maxSize);
  let content = decodeUtf8TailSafely(truncated);
  if (req.query.tail === 'lines') {
    const lineCount = Number(req.query.lines ?? 200);
    content = tailLogByLines(content, Number.isFinite(lineCount) ? Math.max(1, Math.floor(lineCount)) : 200);
  }
  return { content: redactLogContent(`[... truncated, showing last ${maxSize} bytes ...]\n${content}`), size };
}

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
