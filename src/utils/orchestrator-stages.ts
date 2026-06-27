/**
 * Orchestrator Stages Derivation
 *
 * Derives the sequence of orchestrator stages for a kaseki job
 * based on configuration, task mode, and feature flags.
 */

import { Job } from '../kaseki-api-types';
import { KasekiApiConfig } from '../kaseki-api-config';

const BASE_ORCHESTRATOR_STAGES = [
  'clone repository',
  'prepare node dependencies',
  'typescript precheck',
  'pi coding agent',
  'collect agent diff',
  'quality checks',
  'validation',
  'secret scan',
  'complete',
] as const;

/**
 * Derived feature flags for orchestrator stage sequencing.
 * Encapsulates logic for determining which stages to include.
 */
interface OrchestratorFeatureFlags {
  preAgentValidation: boolean;
  goalSettingEnabled: boolean;
  scoutingEnabled: boolean;
  goalCheckEnabled: boolean;
  runEvaluationEnabled: boolean;
  autoLintCleanupEnabled: boolean;
  dryRun: boolean;
  githubAppEnabled: boolean;
}

/**
 * Derive feature flags based on job request and config.
 * Encapsulates complex ternary logic for condition derivation.
 */

/**
 * Determines if goal setting should be enabled based on task mode and request.
 */
function deriveGoalSettingEnabled(taskMode: string, request: Job['request']): boolean {
  const isInspectMode = taskMode === 'inspect';
  return isInspectMode
    ? request?.goalSetting?.enabled === true
    : request?.goalSetting?.enabled ?? true;
}

/**
 * Determines if goal check should be enabled based on task mode and request.
 */
function deriveGoalCheckEnabled(taskMode: string, request: Job['request']): boolean {
  const isInspectMode = taskMode === 'inspect';
  const isNotInspectMode = taskMode !== 'inspect';
  return isInspectMode
    ? request?.goalCheck?.enabled === true
    : request?.goalCheck?.enabled ?? isNotInspectMode;
}

/**
 * Determines if run evaluation should be enabled based on task mode, publish mode, and request.
 */
function deriveRunEvaluationEnabled(
  taskMode: string,
  publishMode: string,
  startupCheck: boolean,
  request: Job['request']
): boolean {
  const isInspectMode = taskMode === 'inspect';
  const isNotInspectMode = taskMode !== 'inspect';
  return isInspectMode
    ? request?.runEvaluation?.enabled === true
    : request?.runEvaluation?.enabled ?? ((publishMode === 'pr' || publishMode === 'draft_pr') && isNotInspectMode && !startupCheck);
}

/**
 * Determines if auto lint cleanup should be enabled based on task mode and request.
 */
function deriveAutoLintCleanupEnabled(taskMode: string, request: Job['request']): boolean {
  const isInspectMode = taskMode === 'inspect';
  const autoLintCleanupConfig = request?.autoLintCleanup ?? request?.validation?.autoLintCleanup;

  // For inspect mode: only enable if explicitly set to true
  if (isInspectMode) {
    return autoLintCleanupConfig?.enabled === true;
  }

  // For fix mode: use explicit value if set, otherwise default to true
  return autoLintCleanupConfig?.enabled ?? true;
}

export function deriveFeatureFlags(job: Job, config: KasekiApiConfig): OrchestratorFeatureFlags {
  const request = job.request ?? ({} as Job['request']);
  const taskMode: 'patch' | 'inspect' = (request.taskMode ?? config.defaultTaskMode) as 'patch' | 'inspect';
  const publishMode = request.publishMode || 'pr';
  const startupCheck = request.startupCheck === true;

  // Pre-compute comparisons to avoid TypeScript type narrowing issues
  const isNotInspectMode = taskMode !== 'inspect';

  return {
    dryRun: startupCheck,
    githubAppEnabled: publishMode !== 'none',
    preAgentValidation: isNotInspectMode,
    goalSettingEnabled: deriveGoalSettingEnabled(taskMode, request),
    scoutingEnabled: isNotInspectMode,
    goalCheckEnabled: deriveGoalCheckEnabled(taskMode, request),
    runEvaluationEnabled: deriveRunEvaluationEnabled(taskMode, publishMode, startupCheck, request),
    autoLintCleanupEnabled: deriveAutoLintCleanupEnabled(taskMode, request),
  };
}

export function deriveOrchestratorStages(job: Job, config: KasekiApiConfig): string[] {
  const flags = deriveFeatureFlags(job, config);

  const stages: string[] = [];
  stages.push('clone repository');
  stages.push('prepare node dependencies');
  if (flags.preAgentValidation) {
    const request = job.request ?? ({} as Job['request']);
    if ((request.validationCommands ?? request.validation?.commands)?.length) {
      stages.push('baseline validation');
    }
    stages.push('pre-agent validation');
  }
  stages.push('typescript precheck');
  if (flags.goalSettingEnabled) {
    stages.push('pi goal-setting agent');
  }
  if (flags.scoutingEnabled) {
    stages.push('scouting prerequisites validation');
    stages.push('pi scouting agent', 'derive allowlist from scouting');
  }
  if (flags.goalCheckEnabled) {
    stages.push('goal check');
  }
  if (flags.runEvaluationEnabled) {
    stages.push('run evaluation');
  }
  stages.push('pi coding agent');
  if (flags.autoLintCleanupEnabled && !flags.dryRun) {
    stages.push('auto lint cleanup');
  }
  stages.push('collect agent diff', 'quality checks', 'validation', 'secret scan');
  if (!flags.dryRun && flags.githubAppEnabled) {
    stages.push('github operations');
  }
  stages.push('complete');

  return stages.length > 0 ? stages : [...BASE_ORCHESTRATOR_STAGES];
}
