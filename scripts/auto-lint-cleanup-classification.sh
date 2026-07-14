#!/usr/bin/env bash
# Sourceable auto-lint cleanup classification and execution helpers.
# Depends on the caller providing the surrounding kaseki-agent runtime helpers.


validation_command_security_rejection_reason() {
  local command="$1"
  if [ "${KASEKI_ALLOW_UNSAFE_VALIDATION_COMMANDS:-0}" = "1" ]; then
    return 1
  fi
  case "$command" in
    *$'\n'*|*$'\r'*) printf 'contains newline'; return 0 ;;
  esac
  if printf '%s' "$command" | grep -Eq '[;&|`$<>\\]'; then
    printf 'contains shell metacharacters'
    return 0
  fi
  if printf '%s' "$command" | grep -Eq '(^|[[:space:]])(sh|bash|zsh|fish|python|python3|perl|ruby|node)[[:space:]]+-[ce][[:space:]]'; then
    printf 'starts an interpreter command string'
    return 0
  fi
  if printf '%s' "$command" | grep -Eq '^(:|true|false|__[A-Za-z0-9_:-]+__)$'; then
    return 1
  fi
  if printf '%s' "$command" | grep -Eq '^(npm|pnpm|yarn)[[:space:]]+(run[[:space:]]+)?[A-Za-z0-9:_-]+([[:space:]][A-Za-z0-9@%_=+.,:/-]+)*$'; then
    return 1
  fi
  if printf '%s' "$command" | grep -Eq '^(npx[[:space:]]+)?(tsc|eslint|prettier|jest|vitest|pytest|go|cargo|mvn|gradle)([[:space:]][A-Za-z0-9@%_=+.,:/-]+)*$'; then
    return 1
  fi
  printf 'is not on the validation command allowlist'
  return 0
}

run_allowed_validation_command() {
  local command="$1"
  timeout --signal=TERM --kill-after=10s "${KASEKI_VALIDATION_TIMEOUT_SECONDS:-900}" bash -c "$command"
}

auto_lint_cleanup_command_security_rejection_reason() {
  local command="$1"
  if [ "${KASEKI_ALLOW_UNSAFE_VALIDATION_COMMANDS:-0}" = "1" ]; then
    return 1
  fi
  [ "$command" = "__kaseki_trailing_whitespace_cleanup__" ] && return 1
  validation_command_security_rejection_reason "$command"
}

record_skipped_npm_script_command() {
  local command="$1"
  local script_name="$2"
  local duration_seconds="$3"
  local log_file="${4:-${KASEKI_RESULTS_DIR}/validation.log}"
  local timings_file="${5:-$VALIDATION_TIMINGS_FILE}"
  local skip_label="${6:-skipped}"
  local classification="${7:-}"
  {
    printf '\n==> %s\n' "$command"
    printf '%s: package.json does not define npm script "%s"\n' "$skip_label" "$script_name"
    if [ -n "$classification" ]; then
      printf 'classification=%s\n' "$classification"
    fi
  } 2>&1 | tee -a "$log_file"
  if [ -n "$classification" ]; then
    printf '%s\tskipped\t%s\tmissing_npm_script=%s\tclassification=%s\n' "$command" "$duration_seconds" "$script_name" "$classification" >> "$timings_file"
  else
    printf '%s\tskipped\t%s\tmissing_npm_script=%s\n' "$command" "$duration_seconds" "$script_name" >> "$timings_file"
  fi
}

classify_auto_lint_cleanup_command_exit() {
  local command_exit="$1"
  local missing_script="${2:-}"
  if [ -n "$missing_script" ]; then
    printf 'missing_cleanup_command'
  elif [ "$command_exit" -eq 127 ]; then
    printf 'command_not_found'
  elif [ "$command_exit" -eq 0 ]; then
    printf 'passed'
  else
    printf 'lint_fix_error'
  fi
}

