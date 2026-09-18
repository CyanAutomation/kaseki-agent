#!/usr/bin/env bash
# Diagnostic script to check which manifest entries fail in the startup-check-packaging test
# This script mirrors the test logic but provides detailed output for each check

set -u  # Exit on undefined vars, but NOT on errors so we can report all failures

PASS_COUNT=0
FAIL_COUNT=0

file_mode() {
  local path="$1"
  # GNU stat and BSD/macOS stat expose file modes through different flags.
  if stat -c "%a" "$path" 2>/dev/null; then
    return 0
  fi
  stat -f "%Lp" "$path" 2>/dev/null || return 1
}

check_file() {
  local path="$1"
  local expected_mode="$2"
  
  printf '✓ Checking: %s (mode %s)...\n' "$path" "$expected_mode"
  
  if [ ! -e "$path" ]; then
    printf '  ❌ FAIL: File does not exist: %s\n' "$path" >&2
    ((FAIL_COUNT++))
    return 1
  fi
  
  local actual_mode
  actual_mode="$(file_mode "$path")"
  
  if [ "$actual_mode" != "$expected_mode" ]; then
    printf '  ❌ FAIL: Mode mismatch for %s - expected %s, got %s\n' "$path" "$expected_mode" "$actual_mode" >&2
    ((FAIL_COUNT++))
    return 1
  fi
  
  printf '  ✅ PASS\n'
  ((PASS_COUNT++))
  return 0
}

check_symlink() {
  local path="$1"
  local expected_target="$2"
  
  printf '✓ Checking symlink: %s -> %s\n' "$path" "$expected_target"
  
  if [ ! -L "$path" ]; then
    printf '  ❌ FAIL: Not a symlink: %s\n' "$path" >&2
    ((FAIL_COUNT++))
    return 1
  fi
  
  local actual_target
  actual_target="$(readlink "$path")"
  
  if [ "$actual_target" != "$expected_target" ]; then
    printf '  ❌ FAIL: Symlink target mismatch for %s - expected %s, got %s\n' "$path" "$expected_target" "$actual_target" >&2
    ((FAIL_COUNT++))
    return 1
  fi
  
  # Also check the resolved target is executable
  if [ ! -x "$path" ]; then
    printf '  ❌ FAIL: Symlink target not executable: %s -> %s\n' "$path" "$actual_target" >&2
    ((FAIL_COUNT++))
    return 1
  fi
  
  printf '  ✅ PASS\n'
  ((PASS_COUNT++))
  return 0
}

printf '=== Manifest Validation Diagnostic ===\n\n'

# Check all manifest files
printf '### Files/Executables ###\n'
check_file "/usr/local/bin/kaseki-agent" "755"
check_file "/usr/local/bin/kaseki-entrypoint" "755"
check_file "/usr/local/bin/kaseki-pi-event-filter" "755"
check_file "/usr/local/bin/pi-event-filter-helpers.js" "755"
check_file "/usr/local/bin/instance-status-derivation.js" "755"
check_file "/usr/local/bin/instance-stage-derivation.js" "755"
check_file "/usr/local/bin/instance-failure-extraction.js" "755"
check_file "/usr/local/bin/provider-error-classifier.js" "755"
check_file "/usr/local/bin/scripts/scouting-allowlist.js" "755"
check_file "/usr/local/bin/scripts/context-handoff.js" "755"
check_file "/usr/local/bin/scripts/restore-disallowed-changes.sh" "755"
check_file "/usr/local/bin/scripts/evaluation-prompts.sh" "755"
check_file "/usr/local/bin/scripts/auto-lint-cleanup-classification.sh" "755"
check_file "/app/scripts/startup-check-packaging.sh" "755"

printf '\n### Library Scripts (644) ###\n'
check_file "/usr/local/bin/scripts/lib/provider-retry.sh" "644"

printf '\n### Template Files ###\n'
check_file "/usr/local/bin/templates/scouting/compact.txt" "644"
check_file "/usr/local/bin/templates/scouting/detailed-test-impact.txt" "644"

printf '\n### Symlinks ###\n'
check_symlink "/scripts/startup-checks.sh" "/app/scripts/startup-checks.sh"
check_symlink "/scripts/kaseki-init-container.sh" "/app/scripts/startup-checks.sh"

printf '\n=== Summary ===\n'
printf 'PASS: %d\n' "$PASS_COUNT"
printf 'FAIL: %d\n' "$FAIL_COUNT"

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
