import * as fs from 'fs';
import * as path from 'path';
import type { Request } from 'express';
import { decodeUtf8TailSafely, tailLogByLines, readTailBytes } from '../utils/utf8-helpers';
import { redactLogContent } from './log-redaction';

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