auto_lint_cleanup_enabled_for_mode() {
  [ "$KASEKI_AUTO_LINT_CLEANUP" = "1" ] || return 1
  [ "$KASEKI_DRY_RUN" != "1" ] || return 1
  if [ "$KASEKI_TASK_MODE" = "inspect" ] && [ -z "$KASEKI_AUTO_LINT_CLEANUP_EXPLICIT" ]; then
    return 1
  fi
  return 0
}

skip_auto_lint_cleanup_before_core_change_verified() {
  local reason="${1:-core_change_absent}"
  local detail="${2:-}"

  AUTO_LINT_CLEANUP_EXIT=0
  AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=0
  AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=0
  AUTO_LINT_CLEANUP_RESULT="skipped"
  AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_before_core_change_verified"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION=""

  if [ -n "$detail" ]; then
    printf 'Auto lint cleanup skipped_before_core_change_verified: reason=%s detail=%s\n' "$reason" "$detail" >> "$AUTO_LINT_CLEANUP_LOG"
  else
    printf 'Auto lint cleanup skipped_before_core_change_verified: reason=%s\n' "$reason" >> "$AUTO_LINT_CLEANUP_LOG"
  fi
  record_stage_timing "auto lint cleanup" 0 0 "skipped_before_core_change_verified reason=$reason"
  emit_event "auto_lint_cleanup_finished" \
    "exit_code=0" \
    "result=$AUTO_LINT_CLEANUP_RESULT" \
    "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION" \
    "reason=$reason" \
    "attempted_commands=0" \
    "skipped_commands=0"
  emit_progress "auto lint cleanup" "skipped_before_core_change_verified"
  return 0
}

run_auto_lint_cleanup_after_core_change_verified() {
  if [ "$KASEKI_TASK_MODE" = "patch" ] && [ ! -s "${KASEKI_RESULTS_DIR}/git.diff" ]; then
    skip_auto_lint_cleanup_before_core_change_verified "patch_diff_empty" "collect_git_artifacts produced no patch diff before cleanup"
    return $?
  fi

  run_auto_lint_cleanup
}

run_trailing_whitespace_cleanup_for_changed_tracked_text_files() {
  local helper_script app_root
  # Use KASEKI_APP_ROOT if set (container context), otherwise try to resolve from script location
  app_root="${KASEKI_APP_ROOT:-}"
  if [ -z "$app_root" ]; then
    # Fallback: try relative to script location (for host execution)
    app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ "$app_root" = "/usr/local/bin" ] || [ "$app_root" = "/usr/bin" ]; then
      # Script is in a bin directory; prefer /app/scripts if it exists
      app_root="/app"
    fi
  fi
  helper_script="$app_root/scripts/cleanup-trailing-whitespace.sh"
  
  if [ -r "$helper_script" ]; then
    # shellcheck source=scripts/cleanup-trailing-whitespace.sh
    . "$helper_script"
    cleanup_trailing_whitespace_for_changed_files
    return $?
  fi

  printf 'ERROR: trailing whitespace cleanup helper is missing: %s (KASEKI_APP_ROOT=%s)\n' "$helper_script" "${KASEKI_APP_ROOT:-<unset>}"
  return 1
}

collect_changed_file_set() {
  local output_file="$1"
  : > "$output_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  {
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --name-only -- . 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --name-only --cached -- . 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo ls-files --others --exclude-standard 2>/dev/null || true
  } | sed '/^$/d' | LC_ALL=C sort -u > "$output_file"
}

collect_changed_file_state() {
  local output_file="$1"
  local changed_files_file path staged_hash unstaged_hash content_hash state
  : > "$output_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  changed_files_file="$(mktemp)"
  collect_changed_file_set "$changed_files_file"

  while IFS= read -r path || [ -n "$path" ]; do
    [ -z "$path" ] && continue
    if git -C "${KASEKI_WORKSPACE_DIR}"/repo ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
      staged_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --binary --cached -- "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
      unstaged_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo diff --binary -- "$path" 2>/dev/null | sha256sum | awk '{print $1}')"
      state="tracked:staged=${staged_hash}:unstaged=${unstaged_hash}"
    elif [ -f "${KASEKI_WORKSPACE_DIR}/repo/$path" ]; then
      content_hash="$(git -C "${KASEKI_WORKSPACE_DIR}"/repo hash-object --no-filters -- "$path" 2>/dev/null || sha256sum "${KASEKI_WORKSPACE_DIR}/repo/$path" 2>/dev/null | awk '{print $1}')"
      state="untracked:file=${content_hash}"
    elif [ -d "${KASEKI_WORKSPACE_DIR}/repo/$path" ]; then
      state="untracked:directory"
    else
      state="untracked:missing"
    fi
    printf '%s\t%s\n' "$path" "$state"
  done < "$changed_files_file" | LC_ALL=C sort -u > "$output_file"

  rm -f "$changed_files_file"
}

