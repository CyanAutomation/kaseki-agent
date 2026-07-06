#!/usr/bin/env bash
# Sourceable helpers for task-mode default decisions shared by the entrypoint
# and focused shell tests. These helpers intentionally mutate the KASEKI_*
# variables passed through the environment, matching kaseki-agent.sh startup
# behavior while keeping the inspect-mode policy testable without executing the
# full entrypoint.

kaseki_apply_inspect_mode_agent_defaults() {
  KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"

  if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
    [ -z "${KASEKI_GOAL_SETTING_EXPLICIT:-}" ] && KASEKI_GOAL_SETTING="0"
    [ -z "${KASEKI_SCOUTING_EXPLICIT:-}" ] && KASEKI_SCOUTING="0"
    [ -z "${KASEKI_GOAL_CHECK_EXPLICIT:-}" ] && KASEKI_GOAL_CHECK="0"
  fi
}

kaseki_apply_task_mode_diff_defaults() {
  KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"

  if [ "$KASEKI_TASK_MODE" = "inspect" ]; then
    KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-1}"
  else
    KASEKI_ALLOW_EMPTY_DIFF="${KASEKI_ALLOW_EMPTY_DIFF:-0}"
  fi
}

kaseki_write_task_mode_critical_change_expectations() {
  local output_file="${1:?missing critical-change expectations output path}"
  KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"

  if [ "$KASEKI_TASK_MODE" != "inspect" ]; then
    return 1
  fi

  printf '%s\n' '{"version":1,"source_artifacts":{"goal_setting":null,"scouting":null},"required_files":[],"required_search_strings":[],"forbidden_empty_diff":false}' > "$output_file"
}

kaseki_should_skip_critical_change_gates() {
  KASEKI_TASK_MODE="${KASEKI_TASK_MODE:-patch}"
  [ "$KASEKI_TASK_MODE" = "inspect" ]
}
