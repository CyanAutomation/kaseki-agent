#!/usr/bin/env node

/**
 * kaseki-cli-lib.js
 *
 * Core library for querying and analyzing kaseki instances.
 * Provides functions for listing instances, reading status, detecting errors,
 * and performing post-run analysis.
 *
 * Usage:
 *   const kasekiCli = require('./kaseki-cli-lib.js');
 *   const instances = kasekiCli.listInstances();
 *   const status = kasekiCli.getInstanceStatus('kaseki-1');
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration object (can be overridden for testing)
const config = {
  KASEKI_RESULTS_DIR: process.env.KASEKI_RESULTS_DIR || '/agents/kaseki-results',
  KASEKI_RUNS_DIR: process.env.KASEKI_RUNS_DIR || '/agents/kaseki-runs',
};

// For backwards compatibility, also export as constants
const KASEKI_RESULTS_DIR = config.KASEKI_RESULTS_DIR;
const KASEKI_RUNS_DIR = config.KASEKI_RUNS_DIR;

// ============================================================================
// Instance Discovery
// ============================================================================

/**
 * Parse docker ps --format '{{.Names}}' output into container name array.
 */
function parseDockerContainerNames(dockerNamesOutput) {
  if (!dockerNamesOutput) return [];
  return dockerNamesOutput
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Exact container-name matcher (test seam).
 * Ensures "kaseki-1" does NOT match "kaseki-10".
 */
function isExactContainerNameMatch(containerName, instance) {
  return containerName === instance;
}

/**
 * Check whether docker ps names output contains an exact instance match.
 */
function dockerNamesOutputHasInstance(dockerNamesOutput, instance) {
  const containerNames = parseDockerContainerNames(dockerNamesOutput);
  return containerNames.some((name) => isExactContainerNameMatch(name, instance));
}

/**
 * Determine if an instance is currently running as a Docker container.
 * Gracefully falls back to false when Docker is unavailable.
 */
function isInstanceRunning(instance) {
  try {
    const dockerNamesOutput = execSync('docker ps --format "{{.Names}}" 2>/dev/null || true', {
      encoding: 'utf8',
    });
    return dockerNamesOutputHasInstance(dockerNamesOutput, instance);
  } catch (e) {
    // Docker may not be available
    return false;
  }
}

/**
 * Derive lifecycle status from running flag and exit code.
 */
function deriveInstanceLifecycleStatus(isRunning, exitCode) {
  if (isRunning) return 'running';
  if (exitCode === 0) return 'completed';
  if (Number.isInteger(exitCode)) return 'failed';
  return 'pending';
}

/**
 * Normalize an exit code candidate into an integer or null.
 */
function normalizeExitCodeCandidate(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return parseInt(value.trim(), 10);
  }
  return null;
}

/**
 * Resolve exit code from metadata first, then prefer /exit_code when readable/valid.
 * Returns null only when neither source has a valid integer.
 */
function resolveInstanceExitCode(resultDir, metadata = {}) {
  const metadataExitCode = normalizeExitCodeCandidate(metadata.exit_code);
  const exitCodePath = path.join(resultDir, 'exit_code');
  if (!fs.existsSync(exitCodePath)) {
    return metadataExitCode;
  }

  try {
    const fileExitCode = normalizeExitCodeCandidate(fs.readFileSync(exitCodePath, 'utf8'));
    return fileExitCode !== null ? fileExitCode : metadataExitCode;
  } catch (e) {
    return metadataExitCode;
  }
}

/**
 * Resolve stage from metadata first, then fallback to stdout markers.
 */
function resolveInstanceStage(instance, metadata = {}, fallback = 'unknown') {
  if (typeof metadata.current_stage === 'string' && metadata.current_stage.trim().length > 0) {
    return metadata.current_stage;
  }
  const parsedStage = getCurrentStage(instance);
  return parsedStage || fallback;
}

function isSkippableInstanceIoError(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ESTALE');
}

/**
 * List all kaseki instances (running and completed).
 * Returns array of instance objects with basic metadata.
 */
