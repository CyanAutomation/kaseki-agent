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
  KASEKI_RESULTS_DIR: '/agents/kaseki-results',
  KASEKI_RUNS_DIR: '/agents/kaseki-runs',
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
 * List all kaseki instances (running and completed).
 * Returns array of instance objects with basic metadata.
 */
function listInstances() {
  const instances = [];

  // Scan results directory for completed instances
  if (fs.existsSync(config.KASEKI_RESULTS_DIR)) {
    const dirs = fs.readdirSync(config.KASEKI_RESULTS_DIR).filter((d) => d.match(/^kaseki-\d+$/));
    for (const dir of dirs) {
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
          // Metadata may still be incomplete if run is in progress
        }
      }

      // Read host start config
      if (fs.existsSync(hostStartPath)) {
        try {
          hostStart = JSON.parse(fs.readFileSync(hostStartPath, 'utf8'));
        } catch (e) {}
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
          } catch (e) {}
        }
      }

      instances.push({
        name: instance,
        status: deriveInstanceLifecycleStatus(isRunning, exitCode),
        running: isRunning,
        exitCode,
        elapsedSeconds,
        stage: metadata.current_stage || 'unknown',
        model: hostStart.model || metadata.model || 'unknown',
        repo: hostStart.repo_url || hostStart.repo || 'unknown',
        ref: hostStart.git_ref || hostStart.ref || 'unknown',
      });
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
    // For running instances, estimate from start time
    if (metadata.start_time) {
      const startTime = new Date(metadata.start_time).getTime();
      elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    }
  }

  // Get stage
  const stage = getCurrentStage(instance);

  // Get exit code from metadata fallback and /exit_code when available
  const exitCode = resolveInstanceExitCode(resultDir, metadata);

  const timeoutSeconds = getConfiguredTimeout(instance);
  const timeoutRiskPercent = calculateTimeoutRiskPercent(instance, elapsedSeconds);
  const status = deriveInstanceLifecycleStatus(isRunning, exitCode);

  return {
    instance,
    status,
    running: isRunning,
    stage,
    elapsedSeconds,
    timeoutSeconds,
    timeoutRiskPercent,
    timeoutImminent: timeoutRiskPercent >= 85,
    timedOut: exitCode === 124,
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

  // Check secret-scan.log for credential leaks
  const secretLog = readArtifact(instance, 'secret-scan.log');
  if (secretLog) {
    const lines = secretLog.split('\n');
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

  // Check validation timing rows for validation command failures.
  const validationTimings = readArtifact(instance, 'validation-timings.tsv');
  if (validationTimings) {
    const lines = validationTimings.split('\n').filter((l) => l.trim().length > 0);
    const malformedTimingRows = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) {
        malformedTimingRows.push({ line, reason: 'missing required TSV columns' });
        continue;
      }

      const command = parts[0];
      const exitCodeRaw = parts[1].trim();
      const exitCode = parseInt(exitCodeRaw, 10);
      const hasIntegerExitCode = Number.isFinite(exitCode) && /^-?\d+$/.test(exitCodeRaw) && exitCode >= 0 && exitCode <= 255;
      if (!hasIntegerExitCode) {
        malformedTimingRows.push({ line, reason: `invalid exit code "${parts[1]}"` });
        continue;
      }

      if (exitCode !== 0) {
        errors.push({
          severity: ErrorSeverity.ERROR,
          source: 'validation',
          message: `Validation command failed: ${command} (exit code: ${exitCode})`,
        });
      }
    }

    if (malformedTimingRows.length > 0) {
      console.warn(
        `[kaseki-cli-lib] Skipped ${malformedTimingRows.length} malformed row(s) in validation-timings.tsv for ${instance}`
      );
    }
  }

  // Check exit code for timeout
  let exitCode = null;
  const exitCodePath = path.join(resultDir, 'exit_code');
  if (fs.existsSync(exitCodePath)) {
    try {
      exitCode = parseInt(fs.readFileSync(exitCodePath, 'utf8').trim(), 10);
    } catch (e) {}
  }

  if (exitCode === 124) {
    errors.push({
      severity: ErrorSeverity.CRITICAL,
      source: 'timeout',
      message: 'Agent timeout (SIGTERM)',
    });
  } else if (exitCode === 3) {
    errors.push({
      severity: ErrorSeverity.ERROR,
      source: 'quality-gate',
      message: 'Git diff is empty (no changes made)',
    });
  } else if (exitCode === 4) {
    errors.push({
      severity: ErrorSeverity.ERROR,
      source: 'quality-gate',
      message: 'Diff exceeds maximum size limit',
    });
  } else if (exitCode === 5) {
    errors.push({
      severity: ErrorSeverity.ERROR,
      source: 'quality-gate',
      message: 'Changed files outside allowlist',
    });
  } else if (exitCode === 6) {
    errors.push({
      severity: ErrorSeverity.CRITICAL,
      source: 'secret-scan',
      message: 'Credential leak detected (sk-or-* pattern)',
    });
  }

  return errors;
}

