#!/bin/bash
# shellcheck disable=SC2016,SC2317
# E2E test: validation pipeline contracts stay independent and diagnosable.

set -euo pipefail

FILTER_SCRIPT="dist/validation-output-filter.js"

fail() {
  local contract="$1"
  shift
  echo "  ✗ FAIL [$contract]: $*" >&2
  exit 1
}

print_file_if_exists() {
  local label="$1"
  local file="$2"
  echo "  --- $label ($file) ---" >&2
  if [[ -f "$file" ]]; then
    cat "$file" >&2
  else
    echo "  <missing>" >&2
  fi
}

require_filter_script() {
  [[ -f "$FILTER_SCRIPT" ]] || fail "filter setup" "$FILTER_SCRIPT is missing; run npm run build before this test"
}

make_timeout_passthrough() {
  local target="$1"
  cat > "$target" <<'BASH'
#!/usr/bin/env bash
if [ "${1:-}" = "--signal=SIGTERM" ]; then
  shift
fi
shift
exec "$@"
BASH
  chmod +x "$target"
}

extract_run_pi_json_capture_helper() {
  local helper_source="$1"
  awk '
    /^run_pi_json_capture\(\) \{/ { capture=1 }
    capture && /^if \[ "\$\{KASEKI_PI_EVENT_FILTER_HELPER_TEST:-0\}" = "1" \]; then/ { exit }
    capture { print }
  ' kaseki-agent.sh > "$helper_source"
  cat >> "$helper_source" <<'BASH'
emit_error_event() {
  printf 'emit_error_event %s\n' "$*" >> "${KASEKI_RESULTS_DIR}/events.log"
}
BASH
}

run_pi_capture_fixture() {
  local helper_source="$1"
  local raw_events_file="$2"
  PATH="$fake_bin:$PATH" \
  KASEKI_RESULTS_DIR="$tmp_dir/results" \
  KASEKI_PROVIDER=gateway \
  llm_gateway_api_key=test \
  llm_gateway_url=https://example.invalid \
  bash -c ". '$helper_source'; run_pi_json_capture '$raw_events_file' 60 auto 'test prompt'"
}

run_pi_capture_fixture_with_timeout() {
  local helper_source="$1"
  local raw_events_file="$2"
  PATH="$fake_bin:$PATH" \
  KASEKI_RESULTS_DIR="$tmp_dir/results" \
  KASEKI_PROVIDER=gateway \
  llm_gateway_api_key=test \
  llm_gateway_url=https://example.invalid \
  python3 - "$helper_source" "$raw_events_file" <<'PY'
import os
import subprocess
import sys

helper_source, raw_path = sys.argv[1], sys.argv[2]
cmd = f". {helper_source!r}; run_pi_json_capture {raw_path!r} 60 auto 'test prompt'"
try:
    completed = subprocess.run(['bash', '-c', cmd], timeout=5, env=os.environ.copy())
except subprocess.TimeoutExpired:
    sys.exit(124)
sys.exit(completed.returncode)
PY
}

cleanup_tmp_dir() {
  if [[ -n "${tmp_dir:-}" ]]; then
    rm -rf "$tmp_dir"
  fi
}

run_filter_exit_behavior_tests() {
  echo "SECTION: validation-output-filter exit behavior and filtering"

  local filter_exit output

  echo "TEST 1: Filter exits 0 on normal output"
  echo "==> npm test" | node "$FILTER_SCRIPT" 2>/dev/null
  filter_exit=$?
  [[ $filter_exit -eq 0 ]] || fail "filter normal exit" "filter exited $filter_exit (expected 0)"
  echo "  ✓ PASS: Filter exits 0 on normal output"

  echo "TEST 2: Filter exits 0 on error output"
  printf "==> npm test\nERROR: something broke\nexit_code=1\n" | node "$FILTER_SCRIPT" 2>/dev/null
  filter_exit=$?
  [[ $filter_exit -eq 0 ]] || fail "filter error-output exit" "filter exited $filter_exit (expected 0)"
  echo "  ✓ PASS: Filter exits 0 on error output"

  echo "TEST 3: Filter exits 0 on empty input"
  printf "" | node "$FILTER_SCRIPT" 2>/dev/null
  filter_exit=$?
  [[ $filter_exit -eq 0 ]] || fail "filter empty-input exit" "filter exited $filter_exit (expected 0)"
  echo "  ✓ PASS: Filter exits 0 on empty input"

  echo "TEST 4: Filter hides verbose output while preserving milestones"
  output=$(printf "==> npm test\nverbose line\nPASS: test 1\nexit_code=0\n" | node "$FILTER_SCRIPT" 2>/dev/null)
  if ! grep -q "PASS: test 1" <<<"$output"; then
    fail "filter visible output" "missing milestone in filtered output: $output"
  fi
  if grep -q "verbose line" <<<"$output"; then
    fail "filter visible output" "verbose line leaked into filtered output: $output"
  fi
  echo "  ✓ PASS: Filter preserves milestones and hides verbose lines"
  echo ""
}

run_sigpipe_regression_test() {
  # Search strings for this regression: validation-output-filter PIPESTATUS SIGPIPE exit 141
  # This reproduces the kaseki-agent.sh pipeline shape:
  #   command 2>&1 | tee >(validation log) >(raw log) | validation-output-filter
  # The deterministic producer emits a boundary, stdout, stderr, and exit marker
  # without relying on sleep or FILTER_IDLE_WATCHDOG_SECONDS. A regression that
  # closes the final pipeline stage early can deliver SIGPIPE to the producer and
  # surface exit 141 instead of the command's real exit code.
  echo "SECTION: long-running pipeline SIGPIPE regression"
  echo "TEST 5: Pipeline preserves real command exit and both tee logs"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  local validation_log="$tmp_dir/validation.log"
  local raw_log="$tmp_dir/validation-raw.log"
  local filter_diagnostics="$tmp_dir/filter-diagnostics.log"
  local filter_stderr="$tmp_dir/filter-stderr.log"
  : > "$validation_log"
  : > "$raw_log"
  : > "$filter_diagnostics"
  : > "$filter_stderr"

  local -a tee_command=(tee)
  if tee --output-error=warn-nopipe /dev/null >/dev/null 2>&1 </dev/null; then
    tee_command+=(--output-error=warn-nopipe)
  elif tee --output-error=warn /dev/null >/dev/null 2>&1 </dev/null; then
    tee_command+=(--output-error=warn)
  fi

  local producer_command='printf "stdout before marker\n"; printf "stderr before marker\n" >&2; for i in $(seq 1 250); do printf "verbose filler %s\n" "$i"; done; printf "POST_STREAM_STDOUT marker\n"; printf "POST_STREAM_STDERR marker\n" >&2; exit 7'

  set +e
  {
    printf '\n==> %s\n' "$producer_command"
    bash -c "$producer_command"
    command_exit=$?
    printf 'exit_code=%s\n' "$command_exit"
    exit "$command_exit"
  } 2>&1 \
    | "${tee_command[@]}" \
        >(cat >> "$validation_log") \
        >(cat >> "$raw_log") \
        2> >(sed 's/^/[validation-tee] /' >> "$filter_stderr") \
    | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" node "$FILTER_SCRIPT" 2>>"$filter_stderr"
  local -a pipe_statuses=("${PIPESTATUS[@]}")
  set -e

  local command_exit="${pipe_statuses[0]:-missing}"
  local tee_exit="${pipe_statuses[1]:-missing}"
  local filter_exit="${pipe_statuses[2]:-missing}"

  if [[ "$command_exit" != "7" ]]; then
    echo "  PIPESTATUS: ${pipe_statuses[*]}" >&2
    print_file_if_exists "validation log" "$validation_log"
    print_file_if_exists "raw log" "$raw_log"
    print_file_if_exists "filter stderr" "$filter_stderr"
    fail "SIGPIPE command exit" "pipeline command exit was $command_exit (expected real command exit 7, not SIGPIPE exit 141)"
  fi
  [[ "$command_exit" != "141" ]] || fail "SIGPIPE command exit" "pipeline command surfaced SIGPIPE exit 141"
  [[ "$tee_exit" == "0" ]] || { print_file_if_exists "filter stderr" "$filter_stderr"; fail "SIGPIPE tee exit" "tee exited $tee_exit (expected 0)"; }
  [[ "$filter_exit" == "0" ]] || { print_file_if_exists "filter stderr" "$filter_stderr"; fail "SIGPIPE filter exit" "validation-output-filter exited $filter_exit (expected 0)"; }

  for log in "$validation_log" "$raw_log"; do
    grep -q '^==> ' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE log boundary" "$log missing command boundary"; }
    grep -q 'POST_STREAM_STDOUT marker' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE stdout capture" "$log missing stdout marker"; }
    grep -q 'POST_STREAM_STDERR marker' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE stderr capture" "$log missing stderr marker"; }
    grep -q 'exit_code=7' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE exit marker" "$log missing command exit boundary"; }
  done

  rm -rf "$tmp_dir"
  tmp_dir=""
  trap - EXIT
  echo "  ✓ PASS: Pipeline preserved exit 7 and captured deterministic stream markers"
  echo ""
}

run_pi_json_capture_progress_failure_test() {
  echo "SECTION: Pi JSON capture behavior"
  echo "TEST 6: Pi JSON capture preserves raw events when progress stream fails"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"
  local helper_source="$tmp_dir/run-pi-json-capture.sh"
  extract_run_pi_json_capture_helper "$helper_source"

  cat > "$fake_bin/pi" <<'BASH'
#!/usr/bin/env bash
printf '{"type":"agent_start"}\n'
printf '{"type":"message_update","message":{"content":"raw event survived"}}\n'
printf '{"type":"agent_end"}\n'
exit 0
BASH
  chmod +x "$fake_bin/pi"
  cat > "$fake_bin/kaseki-pi-progress-stream" <<'BASH'
#!/usr/bin/env bash
cat >/dev/null
printf 'simulated progress stream failure\n' >&2
exit 9
BASH
  chmod +x "$fake_bin/kaseki-pi-progress-stream"
  make_timeout_passthrough "$fake_bin/timeout"

  set +e
  run_pi_capture_fixture "$helper_source" "$tmp_dir/raw.jsonl"
  local capture_exit=$?
  set -e

  if [[ "$capture_exit" != "0" ]]; then
    print_file_if_exists "progress diagnostics" "$tmp_dir/results/progress-stream-diagnostics.log"
    fail "Pi capture progress failure" "run_pi_json_capture returned $capture_exit (expected Pi exit 0)"
  fi
  grep -q 'raw event survived' "$tmp_dir/raw.jsonl" || { print_file_if_exists "raw events" "$tmp_dir/raw.jsonl"; fail "Pi capture raw events" "raw Pi events were not preserved"; }
  grep -q 'progress stream failed pi_exit=0 progress_exit=9' "$tmp_dir/results/progress-stream-diagnostics.log" || { print_file_if_exists "progress diagnostics" "$tmp_dir/results/progress-stream-diagnostics.log"; fail "Pi capture diagnostics" "progress stream failure was not diagnosed"; }

  rm -rf "$tmp_dir"
  tmp_dir=""
  trap - EXIT
  echo "  ✓ PASS: Pi raw event capture survives progress-stream failure"
  echo ""
}

run_pi_json_capture_no_reader_test() {
  echo "TEST 7: Pi JSON capture does not block when progress FIFO reader exits early"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"
  local helper_source="$tmp_dir/run-pi-json-capture.sh"
  extract_run_pi_json_capture_helper "$helper_source"

  cat > "$fake_bin/pi" <<'BASH'
#!/usr/bin/env bash
printf '{"type":"agent_start"}\n'
printf '{"type":"message_update","message":{"content":"raw event survived no fifo reader"}}\n'
printf '{"type":"agent_end"}\n'
exit 0
BASH
  chmod +x "$fake_bin/pi"
  cat > "$fake_bin/kaseki-pi-progress-stream" <<'BASH'
#!/usr/bin/env bash
exit 9
BASH
  chmod +x "$fake_bin/kaseki-pi-progress-stream"
  make_timeout_passthrough "$fake_bin/timeout"

  set +e
  run_pi_capture_fixture_with_timeout "$helper_source" "$tmp_dir/raw.jsonl"
  local capture_exit=$?
  set -e

  if [[ "$capture_exit" != "0" ]]; then
    print_file_if_exists "progress diagnostics" "$tmp_dir/results/progress-stream-diagnostics.log"
    fail "Pi capture no-reader" "run_pi_json_capture returned $capture_exit (expected Pi exit 0, no FIFO hang)"
  fi
  grep -q 'raw event survived no fifo reader' "$tmp_dir/raw.jsonl" || { print_file_if_exists "raw events" "$tmp_dir/raw.jsonl"; fail "Pi capture no-reader raw events" "raw Pi events were not preserved without a FIFO reader"; }

  rm -rf "$tmp_dir"
  tmp_dir=""
  trap - EXIT
  echo "  ✓ PASS: Pi raw event capture does not hang without a FIFO reader"
  echo ""
}

require_filter_script

echo "Testing validation pipeline contracts..."
echo ""

run_filter_exit_behavior_tests
run_sigpipe_regression_test
run_pi_json_capture_progress_failure_test
run_pi_json_capture_no_reader_test

echo "✓ All E2E validation pipeline tests PASSED"
echo ""
echo "Summary:"
echo "  1. validation-output-filter is a non-blocking diagnostic filter"
echo "  2. validation pipeline command exit codes are preserved (no SIGPIPE 141)"
echo "  3. Pi JSON capture keeps raw events independent of progress stream failures"
