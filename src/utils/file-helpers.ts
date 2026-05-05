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
