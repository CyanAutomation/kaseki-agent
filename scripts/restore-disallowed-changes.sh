#!/usr/bin/env bash

# Restore changed files that fall outside KASEKI_CHANGED_FILES_ALLOWLIST.
# Requires build_allowlist_regex plus the runner callbacks emit_event,
# append_quality_violation, and collect_git_artifacts to be available.

restore_disallowed_changes() {
  if [ "$KASEKI_RESTORE_DISALLOWED_CHANGES" != "1" ] || [ ! -d "${KASEKI_WORKSPACE_DIR}"/repo/.git ]; then
    return 0
  fi

  local allowlist_regex restored_any restored_count kept_count coverage
  allowlist_regex="$(build_allowlist_regex)"
  [ -z "$allowlist_regex" ] && return 0
  restored_any=0
  restored_count=0
  kept_count=0
  coverage=0

  # Initialize restoration tracking file
  : > "${KASEKI_RESULTS_DIR}"/restoration.jsonl

  while IFS= read -r changed_file || [ -n "$changed_file" ]; do
    [ -z "$changed_file" ] && continue
    if printf '%s\n' "$changed_file" | grep -Eq "^(${allowlist_regex})$"; then
      # File matched allowlist - keep it
      kept_count=$((kept_count + 1))
      {
        printf '{"timestamp":"%s","event":"file_evaluated","file":"%s","status":"kept","reason":"matched_allowlist"}\n' \
          "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
      } >> "${KASEKI_RESULTS_DIR}"/restoration.jsonl
      continue
    fi
    # File did not match allowlist - restore it
    restored_count=$((restored_count + 1))
    emit_event "quality_gate_rule_evaluated" "rule=allowlist_restore" "passed=true" "file=$changed_file"
    # Phase 2C: Emit quality event to JSON
    append_quality_violation "${KASEKI_RESULTS_DIR}"/quality-gates.json "file_outside_allowlist_restored" "File $changed_file was outside allowlist but was restored" "info"
    {
      printf '{"timestamp":"%s","event":"file_restored","file":"%s","status":"restored","reason":"not_in_allowlist"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(printf '%s' "$changed_file" | sed 's/"/\\"/g')"
    } >> "${KASEKI_RESULTS_DIR}"/restoration.jsonl
    if ! git -C "${KASEKI_WORKSPACE_DIR}"/repo restore --staged --worktree -- "$changed_file" 2>/dev/null; then
      git -C "${KASEKI_WORKSPACE_DIR}"/repo clean -f -- "$changed_file" 2>/dev/null
    fi
    restored_any=1
  done < "${KASEKI_RESULTS_DIR}"/changed-files.txt

  # Emit restoration summary to quality.log with actionable guidance
  if [ $((restored_count + kept_count)) -gt 0 ]; then
    coverage=$((kept_count * 100 / (restored_count + kept_count)))
  fi
  if [ "$restored_count" -gt 0 ] || [ "$kept_count" -gt 0 ]; then
    emit_event "allowlist_restoration_complete" "restored=$restored_count" "kept=$kept_count" "coverage=$coverage"
    printf '[allowlist summary] Restored: %s files; Kept: %s files (coverage: %s%%)\n' \
      "$restored_count" "$kept_count" "$coverage" >> "${KASEKI_RESULTS_DIR}"/quality.log
  fi

  if [ "$restored_any" -eq 1 ]; then
    collect_git_artifacts
  fi
}
