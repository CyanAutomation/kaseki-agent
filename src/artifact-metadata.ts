/**
 * Comprehensive artifact metadata registry.
 * Defines all available artifacts with their properties for discovery and triage.
 */

import { ArtifactMetadataDefinition, ArtifactAvailability } from './kaseki-api-types';

/**
 * All available artifacts organized by category and availability.
 * Used by API routes to enumerate, filter, and serve artifacts.
 */
export const ARTIFACT_METADATA_REGISTRY: Record<string, ArtifactMetadataDefinition> = {
  // Core metadata (always available)
  'metadata.json': {
    name: 'metadata.json',
    contentType: 'application/json',
    description: 'Timestamps, instance info, environment, durations, failure classification',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 25,
    sizeHint: 'small',
  },

  // Diagnostic summaries (always available)

  'result-summary.md': {
    name: 'result-summary.md',
    contentType: 'text/markdown',
    description: 'Human-readable run summary: status, failed commands, validation results, goal-check verdict',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 3,
    sizeHint: 'small',
  },

  'inspect-report.md': {
    name: 'inspect-report.md',
    contentType: 'text/markdown',
    description: 'Inspect mode findings summary: analysis scope, key statistics, findings, recommendations',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 2,
    sizeHint: 'medium',
  },

  // Failure-specific diagnostics
  'failure.json': {
    name: 'failure.json',
    contentType: 'application/json',
    description: 'Structured failure classification: exit code, stage, reason, stderr tail',
    availability: ArtifactAvailability.ON_FAILURE,
    triageOrder: 1,
    sizeHint: 'small',
  },

  // Agent output
  'pi-events.jsonl': {
    name: 'pi-events.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Pi CLI structured events (sanitized, no thinking blocks)',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 4,
    sizeHint: 'large',
  },

  'pi-summary.json': {
    name: 'pi-summary.json',
    contentType: 'application/json',
    description: 'Pi event statistics: input/output tokens, thinking time, model info',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 5,
    sizeHint: 'small',
  },

  // Goal-setting (pre-scouting phase)
  'goal-setting.json': {
    name: 'goal-setting.json',
    contentType: 'application/json',
    description: 'Pre-scouting goal-setting output: upgraded goal, requirements, success criteria, anti-patterns, quality metrics',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 6,
    sizeHint: 'small',
  },

  'critical-change-expectations.json': {
    name: 'critical-change-expectations.json',
    contentType: 'application/json',
    description: 'Critical change expectations from goal-setting: files expected to change, patterns, verification hints',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 9,
    sizeHint: 'small',
  },



  'goal-setting-events.jsonl': {
    name: 'goal-setting-events.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Sanitized Pi events from the goal-setting phase',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },

  'goal-setting-stderr.log': {
    name: 'goal-setting-stderr.log',
    contentType: 'text/plain',
    description: 'Goal-setting Pi stderr and artifact validation diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },

  'goal-setting-validation-errors.jsonl': {
    name: 'goal-setting-validation-errors.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Structured goal-setting artifact validation failures with field-level expected/actual details and suggestions',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 8,
    sizeHint: 'small',
  },



  'scouting.json': {
    name: 'scouting.json',
    contentType: 'application/json',
    description: 'Read-only Pi scouting handoff: requirements, observations, plan, and validation hints',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 7,
    sizeHint: 'small',
  },



  'scouting-events.jsonl': {
    name: 'scouting-events.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Sanitized Pi events from the scouting phase',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },

  'scouting-events.raw.jsonl': {
    name: 'scouting-events.raw.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Raw Pi scouting events kept only when scouting event export fails',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },

  'scouting-stderr.log': {
    name: 'scouting-stderr.log',
    contentType: 'text/plain',
    description: 'Scouting Pi stderr and artifact validation diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },

  'scouting-validation-errors.jsonl': {
    name: 'scouting-validation-errors.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Structured scouting artifact validation failures with field-level expected/actual details and suggestions',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 8,
    sizeHint: 'small',
  },

  'goal-check.json': {
    name: 'goal-check.json',
    contentType: 'application/json',
    description: 'Latest post-validation Pi goal-check verdict',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 6,
    sizeHint: 'small',
  },

  'goal-check-attempts.jsonl': {
    name: 'goal-check-attempts.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Structured goal-check verdict history across coding attempts',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 7,
    sizeHint: 'small',
  },

  'goal-check-events.jsonl': {
    name: 'goal-check-events.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Sanitized Pi events from the goal-check evaluator phase',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },



  'goal-check-stderr.log': {
    name: 'goal-check-stderr.log',
    contentType: 'text/plain',
    description: 'Goal-check Pi stderr and artifact validation diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },

  'goal-check-validation-errors.jsonl': {
    name: 'goal-check-validation-errors.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Structured goal-check artifact validation failures with field-level expected/actual details and suggestions',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 8,
    sizeHint: 'small',
  },

  'run-evaluation.json': {
    name: 'run-evaluation.json',
    contentType: 'application/json',
    description: 'Final task-agnostic run evaluation: reviewer confidence, stage value, and Kaseki improvement opportunities',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 5,
    sizeHint: 'small',
  },

  'run-evaluation-events.jsonl': {
    name: 'run-evaluation-events.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Sanitized Pi events from the final run evaluation phase',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'large',
  },



  'run-evaluation-stderr.log': {
    name: 'run-evaluation-stderr.log',
    contentType: 'text/plain',
    description: 'Run evaluation Pi stderr and artifact validation diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },

  // Progress & stage tracking

  'progress.jsonl': {
    name: 'progress.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Structured progress events: stage, percentage, timestamp, message',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 7,
    sizeHint: 'medium',
  },

  // Container output
  'stdout.log': {
    name: 'stdout.log',
    contentType: 'text/plain',
    description: 'Container stdout: all script output, logging, debugging info',
    availability: ArtifactAvailability.ON_FAILURE,
    triageOrder: 8,
    sizeHint: 'large',
  },

  'stderr.log': {
    name: 'stderr.log',
    contentType: 'text/plain',
    description: 'Container stderr: errors and warnings from all processes',
    availability: ArtifactAvailability.ON_FAILURE,
    triageOrder: 9,
    sizeHint: 'medium',
  },

  // Validation & quality

  'pre-validation.log': {
    name: 'pre-validation.log',
    contentType: 'text/plain',
    description: 'Pre-agent validation baseline output (baseline on main branch)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 10,
    sizeHint: 'medium',
  },



  'validation.log': {
    name: 'validation.log',
    contentType: 'text/plain',
    description: 'Validation command output and results',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 11,
    sizeHint: 'medium',
  },

  'test-baseline-comparison.json': {
    name: 'test-baseline-comparison.json',
    contentType: 'application/json',
    description: 'Test failure classification: newly-introduced failures, pre-existing failures, fixed tests',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 13,
    sizeHint: 'small',
  },



  'quality.log': {
    name: 'quality.log',
    contentType: 'text/plain',
    description: 'Quality gate evaluation: diff size, changed files, allowlist checks',
    availability: ArtifactAvailability.ON_FAILURE,
    triageOrder: 12,
    sizeHint: 'small',
  },



  // Repository changes
  'git.diff': {
    name: 'git.diff',
    contentType: 'text/plain',
    description: 'Unified diff of all repository changes',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 12,
    sizeHint: 'large',
  },

  'changed-files.txt': {
    name: 'changed-files.txt',
    contentType: 'text/plain',
    description: 'One filename per line: files modified by the agent',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 14,
    sizeHint: 'small',
  },

  'git.status': {
    name: 'git.status',
    contentType: 'text/plain',
    description: 'Git status output: files changed, staged, untracked before/after agent changes',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 15,
    sizeHint: 'small',
  },

  // Publishing & GitHub

  // Allowlist & restoration
  'restoration.jsonl': {
    name: 'restoration.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Allowlist restoration events: file, timestamp, status (kept/restored)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 15,
    sizeHint: 'small',
  },

  // Security & compliance
  'secret-scan.log': {
    name: 'secret-scan.log',
    contentType: 'text/plain',
    description: 'Secret/credential scanning results (empty if no secrets found)',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 23,
    sizeHint: 'small',
  },

  // Phase 2: Structured JSON Artifacts (consolidated free-form logs)

  'validation-results.json': {
    name: 'validation-results.json',
    contentType: 'application/json',
    description: 'Structured validation results: array of command execution objects with exit codes, durations, and status',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 11,
    sizeHint: 'small',
  },

  'quality-gates.json': {
    name: 'quality-gates.json',
    contentType: 'application/json',
    description: 'Structured quality gate violations: array of violations with type, detail, and severity',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 12,
    sizeHint: 'small',
  },

  'cache-metrics.json': {
    name: 'cache-metrics.json',
    contentType: 'application/json',
    description: 'Structured dependency cache metrics: array of cache statistics (hits, misses, bytes used, etc.)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 24,
    sizeHint: 'small',
  },

  'all-phase-summaries.json': {
    name: 'all-phase-summaries.json',
    contentType: 'application/json',
    description: 'Consolidation: all phase summaries aggregated (scouting, goal-setting, pi-agent, goal-check, run-evaluation)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 25,
    sizeHint: 'small',
  },

  'timings-manifest.json': {
    name: 'timings-manifest.json',
    contentType: 'application/json',
    description: 'Consolidation: timing data aggregated from validation-timings.tsv, pre-validation-timings.tsv, stage-timings.tsv',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 26,
    sizeHint: 'small',
  },

  'phase-errors.jsonl': {
    name: 'phase-errors.jsonl',
    contentType: 'application/jsonl',
    description: 'Consolidation: all phase stderr logs aggregated into JSONL format for error analysis',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 27,
    sizeHint: 'small',
  },

  'artifact-validation-errors.jsonl': {
    name: 'artifact-validation-errors.jsonl',
    contentType: 'application/jsonl',
    description: 'Consolidation: all phase validation errors aggregated (scouting, goal-setting, goal-check)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 28,
    sizeHint: 'small',
  },

  'secret-scan.json': {
    name: 'secret-scan.json',
    contentType: 'application/json',
    description: 'Structured secret scan results: array of detected patterns with file, pattern, and allowlist status',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 23,
    sizeHint: 'small',
  },

  // Dependency caching

  // Exit code (machine-readable)
  'exit_code': {
    name: 'exit_code',
    contentType: 'text/plain',
    description: 'Container exit code (0=success, non-zero=failure)',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 26,
    sizeHint: 'small',
  },

  // Format check (development)
};
