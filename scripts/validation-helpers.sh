#!/usr/bin/env bash
# Shell library for validation command helpers shared by runtime tests.
# This file intentionally exposes only validation-related helpers and has no
# top-level side effects beyond function definitions.

npm_run_script_name() {
  local command="$1"
  local npm_run_regex='^npm[[:space:]]+run[[:space:]]+([^[:space:]-][^[:space:]-]*)($|[[:space:]])'
  if [[ "$command" =~ $npm_run_regex ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

package_json_has_npm_script() {
  local script_name="$1"
  [ -f package.json ] || return 1
  node - "$script_name" <<'NODE'
const fs = require('fs');
const scriptName = process.argv[2];
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  process.exit(Object.prototype.hasOwnProperty.call(scripts, scriptName) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

missing_npm_script_for_validation_command() {
  local command="$1"
  local script_name
  script_name="$(npm_run_script_name "$command")" || return 1
  package_json_has_npm_script "$script_name" && return 1
  printf '%s' "$script_name"
  return 0
}

append_default_validation_command() {
  local current="$1"
  local next_command="$2"
  if [ -z "$current" ]; then
    printf '%s' "$next_command"
  else
    printf '%s;%s' "$current" "$next_command"
  fi
}

ensure_build_before_test_validation() {
  local commands="$1" command trimmed normalized="" has_build=0 has_test=0
  package_json_has_npm_script "build" || { printf '%s' "$commands"; return 0; }
  local -a command_array
  IFS=';' read -r -a command_array <<< "$commands"
  for command in "${command_array[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    [[ "$trimmed" == npm\ run\ build* ]] && has_build=1
    [[ "$trimmed" == npm\ run\ test* ]] && has_test=1
    normalized="$(append_default_validation_command "$normalized" "$trimmed")"
  done
  if [ "$has_test" -eq 1 ] && [ "$has_build" -eq 0 ]; then
    normalized="$(append_default_validation_command "npm run build" "$normalized")"
  fi
  printf '%s' "$normalized"
}

has_typescript_project() {
  [ -f tsconfig.json ] && return 0
  [ -f package.json ] || return 1
  node - <<'NODE'
try {
  const pkg = require('./package.json');
  const isDep = pkg.dependencies?.typescript ||
    pkg.devDependencies?.typescript ||
    pkg.optionalDependencies?.typescript;
  process.exit(isDep ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

construct_default_validation_commands() {
  local commands=""

  if package_json_has_npm_script "build"; then
    commands="$(append_default_validation_command "$commands" "npm run build")"
  elif package_json_has_npm_script "type-check"; then
    commands="$(append_default_validation_command "$commands" "npm run type-check")"
  elif has_typescript_project; then
    commands="$(append_default_validation_command "$commands" "tsc --noEmit")"
  elif package_json_has_npm_script "check"; then
    commands="$(append_default_validation_command "$commands" "npm run check")"
  fi

  if package_json_has_npm_script "test"; then
    commands="$(append_default_validation_command "$commands" "npm run test")"
  fi

  if [ -n "$commands" ]; then
    printf '%s' "$commands"
    return 0
  fi

  printf '%s' "npm run build;npm run type-check;npm run test"
}

apply_default_validation_commands() {
  local detected_commands

  if [ -z "${KASEKI_VALIDATION_COMMANDS_EXPLICIT:-}" ]; then
    detected_commands="$(construct_default_validation_commands)"
    KASEKI_VALIDATION_COMMANDS="$detected_commands"
  fi
  if [ -z "${KASEKI_PRE_AGENT_VALIDATION_COMMANDS_EXPLICIT:-}" ]; then
    KASEKI_PRE_AGENT_VALIDATION_COMMANDS="${detected_commands:-$KASEKI_VALIDATION_COMMANDS}"
  fi
  KASEKI_VALIDATION_COMMANDS="$(ensure_build_before_test_validation "$KASEKI_VALIDATION_COMMANDS")"
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="$(ensure_build_before_test_validation "$KASEKI_PRE_AGENT_VALIDATION_COMMANDS")"
  export KASEKI_VALIDATION_COMMANDS KASEKI_PRE_AGENT_VALIDATION_COMMANDS
}

append_validation_result() {
  local output_file="$1"
  local command="$2"
  local exit_code="$3"
  local duration_seconds="$4"
  local status="${5:-unknown}"
  local temp_validation_file="${KASEKI_RESULTS_DIR}/.validation-results-temp.jsonl"

  mkdir -p "$(dirname "$temp_validation_file")"
  printf '{"command": %s, "exit_code": %d, "duration_seconds": %d, "status": %s}\n' \
    "$(printf '%s' "$command" | jq -Rs .)" \
    "$exit_code" \
    "$duration_seconds" \
    "$(printf '%s' "$status" | jq -Rs .)" >> "$temp_validation_file"
  : "${output_file:?}"
}

record_skipped_validation_command() {
  local command="$1"
  local missing_script="$2"
  local duration="$3"
  local log_file="${4:-${KASEKI_RESULTS_DIR}/validation.log}"
  local timings_file="${5:-$VALIDATION_TIMINGS_FILE}"

  printf 'Skipping validation command "%s" because package.json does not define script "%s".\n' "$command" "$missing_script" | tee -a "$log_file"
  printf '%s\t127\t%s\tskipped=missing_npm_script\tscript=%s\n' "$command" "$duration" "$missing_script" >> "$timings_file"
  append_validation_result "${KASEKI_RESULTS_DIR}"/validation-results.json "$command" "127" "$duration" "skipped"
}

write_validation_command_environment() {
  local stage_label="$1"
  local command="$2"
  local env_log="$3"

  {
    printf '[validation command] stage=%s\n' "$stage_label"
    printf '[validation command] command=%s\n' "$command"
    printf '[validation command] working_directory=%s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
    printf '[validation command] node_version=%s\n' "$(node --version 2>&1 || echo '<node not found>')"
    printf '[validation command] npm_version=%s\n' "$(npm --version 2>&1 || echo '<npm not found>')"
    printf '[validation command] disk_available=%s\n' "$(df -h "$KASEKI_RESULTS_DIR" 2>/dev/null | tail -1 | awk '{print $4}' || echo '<df failed>')"
  } | tee -a "$env_log"
}

start_validation_heartbeat() {
  local stage_label="$1"
  local command="$2"
  local interval_seconds="${KASEKI_VALIDATION_HEARTBEAT_SECONDS:-30}"

  if ! [[ "$interval_seconds" =~ ^[0-9]+$ ]] || [ "$interval_seconds" -lt 5 ]; then
    interval_seconds=30
  fi

  (
    while sleep "$interval_seconds"; do
      emit_progress "$stage_label" "running validation command: $command"
    done
  ) >/dev/null 2>&1 &
  printf '%s' "$!"
}

stop_validation_heartbeat() {
  local heartbeat_pid="${1:-}"
  [ -n "$heartbeat_pid" ] || return 0
  kill "$heartbeat_pid" 2>/dev/null || true
  wait "$heartbeat_pid" 2>/dev/null || true
}

append_validation_failure_tail() {
  local raw_log="$1"
  local visible_log="$2"
  local quality_log="${3:-${KASEKI_RESULTS_DIR}/quality.log}"

  if ! [ -s "$raw_log" ]; then
    return 0
  fi

  {
    printf '\n[DIAGNOSTICS] Raw validation output tail (last 80 lines):\n'
    tail -80 "$raw_log" 2>/dev/null || printf '<failed to read raw validation log>\n'
  } | tee -a "$visible_log" "$quality_log" >/dev/null
}

append_validation_directory_diagnostics() {
  local validation_log="$1"
  local quality_log="${2:-${KASEKI_RESULTS_DIR}/quality.log}"

  {
    printf '\n[DIAGNOSTICS] Validation command failed with directory access error:\n'
    printf 'Working directory status:\n'
    printf '  Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')"
    printf '  %s/repo exists: %s\n' "$KASEKI_WORKSPACE_DIR" "$([ -d "${KASEKI_WORKSPACE_DIR}/repo" ] && echo 'yes' || echo 'no')"
    if [ -L "${KASEKI_WORKSPACE_DIR}"/repo/node_modules ]; then
      printf '  node_modules is symlink → %s\n' "$(readlink "${KASEKI_WORKSPACE_DIR}"/repo/node_modules 2>&1 || echo '<readlink failed>')"
    fi
    printf 'Last 20 lines of validation log:\n'
    tail -20 "$validation_log"
  } | tee -a "$quality_log"
}

run_validation_commands() {
  # shellcheck disable=SC2034 # Reference variables are assigned for external use via namerefs
  local stage_label="$1"
  local commands="$2"
  local log_file="$3"
  local raw_log="$4"
  local timings_file="$5"
  local env_log="$6"
  local failure_reason_prefix="${7:-validation_command_failed}"
  local exit_var="${8:-VALIDATION_EXIT}"
  local detail_var="${9:-VALIDATION_FAILED_COMMAND_DETAIL}"
  local reason_var="${10:-VALIDATION_FAILURE_REASON}"
  local stopped_var="${11:-VALIDATION_STOPPED_EARLY}"
  local attempted_var="${12:-VALIDATION_COMMANDS_ATTEMPTED}"
  local workspace_dir="${13:-${KASEKI_WORKSPACE_DIR:-/workspace}}"
  local results_dir="${14:-${KASEKI_RESULTS_DIR:-/results}}"
  local -n validation_exit_ref="$exit_var"
  validation_exit_ref=0
  local -n validation_detail_ref="$detail_var"
  local -n validation_reason_ref="$reason_var"
  local -n validation_stopped_ref="$stopped_var"
  local -n validation_attempted_ref="$attempted_var"
  local stage_start validation_start validation_end duration command trimmed missing_npm_script
  local command_exit tee_exit filter_exit pipe_statuses execute_during_dry_run pipefail_was_enabled validation_infra_failure cmd_status heartbeat_pid
  local -a validation_commands

  KASEKI_WORKSPACE_DIR="$workspace_dir"
  KASEKI_RESULTS_DIR="$results_dir"
  export KASEKI_WORKSPACE_DIR KASEKI_RESULTS_DIR
  mkdir -p "$KASEKI_RESULTS_DIR"
  : > "${KASEKI_RESULTS_DIR}/quality.log"

  execute_during_dry_run=false
  if [ "${KASEKI_BASELINE_VALIDATION_DRY_RUN:-0}" = "1" ] && [ "$stage_label" = "pre-agent validation" ]; then
    execute_during_dry_run=true
  fi

  printf '\n==> %s\n' "$stage_label"
  set_current_stage "$stage_label"
  emit_progress "$stage_label" "started"
  stage_start="$(date +%s)"

  if [ "${KASEKI_DRY_RUN:-0}" = "1" ] && [ "$execute_during_dry_run" != "true" ]; then
    printf '🔄 DRY-RUN MODE: Validation commands would be executed (not running in dry-run mode):\n' | tee -a "$log_file"
    IFS=';' read -r -a validation_commands <<< "$commands"
    for command in "${validation_commands[@]}"; do
      trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
      [ -z "$trimmed" ] && continue
      printf '  - %s\n' "$trimmed" | tee -a "$log_file"
    done
    validation_exit_ref=0
    record_stage_timing "$stage_label" "0" "$(($(date +%s) - stage_start))" "dry_run=true"
  elif [ -z "$commands" ] || [ "$commands" = "none" ]; then
    printf 'Validation skipped because commands=%s.\n' "${commands:-<empty>}" | tee -a "$log_file"
    record_stage_timing "$stage_label" 0 0 "skipped_by_config"
  elif ! [ -d "${KASEKI_WORKSPACE_DIR}/repo" ]; then
    printf 'ERROR: Working directory %s/repo does not exist before %s\n' "$KASEKI_WORKSPACE_DIR" "$stage_label" | tee -a "$log_file"
    printf 'Current pwd: %s\n' "$(pwd 2>&1 || echo '<pwd failed>')" | tee -a "$log_file"
    printf 'Filesystem state:\n' | tee -a "$log_file"
    find "$KASEKI_WORKSPACE_DIR" -maxdepth 3 -type f 2>&1 | head -100 | tee -a "$log_file"
    validation_exit_ref=1
    validation_detail_ref="Working directory ${KASEKI_WORKSPACE_DIR}/repo missing before $stage_label"
    validation_reason_ref="$failure_reason_prefix: workspace_missing"
    record_stage_timing "$stage_label" "$validation_exit_ref" "$(($(date +%s) - stage_start))" "directory_missing"
  else
    set +e
    IFS=';' read -r -a validation_commands <<< "$commands"
    for command in "${validation_commands[@]}"; do
      trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
      [ -z "$trimmed" ] && continue
      validation_start="$(date +%s)"
      if missing_npm_script="$(missing_npm_script_for_validation_command "$trimmed")"; then
        validation_end="$(date +%s)"
        duration=$((validation_end - validation_start))
        record_skipped_validation_command "$trimmed" "$missing_npm_script" "$duration" "$log_file" "$timings_file"
        emit_event "validation_command_skipped" "stage=$stage_label" "command=$trimmed" "reason=missing_npm_script" "script=$missing_npm_script" "duration_seconds=$duration"
        continue
      fi
      ((validation_attempted_ref++))
      emit_event "validation_command_started" "stage=$stage_label" "command=$trimmed"
      write_validation_command_environment "$stage_label" "$trimmed" "$env_log"
      heartbeat_pid="$(start_validation_heartbeat "$stage_label" "$trimmed")"
      pipefail_was_enabled=0
      if set -o | grep -q '^pipefail[[:space:]]*on'; then
        pipefail_was_enabled=1
      fi
      set -o pipefail
      {
        printf '\n==> %s\n' "$trimmed"
        unset LLM_GATEWAY_API_KEY
        bash -c "$trimmed"
        command_exit=$?
        printf 'exit_code=%s\n' "$command_exit"
        exit "$command_exit"
      } 2>&1 |
        tee --output-error=warn-nopipe \
          >(cat >> "$log_file") \
          >(cat >> "$raw_log") \
          2> >(sed 's/^/[validation-tee] /' >> "$FILTER_STDERR_FILE") |
        FILTER_DIAGNOSTICS_LOG="$FILTER_DIAGNOSTICS_LOG" validation-output-filter 2>>"$FILTER_STDERR_FILE"
      pipe_statuses=("${PIPESTATUS[@]}")
      stop_validation_heartbeat "$heartbeat_pid"
      heartbeat_pid=""
      if [ "$pipefail_was_enabled" -eq 1 ]; then set -o pipefail; else set +o pipefail; fi
      command_exit="${pipe_statuses[0]:-1}"
      tee_exit="${pipe_statuses[1]:-1}"
      filter_exit="${pipe_statuses[2]:-1}"
      validation_end="$(date +%s)"
      duration=$((validation_end - validation_start))
      printf '%s\t%s\t%s\ttee_exit=%s\tfilter_exit=%s\n' "$trimmed" "$command_exit" "$duration" "$tee_exit" "$filter_exit" >> "$timings_file"
      emit_event "validation_command_finished" "stage=$stage_label" "command=$trimmed" "exit_code=$command_exit" "tee_exit_code=$tee_exit" "filter_exit_code=$filter_exit" "duration_seconds=$duration"
      cmd_status="passed"; [ "$command_exit" -ne 0 ] && cmd_status="failed"
      append_validation_result "${KASEKI_RESULTS_DIR}"/validation-results.json "$trimmed" "$command_exit" "$duration" "$cmd_status"
      {
        printf '\n[validation pipeline] command=%s\n' "$trimmed"
        printf '[validation pipeline] statuses: command=%s tee=%s filter=%s\n' "$command_exit" "$tee_exit" "$filter_exit"
        printf '[validation pipeline] logs: visible=%s diagnostics=%s\n' "$log_file" "$FILTER_DIAGNOSTICS_LOG"
      } >> "$log_file"
      {
        printf '\n[validation pipeline] command=%s\n' "$trimmed"
        printf '[validation pipeline] statuses: command=%s tee=%s filter=%s\n' "$command_exit" "$tee_exit" "$filter_exit"
      } >> "$FILTER_DIAGNOSTICS_LOG"
      validation_infra_failure=false
      if [ "$command_exit" -eq 141 ] && { [ "$tee_exit" -ne 0 ] || [ "$filter_exit" -ne 0 ]; }; then
        validation_infra_failure=true
        {
          printf '\n[DIAGNOSTICS] Validation infrastructure failure: upstream command received SIGPIPE while output pipeline was unhealthy.\n'
          printf '  Command exit code: 141 (SIGPIPE)\n'
          printf '  Tee exit code: %s\n' "$tee_exit"
          printf '  Filter exit code: %s\n' "$filter_exit"
          printf '  Classification: validation_infrastructure_failure (not a normal validation command failure)\n'
          printf '  Full raw command output: %s\n' "$raw_log"
          printf '  Filter diagnostics: %s\n' "$FILTER_DIAGNOSTICS_LOG"
        } | tee -a "$log_file" "${KASEKI_RESULTS_DIR}"/quality.log "$FILTER_DIAGNOSTICS_LOG"
      fi
      if [ "$validation_infra_failure" = "true" ] && [ "$validation_exit_ref" -eq 0 ]; then
        validation_exit_ref=1
        validation_detail_ref="validation infrastructure failure while running \"$trimmed\": command SIGPIPE with tee exit $tee_exit and filter exit $filter_exit"
        validation_reason_ref="validation_infrastructure_failure: $trimmed (command exit $command_exit, tee exit $tee_exit, filter exit $filter_exit)"
        if [ "${KASEKI_VALIDATION_FAIL_FAST:-1}" -eq 1 ]; then
          validation_stopped_ref=true
          printf 'Validation stopped because the validation output pipeline failed (fail-fast mode enabled).\n' | tee -a "$log_file"
          break
        fi
      elif [ "$command_exit" -ne 0 ] && [ "$validation_exit_ref" -eq 0 ]; then
        validation_exit_ref="$command_exit"
        validation_detail_ref="first failing command was \"$trimmed\" with exit $command_exit"
        # shellcheck disable=SC2034
        validation_reason_ref="$failure_reason_prefix: $trimmed (exit $command_exit)"
        append_validation_failure_tail "$raw_log" "$log_file" "${KASEKI_RESULTS_DIR}/quality.log"
        if grep -q 'getcwd\|No such file or directory\|cannot access parent directories' "$log_file"; then
          append_validation_directory_diagnostics "$log_file"
        fi
        if [ "${KASEKI_VALIDATION_FAIL_FAST:-1}" -eq 1 ]; then
          # shellcheck disable=SC2034
          validation_stopped_ref=true
          printf 'Validation stopped at first failure (fail-fast mode enabled).\n' | tee -a "$log_file"
          break
        fi
      fi
    done
    if [ -n "$validation_detail_ref" ]; then
      printf 'Validation failed: %s\n' "$validation_detail_ref" | tee -a "$log_file"
    fi
    set +e
    record_stage_timing "$stage_label" "$validation_exit_ref" "$(($(date +%s) - stage_start))" ""
  fi
  if [[ ! "$validation_exit_ref" =~ ^[0-9]+$ ]]; then
    printf 'ERROR: Validation exit target %s contained non-integer value: %s\n' "$exit_var" "$validation_exit_ref" | tee -a "$log_file"
    validation_exit_ref=1
  fi
  emit_progress "$stage_label" "finished with exit $validation_exit_ref"
  return "$validation_exit_ref"
}
