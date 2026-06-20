/**
 * Compilation validator for pre-agent and post-agent validation
 *
 * Provides utilities for running build commands and capturing results
 * for quality gate enforcement.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CompilationResult {
  success: boolean;
  exitCode: number;
  command: string;
  language: string;
  duration: number; // milliseconds
  stdout: string;
  stderr: string;
  output: string; // Combined stdout + stderr
  timestamp: number;
}

/**
 * Run a build command and capture results
 *
 * @param workspaceRoot - Root directory where build should run
 * @param buildCommand - Build command to execute (e.g., "npm run build", "go build")
 * @param language - Language identifier for logging
 * @param timeout - Timeout in milliseconds (default: 60000)
 * @returns CompilationResult with success status and captured output
 */
export function runCompilation(
  workspaceRoot: string,
  buildCommand: string,
  language: string,
  timeout: number = 60000,
): CompilationResult {
  const start = Date.now();

  try {
    const output = execSync(buildCommand, {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return {
      success: true,
      exitCode: 0,
      command: buildCommand,
      language,
      duration: Date.now() - start,
      stdout: output,
      stderr: '',
      output,
      timestamp: Date.now(),
    };
  } catch (error: any) {
    const stdout = error.stdout ? error.stdout.toString() : '';
    const isTimeout = error.code === 'ETIMEDOUT';
    const fallbackStderr = isTimeout ? error.message : '';
    const stderr = error.stderr ? error.stderr.toString() : fallbackStderr;
    const output = stdout + (stderr ? '\n' + stderr : '');

    return {
      success: false,
      exitCode: isTimeout ? 124 : (error.status ?? 1),
      command: buildCommand,
      language,
      duration: Date.now() - start,
      stdout,
      stderr,
      output,
      timestamp: Date.now(),
    };
  }
}

/**
 * Save compilation result to a log file
 *
 * @param result - Compilation result to save
 * @param logPath - Path to save the log file
 */
export function saveCompilationLog(result: CompilationResult, logPath: string): void {
  try {
    const logEntry = {
      timestamp: new Date(result.timestamp).toISOString(),
      success: result.success,
      exitCode: result.exitCode,
      command: result.command,
      language: result.language,
      duration: `${result.duration}ms`,
      output: result.output.substring(0, 10000), // Limit output size
    };

    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch {
    // Silently ignore log write failures
  }
}

/**
 * Format compilation result for human-readable output
 *
 * @param result - Compilation result
 * @returns Formatted string for logging
 */
export function formatCompilationResult(result: CompilationResult): string {
  const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
  const lines = [
    `${status}: ${result.language} compilation`,
    `Command: ${result.command}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${result.duration}ms`,
  ];

  if (result.output) {
    lines.push('\nOutput (last 500 chars):');
    lines.push(result.output.substring(-500));
  }

  return lines.join('\n');
}

/**
 * Check if compilation result indicates a critical failure
 *
 * @param result - Compilation result
 * @returns True if failure should trigger quality gate rejection
 */
export function isCompilationFailureCritical(result: CompilationResult): boolean {
  if (result.success) {
    return false;
  }

  // Exit code 124 is typically timeout; other codes are actual compilation errors
  return result.exitCode !== 124;
}

/**
 * Compare pre-agent and post-agent compilation results
 *
 * @param preAgent - Pre-agent compilation result
 * @param postAgent - Post-agent compilation result
 * @returns True if post-agent compilation improved or maintained status
 */
export function didCompilationImprove(
  preAgent: CompilationResult | null,
  postAgent: CompilationResult,
): boolean {
  // If no pre-agent result, we can't compare
  if (!preAgent) {
    return postAgent.success;
  }

  // If pre-agent failed and post-agent succeeded, compilation improved
  if (!preAgent.success && postAgent.success) {
    return true;
  }

  // If both succeeded or both failed at same exit code, no regression
  if (preAgent.success === postAgent.success) {
    return true;
  }

  // If pre-agent succeeded but post-agent failed, compilation regressed
  return false;
}

/**
 * Create a detailed compilation report
 *
 * @param language - Language/project type
 * @param command - Build command
 * @param result - Compilation result
 * @param phase - Phase identifier ("pre-agent" or "post-agent")
 * @returns Detailed report string
 */
export function createCompilationReport(
  language: string,
  command: string,
  result: CompilationResult,
  phase: string = 'post-agent',
): string {
  const lines = [
    `## Compilation Report (${phase})`,
    '',
    `**Language**: ${language}`,
    `**Command**: \`${command}\``,
    `**Status**: ${result.success ? '✅ PASSED' : '❌ FAILED'}`,
    `**Exit Code**: ${result.exitCode}`,
    `**Duration**: ${(result.duration / 1000).toFixed(2)}s`,
    `**Timestamp**: ${new Date(result.timestamp).toISOString()}`,
  ];

  if (!result.success) {
    lines.push('', '### Failure Details');
    lines.push('```');
    lines.push(result.output.substring(-2000));
    lines.push('```');
  } else {
    lines.push('', '✅ Compilation succeeded with no errors.');
  }

  return lines.join('\n');
}
