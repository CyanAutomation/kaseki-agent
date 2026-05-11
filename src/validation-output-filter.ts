#!/usr/bin/env node
/**
 * Validation Output Filter
 *
 * Filters validation command output in real-time to reduce noise in Docker logs
 * while preserving full output in stored log files.
 *
 * Filters OUT verbose lines while preserving:
 * - Error and warning lines (never filtered)
 * - Test result indicators (✓, ✗, PASS, FAIL, passed, failed, etc.)
 * - Command boundaries (first and last lines)
 *
 * Usage:
 *   some_command 2>&1 | validation-output-filter | tee -a logfile.log
 *
 * Exit code: Always 0 (this filter does not affect command success/failure)
 */

import { createInterface } from 'readline';
import { basename } from 'path';

interface FilterState {
  inCommand: boolean;
  commandNumber: number;
  firstLineOfCommand: string | null;
  linesSinceCommandStart: number;
}

function createInitialState(): FilterState {
  return {
    inCommand: false,
    commandNumber: 0,
    firstLineOfCommand: null,
    linesSinceCommandStart: 0,
  };
}

/**
 * Patterns that always pass through (never filtered)
 */
const ALWAYS_SHOW_PATTERNS = [
  /ERROR/i,
  /WARN/i,  // Shows real warnings (compiler, linter, etc)
  /FATAL/i,
  /CRITICAL/i,
  /Exception/,
  /at\s+\(/,  // Stack traces
  /^\s+at\s+/,
  /failed/i,
  /failure/i,
];

/**
 * Patterns that should be filtered out (verbose/noisy output)
 */
const FILTER_OUT_PATTERNS = [
  /^npm\s+(notice|warn)/i,  // npm notice and warn messages (framework metadata)
  /^npm\s+ERR!/i,  // npm error prefixed lines (actual errors shown differently)
  /welcome to npm/i,
  /^\s*\[[\s█▓▒░]*\].*%?\s*(complete|done)/i,  // Progress bars
  /\d+%\s+complete/i,  // Percentage progress indicators
];

/**
 * Patterns that indicate test results or completion
 */
const KEY_MILESTONE_PATTERNS = [
  /\bPASS/i,
  /\bFAIL/i,
  /\bOK\b/i,
  /\bDONE\b/i,
  /✓/,
  /✗/,
  /passed/i,
  /failed/i,
  /completed/i,
  /finished/i,
  /complete/i,  // "Bundle complete", "Build complete", etc.
  /\d+\s+tests?.*passed/i,
  /\d+\s+tests?.*failed/i,
  /\d+\s+error/i,
  /\d+\s+warning/i,
  /all\s+tests?\s+passed/i,
  /test\s+suite.*passed/i,
  /test\s+suite.*failed/i,
  /\bsuccess\b/i,
  /build.*success/i,
  /build.*success/i,
  /\d+.*tests?\s+(passed|failed)/i,
];

/**
 * Patterns that indicate command boundaries (start/end)
 */
const COMMAND_BOUNDARY_PATTERNS = [
  /^==> /,  // Command start
  /^exit_code=/,  // Command end
];

/**
 * Check if a line should always be shown (error/warning)
 */
function shouldAlwaysShow(line: string): boolean {
  return ALWAYS_SHOW_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Check if a line should be filtered out (verbose/noisy)
 */
function shouldFilterOut(line: string): boolean {
  return FILTER_OUT_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Check if a line is a key milestone (test result indicator)
 */
function isKeyMilestone(line: string): boolean {
  return KEY_MILESTONE_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Check if a line is a command boundary
 */
function isCommandBoundary(line: string): boolean {
  return COMMAND_BOUNDARY_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Determine if a line should be shown in real-time output
 */
function shouldShow(line: string): boolean {
  // Filter out explicitly noisy patterns first
  if (shouldFilterOut(line)) {
    return false;
  }

  // Always show errors and warnings
  if (shouldAlwaysShow(line)) {
    return true;
  }

  // Always show command boundaries
  if (isCommandBoundary(line)) {
    return true;
  }

  // Always show key milestones (test results)
  if (isKeyMilestone(line)) {
    return true;
  }

  // Filter everything else
  return false;
}

/**
 * Process a line of input
 */
function processLine(line: string, state: FilterState): string | null {
  // Detect command start
  if (line.match(/^==> /)) {
    state.inCommand = true;
    state.commandNumber++;
    state.firstLineOfCommand = line;
    state.linesSinceCommandStart = 0;
    return line; // Always show command start
  }

  // Detect command end
  if (line.match(/^exit_code=/)) {
    state.inCommand = false;
    state.firstLineOfCommand = null;
    state.linesSinceCommandStart = 0;
    return line; // Always show exit code
  }

  // If not in a command, show the line anyway (e.g., preamble, separators)
  if (!state.inCommand) {
    return line;
  }

  // In a command: decide whether to show this line based on filter criteria
  state.linesSinceCommandStart++;

  // Show only lines that match filter criteria (errors, milestones, boundaries)
  if (shouldShow(line)) {
    return line;
  }

  return null;
}

/**
 * Filter validation output and return the visible lines.
 */
export function filterValidationOutput(input: string): string {
  const state = createInitialState();
  const outputLines: string[] = [];
  const inputLines = input.split(/\r?\n/);

  if (inputLines[inputLines.length - 1] === '') {
    inputLines.pop();
  }

  for (const line of inputLines) {
    const outputLine = processLine(line, state);

    if (outputLine !== null) {
      outputLines.push(outputLine);
    }
  }

  return outputLines.length > 0 ? `${outputLines.join('\n')}\n` : '';
}

/**
 * Main: read from stdin and process
 */
function main(): void {
  // Set exit code to 0 IMMEDIATELY as default.
  // This ensures we always exit with 0, even if something crashes before 'close' fires.
  // This is critical for avoiding SIGPIPE failures in pipelines.
  process.exitCode = 0;

  const state = createInitialState();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Handle readline errors (e.g., stdin closed prematurely, encoding issues)
  rl.on('error', (err) => {
    // Log to stderr but don't crash - allow graceful shutdown
    console.error(`[validation-output-filter] readline error: ${err.message}`);
    // Ensure exit code stays at 0
    process.exitCode = 0;
  });

  // Handle stdin close event
  rl.on('close', () => {
    // Confirm exit with 0 (filter is diagnostic tool, not part of command logic).
    // Internal errors are logged to stderr but don't block the pipeline.
    process.exitCode = 0;
  });

  rl.on('line', (line: string) => {
    try {
      const outputLine = processLine(line, state);

      if (outputLine !== null) {
        // Catch any write errors to stdout (e.g., broken pipe from downstream process)
        try {
          console.log(outputLine);
        } catch {
          // If console.log fails, continue gracefully (stream may have closed downstream)
          // Note: In pipe context, EPIPE errors might not throw
        }
      }
    } catch (lineErr) {
      console.error(
        `[validation-output-filter] Error processing line: ${lineErr instanceof Error ? lineErr.message : String(lineErr)}`
      );
    }
  });

  // Handle stdout/stderr errors (e.g., broken pipe from downstream process)
  const stdout = process.stdout;
  const stderr = process.stderr;

  if (stdout && typeof stdout.on === 'function') {
    stdout.on('error', (err) => {
      // EPIPE is expected when downstream closes; don't treat as error
      if (err.code !== 'EPIPE') {
        // Log error but continue; we always exit 0 anyway
        console.error(`[validation-output-filter] stdout error: ${err.message}`);
      }
    });
  }

  if (stderr && typeof stderr.on === 'function') {
    stderr.on('error', (err) => {
      // Ignore stderr errors; we're already reporting issues
      if (err.code !== 'EPIPE') {
        // Silent handling
      }
    });
  }

  // Handle process-level errors (uncaught exceptions, unhandled rejections)
  process.on('error', (err) => {
    console.error(`[validation-output-filter] process error: ${err.message}`);
    // Ensure we exit with 0 (filter is diagnostic, errors don't block pipeline)
    process.exitCode = 0;
  });

  process.on('uncaughtException', (err) => {
    console.error(
      `[validation-output-filter] uncaught exception: ${err instanceof Error ? err.message : String(err)}`
    );
    // Ensure we exit with 0
    process.exitCode = 0;
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    console.error(
      `[validation-output-filter] unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`
    );
    // Ensure we exit with 0
    process.exitCode = 0;
  });

  // Fallback timeout: ensure we exit with 0 after 30 seconds even if something hangs
  // This prevents the filter from hanging indefinitely in edge cases
  const fallbackTimeout = setTimeout(() => {
    console.error('[validation-output-filter] WARNING: Fallback timeout triggered (30s), forcing exit with code 0');
    process.exitCode = 0;
    process.exit(0);
  }, 30000);

  // Clear fallback timeout once readline closes (normal path)
  const originalClose = rl.close.bind(rl);
  rl.close = function() {
    clearTimeout(fallbackTimeout);
    return originalClose();
  };
}

const entrypoint = process.argv[1] ? basename(process.argv[1]) : '';

if (entrypoint === 'validation-output-filter.js' || entrypoint === 'validation-output-filter.ts') {
  main();
}
