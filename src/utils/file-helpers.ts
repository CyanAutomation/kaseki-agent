import * as fs from 'fs';
import { commandOutput as executeCommand } from '../lib/subprocess-helpers';
import * as path from 'path';

type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';
type AtomicWriteOperation = 'writeAtomic' | 'writeIfEmptyAtomic';

type AtomicLogContext = {
  operation: AtomicWriteOperation;
  jobId?: string;
};

function toErrnoDetails(error: unknown): { errorCode?: string; errorMessage: string } {
  if (error instanceof Error) {
    const errno = error as NodeJS.ErrnoException;
    return {
      errorCode: errno.code,
      errorMessage: error.message,
    };
  }
  return { errorMessage: String(error) };
}

function logAtomicStage(event: string, details: Record<string, unknown>): void {
  console.debug(`[file-helpers] ${event}`, details);
}

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
export function writeAtomic(
  filePath: string,
  content: string,
  options: { mode?: number; encoding?: BufferEncoding } = {},
  context: AtomicLogContext = { operation: 'writeAtomic' }
): void {
  const tempPath = `${filePath}.tmp`;
  const baseContext = { operation: context.operation, filePath, tempPath, jobId: context.jobId };
  logAtomicStage('atomic_write_start', baseContext);

  try {
    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    logAtomicStage('ensure_parent_dir', baseContext);
    fs.mkdirSync(dir, { recursive: true });

    // Write to temp file
    logAtomicStage('temp_write_start', baseContext);
    fs.writeFileSync(tempPath, content, {
      mode: options.mode,
      encoding: options.encoding || 'utf-8',
    });
    logAtomicStage('temp_write_success', baseContext);

    // Atomically rename temp file to final destination
    logAtomicStage('rename_start', baseContext);
    fs.renameSync(tempPath, filePath);
    logAtomicStage('rename_success', baseContext);
  } catch (error) {
    // Clean up temp file on error
    const errDetails = toErrnoDetails(error);
    logAtomicStage('cleanup_temp_start', { ...baseContext, ...errDetails });
    try {
      fs.unlinkSync(tempPath);
      logAtomicStage('cleanup_temp_success', { ...baseContext, ...errDetails });
    } catch {
      logAtomicStage('cleanup_temp_failed', { ...baseContext, ...errDetails });
    }
    logAtomicStage('atomic_write_failed', { ...baseContext, ...errDetails });
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
export function writeIfEmptyAtomic(
  filePath: string,
  content: string,
  options: { mode?: number; encoding?: BufferEncoding } = {},
  context: Pick<AtomicLogContext, 'jobId'> = {}
): boolean {
  const encoding = options.encoding || 'utf-8';
  const operationContext: AtomicLogContext = { operation: 'writeIfEmptyAtomic', jobId: context.jobId };
  const baseContext = { operation: operationContext.operation, filePath, tempPath: `${filePath}.tmp`, jobId: operationContext.jobId };
  logAtomicStage('atomic_write_start', baseContext);

  // Fast path: file does not exist yet.
  try {
    logAtomicStage('ensure_parent_dir', baseContext);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    logAtomicStage('temp_write_start', baseContext);
    fs.writeFileSync(filePath, content, {
      mode: options.mode,
      encoding,
      flag: 'wx',
    });
    logAtomicStage('temp_write_success', baseContext);
    logAtomicStage('rename_start', baseContext);
    logAtomicStage('rename_success', baseContext);
    return true;
  } catch (err) {
    const errDetails = toErrnoDetails(err);
    logAtomicStage('atomic_write_failed', { ...baseContext, ...errDetails });
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

    writeAtomic(filePath, content, options, operationContext);
    return true;
  } finally {
    logAtomicStage('cleanup_temp_start', { ...baseContext, tempPath: lockPath });
    try {
      fs.unlinkSync(lockPath);
      logAtomicStage('cleanup_temp_success', { ...baseContext, tempPath: lockPath });
    } catch {
      logAtomicStage('cleanup_temp_failed', { ...baseContext, tempPath: lockPath });
    }
  }
}

/**
 * Log write failures with context information.
 */
export function logWriteError(operation: string, filePath: string, error: unknown, jobId?: string): void {
  const jobContext = jobId ? ` (job: ${jobId})` : '';
  const errno = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  const errorInfo = error instanceof Error ? error.message : String(error);
  const errnoInfo = errno ? ` [${errno}]` : '';
  console.error(`[FailureArtifactWriter] Failed to ${operation} ${filePath}${jobContext}: ${errorInfo}`);
  console.debug('[FailureArtifactWriter] write_error_context', {
    operation,
    filePath,
    jobId,
    errorCode: errno,
    errorMessage: errorInfo,
    details: `${operation}${errnoInfo}`,
  });
}
