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
    description: 'Human-readable status summary with context and recommendations',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 2,
    sizeHint: 'small',
  },

  'analysis.md': {
    name: 'analysis.md',
    contentType: 'text/markdown',
    description: 'Comprehensive failure analysis with recommendations',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 3,
    sizeHint: 'medium',
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

  'scouting.json': {
    name: 'scouting.json',
    contentType: 'application/json',
    description: 'Read-only Pi scouting handoff: requirements, observations, plan, and validation hints',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 7,
    sizeHint: 'small',
  },

  'scouting-summary.json': {
    name: 'scouting-summary.json',
    contentType: 'application/json',
    description: 'Pi scouting event statistics including model and token metadata when available',
    availability: ArtifactAvailability.CONDITIONAL,
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

  'scouting-validation-summary.txt': {
    name: 'scouting-validation-summary.txt',
    contentType: 'text/plain',
    description: 'Concise summary of the latest scouting artifact validation result',
    availability: ArtifactAvailability.CONDITIONAL,
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

  'goal-check-summary.json': {
    name: 'goal-check-summary.json',
    contentType: 'application/json',
    description: 'Pi goal-check event statistics including model metadata when available',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'small',
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

  'run-evaluation-summary.json': {
    name: 'run-evaluation-summary.json',
    contentType: 'application/json',
    description: 'Pi run evaluation event statistics including model metadata when available',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'small',
  },

  'run-evaluation-stderr.log': {
    name: 'run-evaluation-stderr.log',
    contentType: 'text/plain',
    description: 'Run evaluation Pi stderr and artifact validation diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    sizeHint: 'medium',
  },

  // Progress & stage tracking
  'progress.log': {
    name: 'progress.log',
    contentType: 'text/plain',
    description: 'Text progress log: stage transitions, errors, quality gate events',
    availability: ArtifactAvailability.ALWAYS,
    triageOrder: 6,
    sizeHint: 'medium',
  },

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
    description: 'Pre-agent validation command output and baseline failure diagnostics',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 10,
    sizeHint: 'medium',
  },

  'pre-validation-timings.tsv': {
    name: 'pre-validation-timings.tsv',
    contentType: 'text/tab-separated-values',
    description: 'Per-command pre-agent validation timing: command, start, end, elapsed seconds',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 20,
    sizeHint: 'small',
  },

  'validation.log': {
    name: 'validation.log',
    contentType: 'text/plain',
    description: 'Validation command output and results',
    availability: ArtifactAvailability.ON_FAILURE,
    triageOrder: 11,
    sizeHint: 'medium',
  },

  'validation-timings.tsv': {
    name: 'validation-timings.tsv',
    contentType: 'text/tab-separated-values',
    description: 'Per-command timing: command, start, end, elapsed seconds',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 21,
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

  'stage-timings.tsv': {
    name: 'stage-timings.tsv',
    contentType: 'text/tab-separated-values',
    description: 'Per-stage timing: stage name, start, end, elapsed seconds',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 22,
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

  'git.status': {
    name: 'git.status',
    contentType: 'text/plain',
    description: 'Git status output: modified, added, deleted files (short format)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 13,
    sizeHint: 'small',
  },

  'changed-files.txt': {
    name: 'changed-files.txt',
    contentType: 'text/plain',
    description: 'One filename per line: files modified by the agent',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 14,
    sizeHint: 'small',
  },

  // Publishing & GitHub
  'git-push.log': {
    name: 'git-push.log',
    contentType: 'text/plain',
    description: 'GitHub push/PR creation log (if GitHub App integration enabled)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 22,
    sizeHint: 'small',
  },

  // Allowlist & restoration
  'restoration.jsonl': {
    name: 'restoration.jsonl',
    contentType: 'application/x-jsonl',
    description: 'Allowlist restoration events: file, timestamp, status (kept/restored)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 15,
    sizeHint: 'small',
  },

  'restoration-report.md': {
    name: 'restoration-report.md',
    contentType: 'text/markdown',
    description: 'Markdown summary of allowlist restoration events and impact',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 16,
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

  // Dependency caching
  'dependency-cache.log': {
    name: 'dependency-cache.log',
    contentType: 'text/plain',
    description: 'npm dependency cache strategy and hit/miss info',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 24,
    sizeHint: 'small',
  },

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
  'format-check-command.txt': {
    name: 'format-check-command.txt',
    contentType: 'text/plain',
    description: 'Format/lint check command if defined (development only)',
    availability: ArtifactAvailability.CONDITIONAL,
    triageOrder: 27,
    sizeHint: 'small',
  },
};