function listInstances() {
  const instances = [];

  // Scan results directory for completed instances
  let dirs = [];
  try {
    dirs = fs.readdirSync(config.KASEKI_RESULTS_DIR).filter((d) => d.match(/^kaseki-\d+$/));
  } catch (e) {
    // Results directory may disappear between checks or be transiently unreadable
    dirs = [];
  }

  for (const dir of dirs) {
    try {
      const instance = dir;
      const resultDir = path.join(config.KASEKI_RESULTS_DIR, instance);
      const metadataPath = path.join(resultDir, 'metadata.json');
      const hostStartPath = path.join(resultDir, 'host-start.json');

      let metadata = {};
      let hostStart = {};
      let isRunning = false;
      let exitCode = null;

      // Read metadata
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch (e) {
          if (isSkippableInstanceIoError(e)) {
            throw e;
          }
          // Metadata may still be incomplete if run is in progress
        }
      }

      // Read host start config
      if (fs.existsSync(hostStartPath)) {
        try {
          hostStart = JSON.parse(fs.readFileSync(hostStartPath, 'utf8'));
        } catch (e) {
          if (isSkippableInstanceIoError(e)) {
            throw e;
          }
        }
      }

      // Check if currently running via Docker (exact name match)
      isRunning = isInstanceRunning(instance);

      // Read exit code from metadata fallback and /exit_code when available
      exitCode = resolveInstanceExitCode(resultDir, metadata);

      // Calculate elapsed time
      let elapsedSeconds = null;
      if (metadata.duration_seconds !== undefined) {
        elapsedSeconds = metadata.duration_seconds;
      } else {
        const resourceTimePath = path.join(resultDir, 'resource.time');
        if (fs.existsSync(resourceTimePath)) {
          try {
            const content = fs.readFileSync(resourceTimePath, 'utf8');
            const match = content.match(/elapsed_seconds=(\d+)/);
            if (match) {
              elapsedSeconds = parseInt(match[1], 10);
            }
          } catch (e) {
            if (isSkippableInstanceIoError(e)) {
              throw e;
            }
          }
        }
      }

      instances.push({
        name: instance,
        status: deriveInstanceLifecycleStatus(isRunning, exitCode),
        running: isRunning,
        exitCode,
        elapsedSeconds,
        stage: resolveInstanceStage(instance, metadata, 'unknown'),
        model: hostStart.model || metadata.model || 'unknown',
        repo: hostStart.repo_url || hostStart.repo || 'unknown',
        ref: hostStart.git_ref || hostStart.ref || 'unknown',
      });
    } catch (e) {
      if (isSkippableInstanceIoError(e)) {
        // Instance directory can disappear while scanning; skip just this instance.
        continue;
      }
      throw e;
    }
  }

  return instances.sort((a, b) => {
    // Sort by instance number descending (newest first)
    const aNum = parseInt(a.name.match(/\d+/)[0], 10);
    const bNum = parseInt(b.name.match(/\d+/)[0], 10);
    return bNum - aNum;
  });
}

// ============================================================================
// Artifact Reading
// ============================================================================

/**
 * Read an artifact file from a kaseki results directory.
 * Returns file contents as string, or null if not found.
 */
function readArtifact(instance, filename) {
  const filePath = path.join(config.KASEKI_RESULTS_DIR, instance, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Read a live-writable log file (tail the last N lines).
 * Useful for stdout.log, stderr.log, validation.log which are continuously written.
 */
function readLiveLog(instance, filename, tailLines = 50) {
  const content = readArtifact(instance, filename);
  if (content === null) return null;

  const lines = content.split('\n').filter((line) => line.length > 0);
  return lines.slice(Math.max(0, lines.length - tailLines)).join('\n');
}

/**
 * Read sanitized progress events emitted by the runner.
 */
function readProgressEvents(instance, tailLines = 20) {
  const content = readArtifact(instance, 'progress.jsonl');
  if (content === null) return null;

  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  return lines.slice(Math.max(0, lines.length - tailLines)).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return {
        timestamp: null,
        stage: 'progress',
        message: line,
        malformed: true,
      };
    }
  });
}

/**
 * Parse JSON artifact file.
 * Returns parsed object, or empty object if not found or invalid.
 */
function readJsonArtifact(instance, filename) {
  const content = readArtifact(instance, filename);
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch (e) {
    return {};
  }
}

