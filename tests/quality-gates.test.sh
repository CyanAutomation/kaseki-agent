#!/usr/bin/env bash
# shellcheck disable=SC2034
# Integration tests for quality gate enforcement
# Tests diff size limits, allowlist validation, and secret scanning

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load the allowlist helper used by kaseki-agent.sh, then load the production
# quality-gate entry points from kaseki-agent.sh. The surrounding agent runtime
# callbacks are stubbed so tests assert on production-generated artifacts and
# exit-state variables without invoking the full Pi/checkout workflow.
# shellcheck source=scripts/allowlist-helper.sh
. "$ROOT_DIR/scripts/allowlist-helper.sh"
eval "$(awk '
  /^append_quality_violation\(\)/ { emit=1 }
  /^# Append a phase summary/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

pass() {
  local message="${1:?pass message required}"
  printf '✓ %s\n' "$message"
}

fail() {
  local message="${1:?failure message required}"
  printf '✗ %s\n' "$message" >&2
  exit 1
}

set_current_stage() { :; }
emit_progress() { :; }
emit_event() { printf '%s\n' "$*" >> "${KASEKI_RESULTS_DIR}/events.log"; }
record_stage_timing() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "${4:-}" >> "${KASEKI_RESULTS_DIR}/stage-timings.tsv"; }

reset_results() {
  rm -rf "$TMP_DIR/results"
  mkdir -p "$TMP_DIR/results"
  : > "$TMP_DIR/results/quality.log"
  : > "$TMP_DIR/results/.quality-gates-temp.jsonl"
  : > "$TMP_DIR/results/.secret-scan-temp.jsonl"
  : > "$TMP_DIR/results/git.diff"
  : > "$TMP_DIR/results/changed-files.txt"
  : > "$TMP_DIR/results/events.log"
  : > "$TMP_DIR/results/stage-timings.tsv"
  export KASEKI_RESULTS_DIR="$TMP_DIR/results"
  QUALITY_EXIT=0
  QUALITY_FAILURE_REASON=""
  SECRET_SCAN_EXIT=0
  KASEKI_DRY_RUN=0
}

prepare_repo() {
  rm -rf "$TMP_DIR/workspace"
  mkdir -p "$TMP_DIR/workspace/repo/src" "$TMP_DIR/workspace/repo/tests"
  export KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace"
  cd "$TMP_DIR/workspace/repo"
  git init --initial-branch=main -q
  git config user.email "test@kaseki.local"
  git config user.name "Test User"
  printf 'initial\n' > README.md
  git add README.md
  git commit -q -m "initial"
}

# Create a temp repo fixture that mirrors the agent workspace layout.
prepare_repo

# Test 1: Diff size exceeds max bytes via production quality checks
echo "==> Test: Diff size check"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  python3 -c "print('x' * 310000)" > large_file.txt
  python3 -c "print('x' * 310000)" > "$KASEKI_RESULTS_DIR/git.diff"
  printf 'large_file.txt\n' > "$KASEKI_RESULTS_DIR/changed-files.txt"
  KASEKI_MAX_DIFF_BYTES=200000
  KASEKI_CHANGED_FILES_ALLOWLIST=""

  run_quality_checks

  if [ "$QUALITY_EXIT" -eq 4 ] && grep -q 'git.diff is too large:' "$KASEKI_RESULTS_DIR/quality.log" && \
    jq -e 'select(.type == "max_diff_bytes_exceeded" and .severity == "error")' "$KASEKI_RESULTS_DIR/.quality-gates-temp.jsonl" >/dev/null; then
    pass "Diff size check: production quality gate records oversized diff"
  else
    fail "Diff size check: expected exit 4, quality.log diagnostic, and max_diff_bytes_exceeded artifact"
  fi
}

# Test 2: Allowlist validation via production quality checks
echo "==> Test: Allowlist validation"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  printf 'small change\n' > README.md
  git diff -- README.md > "$KASEKI_RESULTS_DIR/git.diff"
  printf 'README.md\n' > "$KASEKI_RESULTS_DIR/changed-files.txt"
  KASEKI_MAX_DIFF_BYTES=200000
  KASEKI_CHANGED_FILES_ALLOWLIST="src/**/*.ts tests/**/*.test.ts"

  run_quality_checks

  if [ "$QUALITY_EXIT" -eq 5 ] && [ "$QUALITY_FAILURE_REASON" = "allowlist_check: file 'README.md' not in allowlist" ] && \
    grep -q 'changed file outside allowlist: README.md' "$KASEKI_RESULTS_DIR/quality.log" && \
    grep -q 'rule=allowlist_check passed=false file=README.md' "$KASEKI_RESULTS_DIR/events.log"; then
    pass "Allowlist: production quality gate rejects changed file outside allowlist"
  else
    fail "Allowlist: expected exit 5, failure reason, diagnostic, and failed allowlist event"
  fi
}

