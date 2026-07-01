#!/usr/bin/env bash
# Regression test: baseline checkout logging must not redirect into an unavailable host log directory.

set -euo pipefail

TEST_NAME="baseline log dir fallback"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
HELPER_UNDER_TEST="$TMP_DIR/choose-baseline-log-dir.sh"
RESULTS_DIR="$TMP_DIR/results"
WRITABLE_LOG_DIR="$TMP_DIR/host-logs"
UNAVAILABLE_LOG_DIR="/proc/kaseki-missing-log-dir"
UNAVAILABLE_RESULTS_DIR="/proc/kaseki-missing-results-dir"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  exit 1
}

extract_helper() {
  awk '/^choose_baseline_log_dir\(\)/,/^}/' "$SCRIPT_UNDER_TEST" > "$HELPER_UNDER_TEST"
  if ! grep -q '^choose_baseline_log_dir()' "$HELPER_UNDER_TEST"; then
    fail "could not extract choose_baseline_log_dir helper"
  fi
}

run_helper() {
  KASEKI_LOG_DIR="$1" \
    KASEKI_RESULTS_DIR="$2" \
    TMPDIR="$3" \
    bash -c '. "$0"; choose_baseline_log_dir' "$HELPER_UNDER_TEST"
}

extract_helper
mkdir -p "$RESULTS_DIR" "$WRITABLE_LOG_DIR"

selected_dir="$(run_helper "$UNAVAILABLE_LOG_DIR" "$RESULTS_DIR" "$TMP_DIR")" || {
  fail "helper failed when KASEKI_LOG_DIR was unavailable"
}
if [ "$selected_dir" != "$RESULTS_DIR" ]; then
  fail "expected unavailable KASEKI_LOG_DIR to fall back to KASEKI_RESULTS_DIR, got: $selected_dir"
fi

if ! printf 'checkout stderr\n' >> "${selected_dir}/baseline-checkout.log"; then
  fail "selected fallback baseline checkout log path is not writable"
fi
if [ ! -f "$RESULTS_DIR/baseline-checkout.log" ]; then
  fail "expected baseline checkout log in KASEKI_RESULTS_DIR"
fi

selected_dir="$(run_helper "$WRITABLE_LOG_DIR" "$RESULTS_DIR" "$TMP_DIR")" || {
  fail "helper failed when KASEKI_LOG_DIR was writable"
}
if [ "$selected_dir" != "$WRITABLE_LOG_DIR" ]; then
  fail "expected writable KASEKI_LOG_DIR to be selected, got: $selected_dir"
fi

selected_dir="$(run_helper "$UNAVAILABLE_LOG_DIR" "$UNAVAILABLE_RESULTS_DIR" "$TMP_DIR")" || {
  fail "helper failed when KASEKI_LOG_DIR and KASEKI_RESULTS_DIR were unavailable"
}
case "$selected_dir" in
  "$TMP_DIR"/kaseki-baseline-logs.*) ;;
  *) fail "expected unavailable log and results dirs to use a secure mktemp directory, got: $selected_dir" ;;
esac
if [ ! -d "$selected_dir" ] || [ ! -w "$selected_dir" ]; then
  fail "secure temporary baseline log directory is not writable: $selected_dir"
fi
if [ "$selected_dir" = "/tmp/kaseki-agent" ]; then
  fail "helper selected insecure predictable /tmp/kaseki-agent fallback"
fi

if [ -e "$UNAVAILABLE_LOG_DIR/baseline-checkout.log" ]; then
  fail "baseline checkout log was unexpectedly written under unavailable KASEKI_LOG_DIR"
fi

echo "✓ PASS: $TEST_NAME"