function parseTimestampSeconds(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function getPiStageStartedAtSeconds(instance) {
  const events = readProgressEvents(instance, 500);
  if (!events) return null;
  const started = [...events].reverse().find((event) => (
    event &&
    event.stage === 'pi coding agent' &&
    (event.message === 'started' || event.type === 'agent_start')
  ));
  return started ? parseTimestampSeconds(started.timestamp) : null;
}

// ============================================================================
// Status and Progress
// ============================================================================

/**
 * Get the current stage of a running or completed instance.
 * Parses stdout.log for "==> stage_name" markers.
 */
function getCurrentStage(instance) {
  const stdout = readArtifact(instance, 'stdout.log');
  if (!stdout) return 'unknown';

  // Look for the last "==> Stage:" marker
  const matches = stdout.match(/^==> (.+?)$/gm);
  if (!matches || matches.length === 0) return 'unknown';

  const lastMarker = matches[matches.length - 1];
  return lastMarker.replace(/^==> /, '').trim();
}

/**
 * Get the configured timeout seconds for the instance.
 * Reads from host-start.json or falls back to default (1200).
 */
function getConfiguredTimeout(instance) {
  const hostStart = readJsonArtifact(instance, 'host-start.json');
  return hostStart.agentTimeoutSeconds ?? 1200;
}

/**
 * Calculate timeout risk percentage (0-100).
 * Returns 0 if no risk, 100 if timed out, or percentage if approaching timeout.
 * Flags warning at 85% of timeout.
 */
function calculateTimeoutRiskPercent(instance, elapsedSeconds) {
  if (elapsedSeconds === null || elapsedSeconds === undefined) return 0;

  const timeout = getConfiguredTimeout(instance);
  const percent = (elapsedSeconds / timeout) * 100;

  return Math.min(Math.max(percent, 0), 100);
}

/**
 * Determine the overall status of an instance.
 * Synthesizes all available state into a unified status object.
 */
function getInstanceStatus(instance) {
  const resultDir = path.join(config.KASEKI_RESULTS_DIR, instance);
  if (!fs.existsSync(resultDir)) {
    return { error: `Instance ${instance} not found` };
  }

  const metadata = readJsonArtifact(instance, 'metadata.json');
  const hostStart = readJsonArtifact(instance, 'host-start.json');

  // Determine if running
  const isRunning = isInstanceRunning(instance);

  // Get elapsed time
  let elapsedSeconds = null;
  if (metadata.duration_seconds !== undefined) {
    elapsedSeconds = metadata.duration_seconds;
  } else if (isRunning) {
    // For running instances, estimate from start timestamp (new key first, legacy fallback)
    const startTimestamp = metadata.started_at || metadata.start_time;
    if (startTimestamp) {
      const startTime = new Date(startTimestamp).getTime();
      if (!Number.isNaN(startTime)) {
        elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      }
    }
  }

  // Get stage
  const stage = resolveInstanceStage(instance, metadata, 'unknown');

  // Get exit code from metadata fallback and /exit_code when available
  const exitCode = resolveInstanceExitCode(resultDir, metadata);

  let agentElapsedSeconds = null;
  if (metadata.pi_duration_seconds !== undefined) {
    agentElapsedSeconds = metadata.pi_duration_seconds;
  } else if (isRunning && stage === 'pi coding agent') {
    const piStartedAt = getPiStageStartedAtSeconds(instance);
    if (piStartedAt !== null) {
      agentElapsedSeconds = Math.max(Math.floor(Date.now() / 1000) - piStartedAt, 0);
    }
  }

  const timeoutSeconds = getConfiguredTimeout(instance);
  const timedOut = exitCode === 124;
  const timeoutRiskPercent = isRunning && stage === 'pi coding agent'
    ? calculateTimeoutRiskPercent(instance, agentElapsedSeconds)
    : (timedOut ? 100 : 0);
  const status = deriveInstanceLifecycleStatus(isRunning, exitCode);

  return {
    instance,
    status,
    running: isRunning,
    stage,
    elapsedSeconds,
    totalDurationSeconds: elapsedSeconds,
    agentElapsedSeconds,
    timeoutSeconds,
    timeoutRiskPercent,
    timeoutImminent: isRunning && stage === 'pi coding agent' && timeoutRiskPercent >= 85,
    timedOut,
    exitCode,
    repo: hostStart.repo_url || hostStart.repo || 'unknown',
    ref: hostStart.git_ref || hostStart.ref || 'unknown',
    model: hostStart.model || 'unknown',
  };
}

// ============================================================================
// Error Detection
// ============================================================================

/**
 * Error severity levels
 */
const ErrorSeverity = {
  CRITICAL: 'critical',
  ERROR: 'error',
  WARNING: 'warning',
};

/**
 * Detect errors in a kaseki instance.
 * Scans stderr, quality gates, secret scans, and validation failures.
 */
function detectErrors(instance) {
  const errors = [];
  const resultDir = path.join(config.KASEKI_RESULTS_DIR, instance);
  if (!fs.existsSync(resultDir)) {
    return errors;
  }

  // Check stderr.log for error patterns
  const stderr = readArtifact(instance, 'stderr.log');
  if (stderr) {
    const lines = stderr.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.match(/error|failed|exception|panic|abort/i) &&
        !line.match(/^#.*error/) // Ignore comments
      ) {
        errors.push({
          severity: ErrorSeverity.ERROR,
          source: 'stderr',
          line: i + 1,
          message: line.substring(0, 150),
        });
      }
    }
  }

  // Check quality.log for quality gate failures
  const qualityLog = readArtifact(instance, 'quality.log');
  if (qualityLog) {
    const lines = qualityLog.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length > 0) {
        errors.push({
          severity: ErrorSeverity.CRITICAL,
          source: 'quality-gate',
          line: i + 1,
          message: line.substring(0, 150),
        });
      }
    }
  }

  // Check secret-scan.log for secrets
  const secretScan = readArtifact(instance, 'secret-scan.log');
  if (secretScan) {
    const lines = secretScan.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length > 0) {
        errors.push({
          severity: ErrorSeverity.CRITICAL,
          source: 'secret-scan',
          line: i + 1,
          message: line.substring(0, 150),
        });
      }
    }
  }

  // Check validation.log for failed commands
  const validationLog = readArtifact(instance, 'validation.log');
  if (validationLog) {
    const lines = validationLog.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/FAILED|error|failed/i)) {
        errors.push({
          severity: ErrorSeverity.ERROR,
          source: 'validation',
          line: i + 1,
          message: line.substring(0, 150),
        });
      }
    }
  }

  return errors;
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Perform comprehensive post-run analysis.
 * Returns aggregate metrics and diagnostics.
 */