# Test 3: Secret scanning via production secret-scan path
echo "==> Test: Secret scanning"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  mkdir -p src tests
  cat > src/secret.ts <<'SECRET'
export const key = "sk-or-aBcDeFgHiJkLmNoPqRsT";
SECRET

  run_secret_scan

  if [ "$SECRET_SCAN_EXIT" -eq 6 ] && \
    jq -e 'select(.file == "src/secret.ts" and .pattern == "sk-or-aBcDeFgHiJkLmNoPqRsT" and .status == "real_leak")' "$KASEKI_RESULTS_DIR/.secret-scan-temp.jsonl" >/dev/null; then
    pass "Secret scanning: production path detects unallowlisted sk-or-* pattern"
  else
    fail "Secret scanning: expected exit 6 and real_leak artifact for src/secret.ts"
  fi

  reset_results
  rm -f src/secret.ts
  printf 'export const value = "normal";\n' > src/clean.ts

  run_secret_scan

  if [ "$SECRET_SCAN_EXIT" -eq 0 ] && [ ! -s "$KASEKI_RESULTS_DIR/.secret-scan-temp.jsonl" ]; then
    pass "Secret scanning: production path passes clean repo fixture"
  else
    fail "Secret scanning: expected clean fixture to exit 0 without secret artifacts"
  fi
}

# Test 4: Secret allowlist behavior via production secret-scan path
echo "==> Test: Secret allowlist behavior"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  mkdir -p src
  cat > src/allowed-secret.ts <<'SECRET'
export const key = "sk-or-ZyXwVuTsRqPoNmLkJiHg";
SECRET
  printf 'src/allowed-secret.ts:sk-or-ZyXwVuTsRqPoNmLkJiHg\n' > .kaseki-secret-allowlist

  run_secret_scan

  if [ "$SECRET_SCAN_EXIT" -eq 0 ] && \
    jq -e 'select(.file == "src/allowed-secret.ts" and .pattern == "sk-or-ZyXwVuTsRqPoNmLkJiHg" and .status == "allowlisted")' "$KASEKI_RESULTS_DIR/.secret-scan-temp.jsonl" >/dev/null; then
    pass "Secret allowlist: production path records allowlisted match without failing"
  else
    fail "Secret allowlist: expected exit 0 and allowlisted artifact"
  fi
}

# Test 5: Multiple file allowlist via production quality checks
echo "==> Test: Multiple file allowlist patterns"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  mkdir -p src/lib tests docs
  printf 'parser\n' > src/lib/parser.ts
  printf 'test\n' > tests/parser.validation.ts
  printf 'docs\n' > docs/README.md
  git diff --no-index /dev/null src/lib/parser.ts > "$KASEKI_RESULTS_DIR/git.diff" || true
  printf 'src/lib/parser.ts\ntests/parser.validation.ts\ndocs/README.md\n' > "$KASEKI_RESULTS_DIR/changed-files.txt"
  KASEKI_MAX_DIFF_BYTES=200000
  KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts docs/README.md"

  run_quality_checks

  if [ "$QUALITY_EXIT" -eq 0 ] && \
    grep -q 'rule=allowlist_check passed=true file=src/lib/parser.ts' "$KASEKI_RESULTS_DIR/events.log" && \
    grep -q 'rule=allowlist_check passed=true file=tests/parser.validation.ts' "$KASEKI_RESULTS_DIR/events.log" && \
    grep -q 'rule=allowlist_check passed=true file=docs/README.md' "$KASEKI_RESULTS_DIR/events.log"; then
    pass "Allowlist: production quality gate accepts all explicitly allowlisted files"
  else
    fail "Allowlist: expected explicit allowlist to pass and emit passed events"
  fi
}

# Test 6: Empty diff handling via production quality checks
echo "==> Test: Empty diff handling"
{
  reset_results
  cd "$TMP_DIR/workspace/repo"
  KASEKI_MAX_DIFF_BYTES=200000
  KASEKI_CHANGED_FILES_ALLOWLIST="src/**/*.ts"

  run_quality_checks

  if [ "$QUALITY_EXIT" -eq 0 ] && \
    grep -q 'rule=max_diff_bytes passed=true actual=0 limit=200000' "$KASEKI_RESULTS_DIR/events.log" && \
    [ ! -s "$KASEKI_RESULTS_DIR/quality.log" ]; then
    pass "Empty diff handling: production quality gate accepts 0-byte diff artifacts"
  else
    fail "Empty diff handling: expected production quality gate to pass empty git.diff"
  fi
}

printf '\n✅ All quality gate tests passed\n'
