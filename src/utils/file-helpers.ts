import * as fs from 'fs';
import { commandOutput as executeCommand } from '../lib/subprocess-helpers';

/**
 * Check if a file exists and is non-empty.
 * Used for artifact availability checks.
 */
export function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Read the first line of a file.
 * Used for metadata extraction.
 */
export function readFirstLine(filePath: string): string | undefined {
  try {
    const value = fs.readFileSync(filePath, 'utf-8').trim().split(/\r?\n/)[0];
    return value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the tail of a file (last N lines).
 * Used for log truncation.
 */
export function readTailLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(-maxLines).join('\n');
}

/**
 * Read the final complete non-empty JSONL event from a file tail.
 * Reads at most maxBytes from the end of the file so large progress logs do not
 * need to be loaded fully for status responses.
 */
export function readLastJsonlEvent(filePath: string, maxBytes = 65536): Record<string, unknown> | undefined {
  if (maxBytes <= 0) {
    return undefined;
  }

  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    if (!stats.isFile() || stats.size === 0) {
      return undefined;
    }

    const bytesToRead = Math.min(stats.size, maxBytes);
    const start = stats.size - bytesToRead;
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, start);
    if (bytesRead <= 0) {
      return undefined;
    }

    let tail = buffer.subarray(0, bytesRead).toString('utf-8');

    const endsWithLineBreak = /[\r\n]$/.test(tail);
    if (!endsWithLineBreak) {
      const lastLineBreak = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r'));
      const shouldTreatOnlyLineAsComplete = start === 0 && lastLineBreak === -1;
      if (!shouldTreatOnlyLineAsComplete) {
        if (lastLineBreak === -1) {
          return undefined;
        }
        tail = tail.slice(0, lastLineBreak + 1);
      }
    }

    const lines = tail.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }

      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    }
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors; callers treat the event as best-effort metadata.
      }
    }
  }

  return undefined;
}

/**
 * Execute a shell command and return its output.
 * Delegates to subprocess-helpers for consolidated subprocess handling.
 * Used for system diagnostics (e.g., git commands, docker info).
 */
export function commandOutput(command: string, args: string[], cwd?: string): string | undefined {
  return executeCommand(command, args, cwd);
}

/**
 * Check if a file path exists.
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Read a file's content as text, or return null if unavailable.
 */
export function readFileContent(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get file stats (size, modified time, etc.).
 */
export function getFileStats(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}
