#!/usr/bin/env bash

reject_retired_decision_settings() {
  local retired_setting
  local retired_settings=(
    KASEKI_JEV_WORKFLOW
    KASEKI_JEV_CONFIDENCE
    KASEKI_JEV_GOAL_CHECK_TIMEOUT_MS
    KASEKI_JEV_RUN_EVALUATION_TIMEOUT_MS
    KASEKI_JEV_WORKFLOW_EVALUATOR
    KASEKI_DECISION_API_KEY_FILE
    KASEKI_DECISION_MODEL
    KASEKI_CLASSIFICATION_MODEL
    KASEKI_JEV_API_KEY_FILE
    KASEKI_JEV_TASK_TYPE
    KASEKI_JEV_VALIDATION_FOCUS
  )

  for retired_setting in "${retired_settings[@]}"; do
    if [ "${!retired_setting+x}" = x ]; then
      printf 'ERROR: Retired evaluation settings are configured. Remove them and use the stage-based settings documented in docs/ENV_VARS.md.\n' >&2
      return 2
    fi
  done
}
