/**
 * Phase detection logic for collectEvidence
 * Separates phase detection concerns from the main evidence aggregation
 */

import { number, object } from './run-scorecard-guards';
import type { ArtifactSnapshot } from './run-scorecard-evidence-types';

type StageMatcher = (pattern: RegExp) => boolean;

function goalSettingReached(snapshot: ArtifactSnapshot, metadata: Record<string, unknown>, hasStage: StageMatcher): boolean {
  return Boolean(snapshot.json['goal-setting.json'])
    || hasStage(/goal.setting/i)
    || (number(metadata.goal_setting_duration_seconds) ?? 0) > 0;
}

function scoutingReached(snapshot: ArtifactSnapshot, metadata: Record<string, unknown>, hasStage: StageMatcher): boolean {
  return Boolean(snapshot.json['scouting.json'])
    || hasStage(/scouting/i)
    || (number(metadata.scouting_duration_seconds) ?? 0) > 0;
}

function codingReached(snapshot: ArtifactSnapshot, noChangeAccepted: boolean, hasStage: StageMatcher): boolean {
  return Boolean(snapshot.json['pi-summary.json'])
    || Boolean(snapshot.text['pi-events.jsonl'])
    || hasStage(/pi coding agent/i)
    || (snapshot.text['git.diff'] ?? '').trim().length > 0
    || noChangeAccepted;
}

function validationReached(
  metadata: Record<string, unknown>,
  executedValidationRowsCount: number,
  validationExitCode: number | undefined,
  hasStage: StageMatcher,
): boolean {
  return executedValidationRowsCount > 0
    || (number(metadata.validation_commands_attempted) ?? 0) > 0
    || hasStage(/^validation$/i)
    || (validationExitCode !== undefined && validationExitCode !== 0);
}

function goalCheckReached(snapshot: ArtifactSnapshot, metadata: Record<string, unknown>, hasStage: StageMatcher): boolean {
  return Boolean(snapshot.json['goal-check.json'])
    || hasStage(/goal check/i)
    || (number(metadata.goal_check_duration_seconds) ?? 0) > 0
    || String(metadata.failed_command ?? '').toLowerCase() === 'goal check'
    || String(metadata.goal_check_failure_reason ?? '').trim().length > 0;
}

function evaluationReached(
  evaluation: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>,
  evaluatorFailed: boolean,
  hasStage: StageMatcher,
): boolean {
  return Boolean(evaluation)
    || hasStage(/run evaluation/i)
    || (number(metadata.run_evaluation_duration_seconds) ?? 0) > 0
    || evaluatorFailed;
}

/**
 * Detects whether each phase was reached during execution.
 * Uses multiple signals: artifact presence, stage timings, metadata, and git diff.
 */
export function detectPhaseReached(
  snapshot: ArtifactSnapshot,
  metadata: Record<string, unknown> | undefined,
  stageRows: unknown[],
  execution: {
    evaluation?: Record<string, unknown>;
    evaluatorFailed: boolean;
    noChangeAccepted: boolean;
    executedValidationRowsCount: number;
    validationExitCode?: number;
  },
): Record<string, boolean> {
  const meta = metadata ?? {};
  const hasStage = (pattern: RegExp) => stageRows.some(row => pattern.test(String(object(row)?.stage ?? '')));

  return {
    goal_setting: goalSettingReached(snapshot, meta, hasStage),
    scouting: scoutingReached(snapshot, meta, hasStage),
    coding: codingReached(snapshot, execution.noChangeAccepted, hasStage),
    validation: validationReached(meta, execution.executedValidationRowsCount, execution.validationExitCode, hasStage),
    goal_check: goalCheckReached(snapshot, meta, hasStage),
    run_evaluation: evaluationReached(execution.evaluation, meta, execution.evaluatorFailed, hasStage),
  };
}

/**
 * Detects terminal failures for each phase based on exit codes from metadata/failure artifacts.
 */
export function detectPhaseFailures(
  metadata: Record<string, unknown>,
  failure: Record<string, unknown>,
  evaluatorFailed: boolean,
): Record<string, boolean> {
  return {
    goal_setting: (number(failure.goal_setting_exit_code) ?? number(metadata.goal_setting_exit_code) ?? 0) !== 0,
    scouting: (number(failure.scouting_exit_code) ?? number(metadata.scouting_exit_code) ?? 0) !== 0,
    coding: (number(failure.pi_exit_code) ?? number(metadata.pi_exit_code) ?? 0) !== 0,
    validation: (number(failure.validation_exit_code) ?? number(metadata.validation_exit_code) ?? 0) !== 0,
    goal_check: (number(failure.goal_check_exit_code) ?? number(metadata.goal_check_exit_code) ?? 0) !== 0,
    run_evaluation: (number(failure.run_evaluation_exit_code) ?? number(metadata.run_evaluation_exit_code) ?? 0) !== 0 || evaluatorFailed,
  };
}