restore_cleanup_disallowed_changes() {
  local disallowed_file="$1"
  local changed_file
  [ -s "$disallowed_file" ] || return 0

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    printf 'Restoring cleanup-created file outside allowlist: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
    emit_event "auto_lint_cleanup_file_restored" "file=$changed_file" "reason=not_in_cleanup_allowlist"
    git -C "${KASEKI_WORKSPACE_DIR}"/repo restore --staged --worktree -- "$changed_file" 2>/dev/null || true
    git -C "${KASEKI_WORKSPACE_DIR}"/repo clean -f -- "$changed_file" 2>/dev/null || true
  done < "$disallowed_file"
}

check_auto_lint_cleanup_allowlist() {
  local before_file="$1"
  local after_file="$2"
  local cleanup_created_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-created-files.txt"
  local disallowed_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-disallowed-files.txt"
  local post_restore_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-post-restore-files.txt"
  local allowlist_patterns allowlist_regex changed_file disallowed_count unrestored_count

  : > "$cleanup_created_file"
  : > "$disallowed_file"
  : > "$post_restore_file"
  if [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  comm -13 "$before_file" "$after_file" > "$cleanup_created_file" || true
  [ -s "$cleanup_created_file" ] || return 0

  allowlist_patterns="$(merge_allowlists "${KASEKI_CHANGED_FILES_ALLOWLIST:-}" "${KASEKI_VALIDATION_ALLOWLIST:-}")"
  allowlist_regex="$(build_allowlist_regex "$allowlist_patterns")"

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if [ -n "$allowlist_regex" ] && printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      emit_event "quality_gate_rule_evaluated" "rule=auto_lint_cleanup_allowlist" "passed=true" "file=$changed_file"
    else
      printf 'Auto lint cleanup created changed file outside allowlist: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
      printf '%s\n' "$changed_file" >> "$disallowed_file"
      emit_event "quality_gate_rule_evaluated" "rule=auto_lint_cleanup_allowlist" "passed=false" "file=$changed_file"
      # Phase 2C: Emit quality violation to JSON
      append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "auto_lint_cleanup_file_outside_allowlist" "File $changed_file created by auto lint cleanup outside allowlist" "error"
    fi
  done < "$cleanup_created_file"

  disallowed_count="$(wc -l < "$disallowed_file" | tr -d ' ')"
  disallowed_count="${disallowed_count:-0}"
  [ "$disallowed_count" -gt 0 ] || return 0

  if [ "${KASEKI_RESTORE_DISALLOWED_CHANGES:-}" = "1" ]; then
    restore_cleanup_disallowed_changes "$disallowed_file"
    collect_changed_file_set "$post_restore_file"
    unrestored_count=0
    while IFS= read -r changed_file || [ -n "$changed_file" ]; do
      [ -z "$changed_file" ] && continue
      if grep -Fxq -- "$changed_file" "$post_restore_file"; then
        printf 'ERROR: Cleanup-created disallowed change could not be restored: %s\n' "$changed_file" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
        unrestored_count=$((unrestored_count + 1))
        # Phase 2C: Emit quality violation to JSON
        append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "cleanup_restoration_failure" "File $changed_file from auto lint cleanup could not be restored" "error"
      fi
    done < "$disallowed_file"
    if [ "$unrestored_count" -eq 0 ]; then
      printf 'Auto lint cleanup restored %s cleanup-created file(s) outside allowlist.\n' "$disallowed_count" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
      emit_event "auto_lint_cleanup_allowlist_restoration_complete" "restored=$disallowed_count" "unrestored=0"
      collect_git_artifacts
      return 0
    fi
  fi

  AUTO_LINT_CLEANUP_EXIT=7
  AUTO_LINT_CLEANUP_RESULT="failed"
  AUTO_LINT_CLEANUP_CLASSIFICATION="cleanup_allowlist_failed"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="cleanup_allowlist_failed"
  QUALITY_FAILURE_REASON="auto_lint_cleanup_allowlist: $disallowed_count cleanup-created file(s) outside KASEKI_CHANGED_FILES_ALLOWLIST/KASEKI_VALIDATION_ALLOWLIST"
  printf 'ERROR: %s\n' "$QUALITY_FAILURE_REASON" | tee -a "$AUTO_LINT_CLEANUP_LOG" "${KASEKI_RESULTS_DIR}"/quality.log
  emit_error_event "auto_lint_cleanup_allowlist_failed" "$QUALITY_FAILURE_REASON" "continue"
  return 1
}

run_auto_lint_cleanup() {
  local stage_label="auto lint cleanup"
  local stage_start cleanup_start cleanup_end duration command trimmed missing_npm_script
  local command_exit command_classification pipefail_was_enabled cleanup_before_file cleanup_after_file
  local -a cleanup_commands

  AUTO_LINT_CLEANUP_EXIT=0
  AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=0
  AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=0
  AUTO_LINT_CLEANUP_RESULT="passed"
  AUTO_LINT_CLEANUP_CLASSIFICATION="passed"
  AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION=""
  printf '\n==> %s\n' "$stage_label"
  set_current_stage "$stage_label"
  emit_progress "$stage_label" "started"
  emit_event "auto_lint_cleanup_started" "commands=${KASEKI_AUTO_LINT_CLEANUP_COMMANDS:-}"
  stage_start="$(date +%s)"

  if ! auto_lint_cleanup_enabled_for_mode; then
    if [ "$KASEKI_AUTO_LINT_CLEANUP" != "1" ]; then
      printf 'Auto lint cleanup skipped because KASEKI_AUTO_LINT_CLEANUP=%s.\n' "$KASEKI_AUTO_LINT_CLEANUP" | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_by_config"
      record_stage_timing "$stage_label" 0 0 "skipped_by_config"
    elif [ "$KASEKI_DRY_RUN" = "1" ]; then
      printf 'Auto lint cleanup skipped in dry-run mode.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="dry_run"
      record_stage_timing "$stage_label" 0 0 "dry_run=true"
    elif [ "$KASEKI_TASK_MODE" = "inspect" ]; then
      printf 'Auto lint cleanup skipped for inspect mode. Set KASEKI_AUTO_LINT_CLEANUP=1 explicitly to enable.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_inspect_mode"
      record_stage_timing "$stage_label" 0 0 "skipped_inspect_mode"
    else
      printf 'Auto lint cleanup skipped.\n' | tee -a "$AUTO_LINT_CLEANUP_LOG"
      AUTO_LINT_CLEANUP_RESULT="skipped"
      AUTO_LINT_CLEANUP_CLASSIFICATION="skipped"
      record_stage_timing "$stage_label" 0 0 "skipped"
    fi
    emit_event "auto_lint_cleanup_finished" "exit_code=0" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
    emit_progress "$stage_label" "skipped"
    return 0
  fi

  if [ -z "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS" ] || [ "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS" = "none" ]; then
    printf 'Auto lint cleanup skipped because commands=%s.\n' "${KASEKI_AUTO_LINT_CLEANUP_COMMANDS:-<empty>}" | tee -a "$AUTO_LINT_CLEANUP_LOG"
    AUTO_LINT_CLEANUP_RESULT="skipped"
    AUTO_LINT_CLEANUP_CLASSIFICATION="skipped_by_commands"
    record_stage_timing "$stage_label" 0 0 "skipped_by_commands"
    emit_event "auto_lint_cleanup_finished" "exit_code=0" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
    emit_progress "$stage_label" "skipped"
    return 0
  fi

  if ! [ -d "${KASEKI_WORKSPACE_DIR}"/repo ]; then
    AUTO_LINT_CLEANUP_EXIT=1
    AUTO_LINT_CLEANUP_RESULT="failed"
    AUTO_LINT_CLEANUP_CLASSIFICATION="directory_missing"
    AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="directory_missing"
    printf 'ERROR: Working directory %s/repo does not exist before auto lint cleanup.\n' "${KASEKI_WORKSPACE_DIR}" | tee -a "$AUTO_LINT_CLEANUP_LOG"
    printf 'workspace_missing\t%s\t0\tclassification=directory_missing\n' "$AUTO_LINT_CLEANUP_EXIT" >> "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
    record_stage_timing "$stage_label" "$AUTO_LINT_CLEANUP_EXIT" "$(($(date +%s) - stage_start))" "directory_missing classification=directory_missing"
    emit_event "auto_lint_cleanup_finished" "exit_code=$AUTO_LINT_CLEANUP_EXIT" "result=failed" "classification=directory_missing" "reason=directory_missing"
    emit_progress "$stage_label" "finished with exit $AUTO_LINT_CLEANUP_EXIT"
    return 0
  fi

  cleanup_before_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-before-files.txt"
  cleanup_after_file="${KASEKI_RESULTS_DIR}/auto-lint-cleanup-after-files.txt"
  collect_changed_file_set "$cleanup_before_file"

  set +e
  IFS=';' read -r -a cleanup_commands <<< "$KASEKI_AUTO_LINT_CLEANUP_COMMANDS"
  for command in "${cleanup_commands[@]}"; do
    trimmed="$(printf '%s' "$command" | sed 's/^ *//; s/ *$//')"
    [ -z "$trimmed" ] && continue
    cleanup_start="$(date +%s)"
    if [ "${KASEKI_SKIP_MISSING_NPM_SCRIPTS:-1}" = "1" ] && missing_npm_script="$(missing_npm_script_for_validation_command "$trimmed")"; then
      cleanup_end="$(date +%s)"
      duration=$((cleanup_end - cleanup_start))
      command_classification="$(classify_auto_lint_cleanup_command_exit 0 "$missing_npm_script")"
      AUTO_LINT_CLEANUP_COMMANDS_SKIPPED=$((AUTO_LINT_CLEANUP_COMMANDS_SKIPPED + 1))
      if [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ]; then
        AUTO_LINT_CLEANUP_RESULT="warning"
        AUTO_LINT_CLEANUP_CLASSIFICATION="$command_classification"
      fi
      record_skipped_npm_script_command "$trimmed" "$missing_npm_script" "$duration" "$AUTO_LINT_CLEANUP_LOG" "$AUTO_LINT_CLEANUP_TIMINGS_FILE" "skipped cleanup" "$command_classification"
      emit_event "auto_lint_cleanup_command_skipped" "command=$trimmed" "reason=$command_classification" "script=$missing_npm_script" "classification=$command_classification" "duration_seconds=$duration"
      continue
    fi

    local cleanup_rejection_reason
    if cleanup_rejection_reason="$(auto_lint_cleanup_command_security_rejection_reason "$trimmed")"; then
      cleanup_end="$(date +%s)"
      duration=$((cleanup_end - cleanup_start))
      AUTO_LINT_CLEANUP_EXIT=64
      AUTO_LINT_CLEANUP_RESULT="failed"
      AUTO_LINT_CLEANUP_CLASSIFICATION="security_allowlist_rejected"
      AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="security_allowlist_rejected"
      printf 'Auto lint cleanup command rejected by security allowlist: %s (%s)\n' "$trimmed" "$cleanup_rejection_reason" | tee -a "$AUTO_LINT_CLEANUP_LOG"
      printf '%s\t%s\t%s\tclassification=security_allowlist_rejected reason=%s\n' "$trimmed" 64 "$duration" "$cleanup_rejection_reason" >> "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
      emit_event "auto_lint_cleanup_command_rejected" "command=$trimmed" "reason=$cleanup_rejection_reason" "classification=security_allowlist_rejected" "duration_seconds=$duration"
      break
    fi

    AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED=$((AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED + 1))
    emit_event "auto_lint_cleanup_command_started" "command=$trimmed"
    pipefail_was_enabled=0
    if set -o | grep -q '^pipefail[[:space:]]*on'; then
      pipefail_was_enabled=1
    fi
    set -o pipefail
    {
      printf '\n==> %s\n' "$trimmed"
      unset LLM_GATEWAY_API_KEY
      if [ "$trimmed" = "__kaseki_trailing_whitespace_cleanup__" ]; then
        run_trailing_whitespace_cleanup_for_changed_tracked_text_files
        command_exit=$?
      else
        run_allowed_validation_command "$trimmed"
        command_exit=$?
      fi
      printf 'exit_code=%s\n' "$command_exit"
      exit "$command_exit"
    } 2>&1 | tee -a "$AUTO_LINT_CLEANUP_LOG"
    command_exit="${PIPESTATUS[0]}"
    if [ "$pipefail_was_enabled" -eq 1 ]; then
      set -o pipefail
    else
      set +o pipefail
    fi
    cleanup_end="$(date +%s)"
    duration=$((cleanup_end - cleanup_start))
    command_classification="$(classify_auto_lint_cleanup_command_exit "$command_exit")"
    printf '%s\t%s\t%s\tclassification=%s\n' "$trimmed" "$command_exit" "$duration" "$command_classification" >> "$AUTO_LINT_CLEANUP_TIMINGS_FILE"
    if [ "$command_exit" -eq 127 ]; then
      printf 'classification=%s\n' "$command_classification" | tee -a "$AUTO_LINT_CLEANUP_LOG" >/dev/null
    fi
    emit_event "auto_lint_cleanup_command_finished" "command=$trimmed" "exit_code=$command_exit" "classification=$command_classification" "duration_seconds=$duration"
    if [ "$command_exit" -ne 0 ] && [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ]; then
      AUTO_LINT_CLEANUP_EXIT="$command_exit"
      AUTO_LINT_CLEANUP_RESULT="failed"
      AUTO_LINT_CLEANUP_CLASSIFICATION="$command_classification"
      # shellcheck disable=SC2034
      AUTO_LINT_CLEANUP_FAILURE_CLASSIFICATION="$command_classification"
      emit_error_event "auto_lint_cleanup_command_failed" "Auto lint cleanup command failed: $trimmed (exit $command_exit, classification=$command_classification)" "continue"
    fi
  done
  set +e

  collect_changed_file_set "$cleanup_after_file"
  check_auto_lint_cleanup_allowlist "$cleanup_before_file" "$cleanup_after_file" || true

  if [ "$AUTO_LINT_CLEANUP_EXIT" -eq 0 ] && [ "$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED" -eq 0 ]; then
    AUTO_LINT_CLEANUP_RESULT="passed"
    AUTO_LINT_CLEANUP_CLASSIFICATION="passed"
  fi

  record_stage_timing "$stage_label" "$AUTO_LINT_CLEANUP_EXIT" "$(($(date +%s) - stage_start))" "attempted_commands=$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED skipped_commands=$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED classification=$AUTO_LINT_CLEANUP_CLASSIFICATION"
  emit_event "auto_lint_cleanup_finished" "exit_code=$AUTO_LINT_CLEANUP_EXIT" "result=$AUTO_LINT_CLEANUP_RESULT" "classification=$AUTO_LINT_CLEANUP_CLASSIFICATION" "attempted_commands=$AUTO_LINT_CLEANUP_COMMANDS_ATTEMPTED" "skipped_commands=$AUTO_LINT_CLEANUP_COMMANDS_SKIPPED"
  emit_progress "$stage_label" "finished with exit $AUTO_LINT_CLEANUP_EXIT"
  return 0
}
