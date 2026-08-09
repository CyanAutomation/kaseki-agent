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
  env.KASEKI_SCOUTING = request.scouting?.enabled === false ? '0' : '1';
  if (request.scouting?.model) env.KASEKI_SCOUTING_MODEL = request.scouting.model;
  if (request.scouting?.timeoutSeconds) {
    env.KASEKI_SCOUTING_TIMEOUT_SECONDS = String(request.scouting.timeoutSeconds);
  }

  if (request.goalSetting?.enabled !== undefined) {
    env.KASEKI_GOAL_SETTING = request.goalSetting.enabled ? '1' : '0';
  }
  if (request.goalSetting?.model) env.KASEKI_GOAL_SETTING_MODEL = request.goalSetting.model;
  if (request.goalSetting?.timeoutSeconds) {
    env.KASEKI_GOAL_SETTING_TIMEOUT_SECONDS = String(request.goalSetting.timeoutSeconds);
  }

  if (request.goalCheck?.enabled !== undefined) {
    env.KASEKI_GOAL_CHECK = request.goalCheck.enabled ? '1' : '0';
  }
  if (request.goalCheck?.maxRetries !== undefined) {
    env.KASEKI_GOAL_CHECK_MAX_RETRIES = String(request.goalCheck.maxRetries);
  }
  if (request.goalCheck?.model) env.KASEKI_GOAL_CHECK_MODEL = request.goalCheck.model;
  if (request.goalCheck?.timeoutSeconds) {
    env.KASEKI_GOAL_CHECK_TIMEOUT_SECONDS = String(request.goalCheck.timeoutSeconds);
  }

  const taskMode = request.taskMode || config.defaultTaskMode;
  const publishMode = request.publishMode || 'pr';
  const defaultRunEvaluation =
    (publishMode === 'pr' || publishMode === 'draft_pr') &&
    taskMode !== 'inspect' &&
    !request.startupCheck;
  env.KASEKI_RUN_EVALUATION =
    (request.runEvaluation?.enabled ?? defaultRunEvaluation) ? '1' : '0';
  if (request.runEvaluation?.model) env.KASEKI_RUN_EVALUATION_MODEL = request.runEvaluation.model;
  if (request.runEvaluation?.timeoutSeconds) {
    env.KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS = String(request.runEvaluation.timeoutSeconds);
  }
}
