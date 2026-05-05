/**
 * Shared subprocess execution utilities and patterns.
 * Consolidates error handling, timeouts, and Docker-specific logic
 * to reduce duplication across job-scheduler.ts, kaseki-api-routes.ts, and file-helpers.ts.
 */

import { spawnSync, SpawnSyncReturns } from 'child_process';

/**
 * Result of a subprocess execution.
 */
export interface SubprocessResult {
  ok: boolean;
  status?: number;
  stdout?: string;
  stderr?: string;
  detail?: string;
  error?: string;
}

/**
 * Classification of a Docker command failure with remediation steps.
 */
export interface DockerFailureClassification {
  detail: string;
  remediation: string;
}

/**
 * Default timeout for subprocess operations in milliseconds.
 */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Classify a Docker command failure based on error message.
 * Returns actionable detail and remediation information.
 *
 * @param stderr Error output from Docker command
 * @returns Object with detail and remediation strings
 */
export function classifyDockerFailure(stderr: string): DockerFailureClassification {
  const normalized = stderr.toLowerCase();
  if (normalized.includes('permission denied') || normalized.includes('connect: permission denied')) {
    return {
      detail: 'Docker daemon socket is not accessible from the API process.',
      remediation:
        'Add the API container user to the host Docker socket group, for example group_add: ["${DOCKER_GID:-985}"].',
    };
  }
  if (normalized.includes('cannot connect') || normalized.includes('is the docker daemon running')) {
    return {
      detail: 'Docker daemon is unreachable from the API process.',
      remediation: 'Mount /var/run/docker.sock and verify the host Docker daemon is running.',
    };
  }
  return {
    detail: stderr.trim() || 'Docker command failed.',
    remediation: 'Verify Docker CLI, daemon access, and the mounted Docker socket.',
  };
}

/**
 * Extract error message from a SpawnSyncReturns result.
 * Prioritizes stderr, then stdout, then error message.
 *
 * @param result SpawnSync result object
 * @returns Combined error message string
 */
export function extractErrorMessage(result: SpawnSyncReturns<string | Buffer>): string {
  const parts: string[] = [];
  if (result.stderr) {
    parts.push(typeof result.stderr === 'string' ? result.stderr : result.stderr.toString());
  }
  if (result.stdout && !result.stderr) {
    parts.push(typeof result.stdout === 'string' ? result.stdout : result.stdout.toString());
  }
  if (result.error?.message && !parts.length) {
    parts.push(result.error.message);
  }
  return parts.join(' ').trim();
}

/**
 * Execute a shell command with standard error handling and timeout.
 * Returns success/failure status with combined output.
 *
 * @param command Command to execute
 * @param args Arguments to pass
 * @param options.cwd Working directory (optional)
 * @param options.timeoutMs Timeout in milliseconds (default: 5000)
 * @returns SubprocessResult with status, output, and detail
 *
 * @example
 * const result = execSubprocess('docker', ['version']);
 * if (result.ok) {
 *   console.log(result.stdout);
 * } else {
 *   console.error(result.detail);
 * }
 */
export function execSubprocess(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
  },
): SubprocessResult {
  const result = spawnSync(command, args, {
    cwd: options?.cwd,
    encoding: 'utf-8',
    timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const detail = extractErrorMessage(result);

  return {
    ok: result.status === 0,
    status: result.status ?? undefined,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim() || undefined : undefined,
    stderr: typeof result.stderr === 'string' ? result.stderr.trim() || undefined : undefined,
    detail: detail || undefined,
    error: result.error?.message,
  };
}

/**
 * Execute a Docker command with error classification and timeout.
 * Automatically classifies Docker-specific error messages.
 *
 * @param args Docker command arguments (e.g., ['version', '--format', '{{.Client.Version}}'])
 * @param timeoutMs Timeout in milliseconds (default: 5000)
 * @returns Object with status, output, and Docker-specific error classification
 *
 * @example
 * const result = execDockerCommand(['version']);
 * if (result.ok) {
 *   console.log(result.stdout);
 * } else {
 *   console.error(result.classification.remediation);
 * }
 */
export function execDockerCommand(
  args: string[],
  timeoutMs?: number,
): SubprocessResult & { classification?: DockerFailureClassification } {
  const result = execSubprocess('docker', args, { timeoutMs });

  if (!result.ok && result.detail) {
    return {
      ...result,
      classification: classifyDockerFailure(result.detail),
    };
  }

  return result;
}

/**
 * Execute a command and return only its stdout output on success, undefined on failure.
 * Useful for extracting single-value outputs (version strings, git refs, etc.).
 *
 * @param command Command to execute
 * @param args Arguments to pass
 * @param cwd Working directory (optional)
 * @returns Trimmed stdout on success, undefined on failure
 *
 * @example
 * const version = commandOutput('git', ['rev-parse', '--short', 'HEAD']);
 * if (version) {
 *   console.log('Commit:', version);
 * }
 */
export function commandOutput(command: string, args: string[], cwd?: string): string | undefined {
  const result = execSubprocess(command, args, { cwd });
  return result.ok ? result.stdout : undefined;
}