// ============================================================================
// Anomaly Detection
// ============================================================================

/**
 * Detect anomalies in instance execution.
 * Currently focuses on timeout risk.
 */
function detectAnomalies(instance) {
  const anomalies = [];
  const status = getInstanceStatus(instance);

  if (status.error) {
    return anomalies;
  }

  // Timeout risk
  if (status.timeoutImminent) {
    anomalies.push({
      type: 'timeout-risk',
      severity: 'warning',
      message: `Timeout approaching: ${status.elapsedSeconds}s / ${status.timeoutSeconds}s (${status.timeoutRiskPercent.toFixed(1)}%)`,
    });
  }

  if (status.timedOut) {
    anomalies.push({
      type: 'timeout',
      severity: 'critical',
      message: `Process timed out after ${status.elapsedSeconds}s`,
    });
  }

  return anomalies;
}

// ============================================================================
// Validation Parsing
// ============================================================================

/**
 * Parse validation timings from validation-timings.tsv.
 * Format: command_name<tab>exit_code<tab>duration_seconds
 */
function parseValidationTimings(instance) {
  const timings = [];
  const content = readArtifact(instance, 'validation-timings.tsv');
  if (!content) return timings;

  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      timings.push({
        command: parts[0],
        exitCode: parseInt(parts[1], 10),
        durationSeconds: parseInt(parts[2], 10),
      });
    }
  }
  return timings;
}

// ============================================================================
// Post-Run Analysis
// ============================================================================

/**
 * Get comprehensive post-run analysis of a completed instance.
 */
function getAnalysis(instance) {
  const resultDir = path.join(config.KASEKI_RESULTS_DIR, instance);
  if (!fs.existsSync(resultDir)) {
    return { error: `Instance ${instance} not found` };
  }

  const metadata = readJsonArtifact(instance, 'metadata.json');
  const piSummary = readJsonArtifact(instance, 'pi-summary.json');
  const hostStart = readJsonArtifact(instance, 'host-start.json');

  // Get changed files
  let changedFiles = [];
  const changedFilesContent = readArtifact(instance, 'changed-files.txt');
  if (changedFilesContent) {
    changedFiles = changedFilesContent
      .split('\n')
      .filter((f) => f.trim().length > 0)
      .map((f) => f.trim());
  }

  // Get diff size
  let diffSizeBytes = 0;
  const diffContent = readArtifact(instance, 'git.diff');
  if (diffContent) {
    diffSizeBytes = Buffer.byteLength(diffContent, 'utf8');
  }

  // Get validation timings
  const validationTimings = parseValidationTimings(instance);

  // Get error
  const errors = detectErrors(instance);

  // Get exit code from file (metadata may not have it)
  let exitCode = metadata.exit_code ?? null;
  const exitCodePath = path.join(config.KASEKI_RESULTS_DIR, instance, 'exit_code');
  if (fs.existsSync(exitCodePath)) {
    try {
      exitCode = parseInt(fs.readFileSync(exitCodePath, 'utf8').trim(), 10);
    } catch (e) {}
  }

  return {
    instance,
    duration: metadata.duration_seconds ?? 0,
    exitCode,
    model: piSummary.model || hostStart.model || 'unknown',
    repo: hostStart.repo_url || hostStart.repo || 'unknown',
    ref: hostStart.git_ref || hostStart.ref || 'unknown',
    stage: metadata.current_stage || 'completed',
    changedFiles,
    changedFileCount: changedFiles.length,
    diffSizeBytes,
    diffSizeKb: Math.round(diffSizeBytes / 1024),
    validationCommands: validationTimings.map((t) => ({
      command: t.command,
      exitCode: t.exitCode,
      durationSeconds: t.durationSeconds,
      passed: t.exitCode === 0,
    })),
    piMetrics: {
      toolStartCount: piSummary.tool_start_count ?? 0,
      toolEndCount: piSummary.tool_end_count ?? 0,
      eventCount: piSummary.event_count ?? 0,
    },
    errors,
    errorCount: errors.length,
    criticalErrors: errors.filter((e) => e.severity === ErrorSeverity.CRITICAL).length,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Configuration and constants
  config,
  KASEKI_RESULTS_DIR,
  KASEKI_RUNS_DIR,
  ErrorSeverity,

  // Instance discovery
  parseDockerContainerNames,
  isExactContainerNameMatch,
  dockerNamesOutputHasInstance,
  deriveInstanceLifecycleStatus,
  isInstanceRunning,
  listInstances,

  // Artifact reading
  readArtifact,
  readLiveLog,
  readJsonArtifact,

  // Status and progress
  getCurrentStage,
  getConfiguredTimeout,
  calculateTimeoutRiskPercent,
  getInstanceStatus,

  // Error detection
  detectErrors,

  // Anomaly detection
  detectAnomalies,

  // Validation parsing
  parseValidationTimings,

  // Analysis
  getAnalysis,
};
