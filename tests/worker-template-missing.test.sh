#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/kaseki-agent.sh"

fail() {
  printf 'FAIL: worker template missing: %s\n' "$*" >&2
  exit 1
}

# The guard must run before Pi, retain a worker-specific classification, and
# use the deterministic non-retryable worker-layout exit code.
guard_line="$(grep -nF 'if ! check_scouting_templates; then' "$SCRIPT" | cut -d: -f1)"
pi_line="$(grep -nF 'run_pi_with_retry "$SCOUTING_RAW_EVENTS"' "$SCRIPT" | head -n 1 | cut -d: -f1)"
[ -n "$guard_line" ] || fail 'missing scouting template guard'
[ -n "$pi_line" ] || fail 'missing scouting provider invocation'
[ "$guard_line" -lt "$pi_line" ] || fail 'template guard must run before Pi'

grep -Fq 'WORKER_ERROR_TYPE="worker_template_missing"' "$SCRIPT" || fail 'missing worker_template_missing classification'
grep -Fq '"worker_error_type": $(printf' "$SCRIPT" || fail 'failure artifacts do not persist worker error type'
grep -Fq '[ "$exit_code" -eq 87 ]' "$SCRIPT" || fail 'worker template exit code is not non-retryable'
grep -Fq 'return 87' "$SCRIPT" || fail 'template guard does not return the worker-layout failure code'

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/templates/scouting"
touch "$tmp_dir/templates/scouting/base.txt"

template_guard_output="$({
  sed -n '/^check_scouting_templates() {/,/^run_scouting_agent() {/p' "$SCRIPT" | sed '$d'
  printf 'SCRIPT_DIR=%q\n' "$tmp_dir"
  printf 'WORKER_ERROR_TYPE=""\nWORKER_ERROR_PHASE=""\nWORKER_ERROR_MESSAGE=""\n'
  printf 'check_scouting_templates; status=$?\n'
  printf 'test "$status" -eq 87\n'
  printf 'test "$WORKER_ERROR_TYPE" = worker_template_missing\n'
} | bash 2>&1)" || fail "template guard did not classify a missing local template: $template_guard_output"

if {
  sed -n '/^is_transient_scouting_failure() {/,/^# Phase 2.1:/p' "$SCRIPT" | sed '$d'
  printf 'KASEKI_RESULTS_DIR=%q\n' "$tmp_dir/results"
  printf 'mkdir -p "$KASEKI_RESULTS_DIR"\n'
  printf 'is_transient_scouting_failure 87 "worker_template_missing"\n'
} | bash; then
  fail 'worker_template_missing was incorrectly classified as retryable'
fi

printf 'PASS: worker template missing fails before provider retry\n'
