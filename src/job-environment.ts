import type { RunRequest } from './kaseki-api-types';
import type { KasekiApiConfig } from './kaseki-api-config';

/**
 * Applies scouting, goal-check, and evaluation settings to a worker
 * environment. Kept outside JobScheduler so the policy matrix is pure and
 * independently testable.
 */
export function configureScoutingAndGoalCheckEnv(
  env: NodeJS.ProcessEnv,
  request: RunRequest,
  config: KasekiApiConfig,
): void {
  applyScoutingEnv(env, request);
  applyGoalSettingEnv(env, request);
  applyGoalCheckEnv(env, request);
  applyEvaluationEnv(env, request, config);
}

function applyScoutingEnv(env: NodeJS.ProcessEnv, request: RunRequest): void {
  env.KASEKI_SCOUTING = request.scouting?.enabled === false ? '0' : '1';
  applyOptionalValue(env, 'KASEKI_SCOUTING_MODEL', request.scouting?.model);
  applyOptionalNumber(env, 'KASEKI_SCOUTING_TIMEOUT_SECONDS', request.scouting?.timeoutSeconds);
}

function applyGoalSettingEnv(env: NodeJS.ProcessEnv, request: RunRequest): void {
  applyOptionalBoolean(env, 'KASEKI_GOAL_SETTING', request.goalSetting?.enabled);
  applyOptionalValue(env, 'KASEKI_GOAL_SETTING_MODEL', request.goalSetting?.model);
  applyOptionalNumber(env, 'KASEKI_GOAL_SETTING_TIMEOUT_SECONDS', request.goalSetting?.timeoutSeconds);
}

function applyGoalCheckEnv(env: NodeJS.ProcessEnv, request: RunRequest): void {
  applyOptionalBoolean(env, 'KASEKI_GOAL_CHECK', request.goalCheck?.enabled);
  applyOptionalNumber(env, 'KASEKI_GOAL_CHECK_MAX_RETRIES', request.goalCheck?.maxRetries);
  applyOptionalValue(env, 'KASEKI_GOAL_CHECK_MODEL', request.goalCheck?.model);
  applyOptionalNumber(env, 'KASEKI_GOAL_CHECK_TIMEOUT_SECONDS', request.goalCheck?.timeoutSeconds);
}

function applyEvaluationEnv(
  env: NodeJS.ProcessEnv,
  request: RunRequest,
  config: KasekiApiConfig,
): void {

  const taskMode = request.taskMode || config.defaultTaskMode;
  const publishMode = request.publishMode || 'pr';
  const defaultRunEvaluation =
    (publishMode === 'pr' || publishMode === 'draft_pr') &&
    taskMode !== 'inspect' &&
    !request.startupCheck;
  env.KASEKI_RUN_EVALUATION =
    (request.runEvaluation?.enabled ?? defaultRunEvaluation) ? '1' : '0';
  applyOptionalValue(env, 'KASEKI_RUN_EVALUATION_MODEL', request.runEvaluation?.model);
  applyOptionalNumber(env, 'KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS', request.runEvaluation?.timeoutSeconds);
}

function applyOptionalValue(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  if (value) env[key] = value;
}

function applyOptionalNumber(env: NodeJS.ProcessEnv, key: string, value: number | undefined): void {
  if (value !== undefined) env[key] = String(value);
}

function applyOptionalBoolean(env: NodeJS.ProcessEnv, key: string, value: boolean | undefined): void {
  if (value !== undefined) env[key] = value ? '1' : '0';
}
