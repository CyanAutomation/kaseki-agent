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
  'agent setup',
  'TypeScript pre-check',
  'pi coding agent',
  'collect agent diff',
  'quality checks',
  'validation',
  'secret scan',
  'complete',
] as const;

export function deriveOrchestratorStages(job: Job, config: KasekiApiConfig): string[] {
  const request = job.request ?? ({} as Job['request']);
  const taskMode = request.taskMode || config.defaultTaskMode;
  const publishMode = request.publishMode || 'pr';
  const startupCheck = request.startupCheck === true;
  const dryRun = startupCheck;
  const githubAppEnabled = publishMode !== 'none';
  const preAgentValidation = taskMode === 'inspect' ? false : true;
  const goalSettingEnabled = taskMode === 'inspect' ? request.goalSetting?.enabled === true : request.goalSetting?.enabled ?? true;
  const scoutingEnabled = taskMode === 'inspect' ? false : true;
  const goalCheckEnabled = taskMode === 'inspect'
    ? request.goalCheck?.enabled === true
    : request.goalCheck?.enabled ?? scoutingEnabled;
  const defaultRunEvaluation = (publishMode === 'pr' || publishMode === 'draft_pr') && taskMode !== 'inspect' && !startupCheck;
  const runEvaluationEnabled = taskMode === 'inspect'
    ? request.runEvaluation?.enabled === true
    : request.runEvaluation?.enabled ?? defaultRunEvaluation;
  const autoLintCleanup = request.autoLintCleanup ?? request.validation?.autoLintCleanup;
  const autoLintCleanupEnabled = taskMode === 'inspect' && autoLintCleanup?.enabled === undefined
    ? false
    : autoLintCleanup?.enabled ?? true;

  const stages: string[] = [];
  stages.push('clone repository');
  stages.push('prepare node dependencies');
  if (preAgentValidation) {
    if ((request.validationCommands ?? request.validation?.commands)?.length) {
      stages.push('baseline validation');
    }
    stages.push('pre-agent validation');
  }
  stages.push('TypeScript pre-check');
  if (goalSettingEnabled) {
    stages.push('pi goal-setting agent');
  }
  if (scoutingEnabled) {
    stages.push('scouting prerequisites check');
    stages.push('pi scouting agent', 'derive allowlist from scouting');
  }
  if (goalCheckEnabled) {
    stages.push('goal check');
  }
  if (runEvaluationEnabled) {
    stages.push('run evaluation');
  }
  stages.push('agent setup', 'pi coding agent');
  if (autoLintCleanupEnabled && !dryRun) {
    stages.push('auto lint cleanup');
  }
  stages.push('collect agent diff', 'quality checks', 'validation', 'secret scan');
  if (!dryRun && githubAppEnabled) {
    stages.push('github operations');
  }
  stages.push('complete');

  return stages.length > 0 ? stages : [...BASE_ORCHESTRATOR_STAGES];
}
