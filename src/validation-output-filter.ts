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
import type { Readable, Writable } from 'stream';
import { basename } from 'path';
import { appendFileSync } from 'fs';

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

export interface FilterStreamResult {
  linesProcessed: number;
  linesOutput: number;
}

/**
 * Filter validation output from a finite readable stream into a writable stream.
 * This is the source-module API used by tests and by wrappers that need the
 * same line-by-line behavior as the CLI without spawning the built dist file.
 */
export async function filterValidationOutputStream(input: Readable, output: Writable): Promise<FilterStreamResult> {
  const state = createInitialState();
  let linesProcessed = 0;
  let linesOutput = 0;

  const rl = createInterface({
    input,
    terminal: false,
  });

  try {
    for await (const line of rl) {
      linesProcessed++;
      const outputLine = processLine(String(line), state);

      if (outputLine !== null) {
        linesOutput++;
        await new Promise<void>((resolve, reject) => {
          output.write(`${outputLine}\n`, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }
    }
  } finally {
    rl.close();
  }

  return { linesProcessed, linesOutput };
}

/**
 * Main: read from stdin and process
 */
function main(): void {
  // Get diagnostics log file from environment
  const diagnosticsLogFile = process.env.FILTER_DIAGNOSTICS_LOG || '/dev/null';
  let linesProcessed = 0;
  let linesOutput = 0;
  let errorsEncountered: string[] = [];
  let backpressureEvents = 0;
  let memoryWarningsTriggered = 0;

  // RPi 4 memory management: 4GB total, warn at 2.5GB (62% of container allocation)
  // Assumes container gets ~3.5-4GB limit
  const MEMORY_WARN_BYTES = 2.5 * 1024 * 1024 * 1024; // 2.5GB
  const MEMORY_CRITICAL_BYTES = 3.2 * 1024 * 1024 * 1024; // 3.2GB
  const LINE_COUNT_WARN_THRESHOLD = 100000;

  function logDiagnostic(message: string): void {
    try {
      appendFileSync(diagnosticsLogFile, `[${new Date().toISOString()}] ${message}\n`);
    } catch (_err) { // eslint-disable-line unused-imports/no-unused-vars
      // Fallback to stderr if file write fails (e.g., /tmp full)
      const fallbackMsg = `[${new Date().toISOString()}] ${message}`;
      try {
        console.error(`[filter-fallback-log] ${fallbackMsg}`);
      } catch {
        // Last resort: silent fail to prevent cascade
      }
    }
  }

  function checkMemoryPressure(): void {
    try {
      const usage = process.memoryUsage();
      const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

      if (usage.heapUsed > MEMORY_CRITICAL_BYTES) {
        memoryWarningsTriggered++;
        logDiagnostic(
          `filter-warning: critical_memory: heap_used=${Math.round(usage.heapUsed / 1024 / 1024)}mb ` +
          `heap_total=${Math.round(usage.heapTotal / 1024 / 1024)}mb heap_usage=${heapUsedPercent.toFixed(1)}%`
        );
      } else if (usage.heapUsed > MEMORY_WARN_BYTES) {
        memoryWarningsTriggered++;
        logDiagnostic(
          `filter-warning: elevated_memory: heap_used=${Math.round(usage.heapUsed / 1024 / 1024)}mb ` +
          `heap_total=${Math.round(usage.heapTotal / 1024 / 1024)}mb heap_usage=${heapUsedPercent.toFixed(1)}%`
        );
      }
    } catch (_err) { // eslint-disable-line unused-imports/no-unused-vars
      // Fail silently; memory check is diagnostic
    }
  }

  // Log startup
  logDiagnostic('filter-startup: process started');
  logDiagnostic(`filter-startup: pid=${process.pid}`);
  logDiagnostic(`filter-startup: node_version=${process.version}`);
  logDiagnostic(`filter-startup: argv=${process.argv.join(' ')}`);
  logDiagnostic(`filter-startup: diagnostics_log_file=${diagnosticsLogFile}`);
  logDiagnostic(`filter-startup: stdin_is_tty=${process.stdin.isTTY || false}`);
  logDiagnostic(
    `filter-startup: memory_thresholds: warn=${Math.round(MEMORY_WARN_BYTES / 1024 / 1024 / 1024)}gb ` +
    `critical=${Math.round(MEMORY_CRITICAL_BYTES / 1024 / 1024 / 1024)}gb`
  );

  // Set exit code to 0 IMMEDIATELY as default.
  // This ensures we always exit with 0, even if something crashes before 'close' fires.
  // This is critical for avoiding SIGPIPE failures in pipelines.
  process.exitCode = 0;

  const state = createInitialState();

  // Wrap createInterface() with explicit error boundary (Step 1.1)
  let rl: any;
  try {
    rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
  } catch (err: unknown) {
    const errMsg = `createInterface_error: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[validation-output-filter] FATAL: ${errMsg}`);
    logDiagnostic(`filter-error: ${errMsg}`);
    logDiagnostic('filter-error: createInterface failed; exiting gracefully');
    process.exitCode = 0;
    return;
  }

  // Handle readline errors (e.g., stdin closed prematurely, encoding issues)
  rl.on('error', (err: Error) => {
    const msg = `readline_error: ${err.message}`;
    // Log to stderr but don't crash - allow graceful shutdown
    console.error(`[validation-output-filter] ${msg}`);
    logDiagnostic(`filter-error: ${msg}`);
    errorsEncountered.push(msg);
    // Ensure exit code stays at 0
    process.exitCode = 0;
  });

  // Handle stdin close event
  rl.on('close', () => {
    logDiagnostic('filter-close: stdin_closed');
    logDiagnostic(`filter-close: lines_processed=${linesProcessed}`);
    logDiagnostic(`filter-close: lines_output=${linesOutput}`);
    logDiagnostic(`filter-close: backpressure_events=${backpressureEvents}`);
    logDiagnostic(`filter-close: memory_warnings=${memoryWarningsTriggered}`);
    logDiagnostic(`filter-close: errors_encountered=${errorsEncountered.length}`);
    if (errorsEncountered.length > 0) {
      logDiagnostic(`filter-close: errors=${errorsEncountered.join('; ')}`);
    }
    logDiagnostic(`filter-close: exit_code=${process.exitCode}`);
    // Confirm exit with 0 (filter is diagnostic tool, not part of command logic).
    // Internal errors are logged to stderr but don't block the pipeline.
    process.exitCode = 0;
  });

  rl.on('line', (line: string) => {
    linesProcessed++;

    // Check memory pressure every 1000 lines (Step 1.3)
    if (linesProcessed % 1000 === 0) {
      checkMemoryPressure();

      // Warn if processing excessive number of lines (Step 1.3)
      if (linesProcessed > LINE_COUNT_WARN_THRESHOLD && linesProcessed % 10000 === 0) {
        logDiagnostic(
          `filter-warning: excessive_output: lines_processed=${linesProcessed} ` +
          `lines_output=${linesOutput} ratio=${(linesOutput / linesProcessed * 100).toFixed(1)}%`
        );
      }
    }

    try {
      const outputLine = processLine(line, state);

      if (outputLine !== null) {
        linesOutput++;
        // Catch any write errors to stdout (e.g., broken pipe from downstream process)
        // Step 1.2: Detect backpressure
        try {
          console.log(outputLine);
        } catch {
          // If console.log fails, continue gracefully (stream may have closed downstream)
          backpressureEvents++;
          logDiagnostic('filter-event: console_write_failed (backpressure)');
        }
      }
    } catch (lineErr) {
      const errMsg = lineErr instanceof Error ? lineErr.message : String(lineErr);
      console.error(`[validation-output-filter] Error processing line: ${errMsg}`);
      logDiagnostic(`filter-error: line_processing_error: ${errMsg}`);
      errorsEncountered.push(`line_processing_error: ${errMsg}`);
    }
  });

  // Handle stdout/stderr errors (e.g., broken pipe from downstream process)
  const stdout = process.stdout;
  const stderr = process.stderr;

  if (stdout && typeof stdout.on === 'function') {
    stdout.on('error', (err) => {
      // EPIPE is expected when downstream closes; don't treat as error
      if (err.code !== 'EPIPE') {
        const errMsg = `stdout_error: ${err.message}`;
        // Log error but continue; we always exit 0 anyway
        console.error(`[validation-output-filter] ${errMsg}`);
        logDiagnostic(`filter-error: ${errMsg}`);
        errorsEncountered.push(errMsg);
      } else {
        logDiagnostic('filter-event: stdout_epipe');
      }
    });
  }

  if (stderr && typeof stderr.on === 'function') {
    stderr.on('error', (err) => {
      // Ignore stderr errors; we're already reporting issues
      if (err.code !== 'EPIPE') {
        const errMsg = `stderr_error: ${err.message}`;
        logDiagnostic(`filter-error: ${errMsg}`);
        errorsEncountered.push(errMsg);
      }
    });
  }

  // Handle process-level errors (uncaught exceptions, unhandled rejections)
  process.on('error', (err) => {
    const errMsg = `process_error: ${err.message}`;
    console.error(`[validation-output-filter] ${errMsg}`);
    logDiagnostic(`filter-error: ${errMsg}`);
    errorsEncountered.push(errMsg);
    // Ensure we exit with 0 (filter is diagnostic, errors don't block pipeline)
    process.exitCode = 0;
  });

  process.on('uncaughtException', (err) => {
    const errMsg = `uncaught_exception: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[validation-output-filter] ${errMsg}`);
    logDiagnostic(`filter-error: ${errMsg}`);
    errorsEncountered.push(errMsg);
    // Ensure we exit with 0
    process.exitCode = 0;
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    const errMsg = `unhandled_rejection: ${reason instanceof Error ? reason.message : String(reason)}`;
    console.error(`[validation-output-filter] ${errMsg}`);
    logDiagnostic(`filter-error: ${errMsg}`);
    errorsEncountered.push(errMsg);
    // Ensure we exit with 0
    process.exitCode = 0;
  });

  // No forced fallback timeout is installed by default. This filter is driven by
  // stdin from an actively running validation command, so exiting on a fixed timer
  // can close the pipeline while the command is still producing output. If an
  // operator explicitly enables a watchdog for diagnostics, it only reports idle
  // periods and resets on every line; it never terminates the process while stdin
  // remains open.
  const idleWatchdogSeconds = Number.parseInt(process.env.FILTER_IDLE_WATCHDOG_SECONDS || '0', 10);
  let idleWatchdog: NodeJS.Timeout | null = null;

  function clearIdleWatchdog(): void {
    if (idleWatchdog !== null) {
      clearTimeout(idleWatchdog);
      idleWatchdog = null;
    }
  }

  function resetIdleWatchdog(): void {
    clearIdleWatchdog();
    if (Number.isFinite(idleWatchdogSeconds) && idleWatchdogSeconds > 0) {
      idleWatchdog = setTimeout(() => {
        logDiagnostic(`filter-warning: idle_watchdog_observed_no_lines_for=${idleWatchdogSeconds}s`);
        logDiagnostic('filter-warning: idle_watchdog_stdin_open=true');
        logDiagnostic(`filter-warning: lines_processed_at_idle=${linesProcessed}`);
        logDiagnostic(`filter-warning: lines_output_at_idle=${linesOutput}`);
        resetIdleWatchdog();
      }, idleWatchdogSeconds * 1000);
    }
  }

  resetIdleWatchdog();

  rl.on('line', () => {
    resetIdleWatchdog();
  });

  rl.on('close', () => {
    logDiagnostic('filter-event: clearing_idle_watchdog_after_stdin_close');
    clearIdleWatchdog();
  });
}

const entrypoint = process.argv[1] ? basename(process.argv[1]) : '';

if (entrypoint === 'validation-output-filter.js' || entrypoint === 'validation-output-filter.ts') {
  main();
}