function getAnalysis(instance) {
  const resultDir = path.join(config.KASEKI_RESULTS_DIR, instance);
  if (!fs.existsSync(resultDir)) {
    return { error: `Instance ${instance} not found` };
  }

  const metadata = readJsonArtifact(instance, 'metadata.json');
  const piSummary = readJsonArtifact(instance, 'pi-summary.json');
  const changedFiles = readArtifact(instance, 'changed-files.txt')?.split('\n').filter(Boolean) || [];
  const errors = detectErrors(instance);
  const exitCode = metadata.exit_code !== null && metadata.exit_code !== undefined ? metadata.exit_code : 'unknown';
  const status = exitCode === 0 ? 'passed' : 'failed';

  return {
    instance,
    status,
    exit_code: exitCode,
    duration_seconds: metadata.duration_seconds || 0,
    pi_duration_seconds: metadata.pi_duration_seconds || 0,
    model: metadata.model || piSummary.selected_model || 'unknown',
    changed_files_count: changedFiles.length,
    changed_files: changedFiles.slice(0, 10),
    tool_executions: (piSummary.tool_start_count || 0) + (piSummary.tool_end_count || 0),
    errors: errors.slice(0, 10),
    error_count: errors.length,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  config,
  KASEKI_RESULTS_DIR,
  KASEKI_RUNS_DIR,
  listInstances,
  readArtifact,
  readLiveLog,
  readProgressEvents,
  readJsonArtifact,
  getCurrentStage,
  getConfiguredTimeout,
  calculateTimeoutRiskPercent,
  getInstanceStatus,
  detectErrors,
  getAnalysis,
  ErrorSeverity,
  parseDockerContainerNames,
  isExactContainerNameMatch,
  dockerNamesOutputHasInstance,
  isInstanceRunning,
  deriveInstanceLifecycleStatus,
  normalizeExitCodeCandidate,
  resolveInstanceExitCode,
  resolveInstanceStage,
};
