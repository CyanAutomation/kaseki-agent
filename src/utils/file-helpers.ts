import * as fs from 'fs';
import { commandOutput as executeCommand } from '../lib/subprocess-helpers';
import * as path from 'path';

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

/**
 * Write content to file atomically using temp file + rename pattern.
 * This avoids TOCTOU race conditions by writing to a temporary file first,
 * then renaming it to the final destination atomically.
 */
export function writeAtomic(filePath: string, content: string, options: { mode?: number; encoding?: BufferEncoding } = {}): void {
  const tempPath = `${filePath}.tmp`;
  
  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    
    // Write to temp file
    fs.writeFileSync(tempPath, content, {
      mode: options.mode,
      encoding: options.encoding || 'utf-8',
    });
    
    // Atomically rename temp file to final destination
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Write content to file only if it doesn't exist (atomic version).
 * Uses exclusive creation to avoid race conditions.
 * Returns true if written, false if already exists.
 */
export function writeIfMissingAtomic(filePath: string, content: string, options: { mode?: number; encoding?: BufferEncoding } = {}): boolean {
  try {
    // Try to create the file exclusively (fails if already exists)
    fs.writeFileSync(filePath, content, {
      mode: options.mode,
      encoding: options.encoding || 'utf-8',
      flag: 'wx', // Exclusive creation - fails if file exists
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return false; // File already exists
    }
    throw err;
  }
}

/**
 * Write content to file only if it's empty (atomic best-effort).
 *
 * Guarantees it will never overwrite an existing non-empty file. For an
 * existing empty file, it uses a lock file created with `wx` to serialize
 * writers, then re-checks emptiness before replacing content atomically.
 * Returns true if written, false if file exists and is non-empty or another
 * writer won the lock.
 */
export function writeIfEmptyAtomic(filePath: string, content: string, options: { mode?: number; encoding?: BufferEncoding } = {}): boolean {
  const encoding = options.encoding || 'utf-8';

  // Fast path: file does not exist yet.
  try {
    fs.writeFileSync(filePath, content, {
      mode: options.mode,
      encoding,
      flag: 'wx',
    });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }

  // File exists. If it is non-empty, do not modify.
  const stats = fs.statSync(filePath);
  if (stats.size > 0) {
    return false;
  }

  // Serialize empty-file replacement attempts using a lock file.
  const lockPath = `${filePath}.empty.lock`;
  try {
    fs.writeFileSync(lockPath, '', { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw err;
  }

  try {
    // Re-check under lock to ensure we never overwrite non-empty content.
    const underLockStats = fs.statSync(filePath);
    if (underLockStats.size > 0) {
      return false;
    }

    writeAtomic(filePath, content, options);
    return true;
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore lock cleanup errors.
    }
  }
}

/**
 * Log write failures with context information.
 */
export function logWriteError(operation: string, filePath: string, error: unknown, jobId?: string): void {
  const jobContext = jobId ? ` (job: ${jobId})` : '';
  const errorInfo = error instanceof Error ? error.message : String(error);
  console.error(`[FailureArtifactWriter] Failed to ${operation} ${filePath}${jobContext}: ${errorInfo}`);
}
