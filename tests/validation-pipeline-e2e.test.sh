#!/bin/bash
# shellcheck disable=SC2016
# E2E test: Verify validation pipeline preserves command exit codes (no 141 SIGPIPE)

set -euo pipefail

FILTER_SCRIPT="dist/validation-output-filter.js"

echo "Testing validation pipeline exit code preservation..."
echo ""

# Test 1: Verify filter ALWAYS exits 0 (even with normal output)
echo "TEST 1: Filter exits 0 on normal output"
echo "==> npm test" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 2: Verify filter exits 0 even with error output
echo "TEST 2: Filter exits 0 on error output"
printf "==> npm test\nERROR: something broke\nexit_code=1\n" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0 even with errors"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 3: Verify filter exits 0 on empty input
echo "TEST 3: Filter exits 0 on empty input"
echo -n "" | node "$FILTER_SCRIPT" 2>/dev/null
filter_exit=$?
if [[ $filter_exit -eq 0 ]]; then
  echo "  ✓ PASS: Filter exits 0 on empty input"
else
  echo "  ✗ FAIL: Filter exited $filter_exit (expected 0)"
  exit 1
fi
echo ""

# Test 4: Verify filter output is still filtered correctly
echo "TEST 4: Filter output is correct"
output=$(printf "==> npm test\nverbose line\nPASS: test 1\nexit_code=0\n" | node "$FILTER_SCRIPT" 2>/dev/null)
if echo "$output" | grep -q "PASS: test 1" && ! echo "$output" | grep -q "verbose line"; then
  echo "  ✓ PASS: Filter output is correct (errors shown, verbose hidden)"
else
  echo "  ✗ FAIL: Filter output is incorrect"
  echo "  Output: $output"
  exit 1
fi
echo ""


# Test 5: Verify kaseki-agent.sh-shaped tee/filter pipeline preserves long-running command exit codes
# Search strings for this regression: validation-output-filter PIPESTATUS SIGPIPE exit 141
# This reproduces the pipeline shape used by kaseki-agent.sh:
#   command 2>&1 | tee >(validation log) >(raw log) | validation-output-filter
# The command runs longer than FILTER_IDLE_WATCHDOG_SECONDS and continues writing
# to stdout/stderr after that former timeout window. A regression would close the
# final pipeline stage early, deliver SIGPIPE to the producer, and surface exit 141
# instead of the command's real exit code.
echo "TEST 5: Long-running validation pipeline preserves real command exit"
tmp_dir=$(mktemp -d)
cleanup_pipeline_test() {
  rm -rf "$tmp_dir"
}
trap cleanup_pipeline_test EXIT
validation_log="$tmp_dir/validation.log"
raw_log="$tmp_dir/validation-raw.log"
filter_diagnostics="$tmp_dir/filter-diagnostics.log"
filter_stderr="$tmp_dir/filter-stderr.log"
: > "$validation_log"
: > "$raw_log"
: > "$filter_diagnostics"
: > "$filter_stderr"
tee_command=(tee)
if tee --output-error=warn /dev/null >/dev/null 2>&1 </dev/null; then
  tee_command+=(--output-error=warn)
fi

long_running_command='for i in 1 2 3 4; do echo "stdout tick $i"; echo "stderr tick $i" >&2; sleep 0.6; done; echo "POST_TIMEOUT_STDOUT marker"; echo "POST_TIMEOUT_STDERR marker" >&2; exit 7'

set +e
{
  printf '\n==> %s\n' "$long_running_command"
  bash -c "$long_running_command"
  command_exit=$?
  printf 'exit_code=%s\n' "$command_exit"
  exit "$command_exit"
} 2>&1 \
  | "${tee_command[@]}" \
      >(cat >> "$validation_log") \
      >(cat >> "$raw_log") \
      2> >(sed 's/^/[validation-tee] /' >> "$filter_stderr") \
  | FILTER_DIAGNOSTICS_LOG="$filter_diagnostics" FILTER_IDLE_WATCHDOG_SECONDS=1 node "$FILTER_SCRIPT" 2>>"$filter_stderr"
pipe_statuses=("${PIPESTATUS[@]}")
set -e
command_exit="${pipe_statuses[0]:-missing}"
tee_exit="${pipe_statuses[1]:-missing}"
filter_exit="${pipe_statuses[2]:-missing}"

if [[ "$command_exit" != "7" ]]; then
  echo "  ✗ FAIL: Pipeline command exit was $command_exit (expected real command exit 7, not SIGPIPE exit 141)"
  echo "  PIPESTATUS: ${pipe_statuses[*]}"
  echo "  Validation log:"
  cat "$validation_log"
  echo "  Raw log:"
  cat "$raw_log"
  echo "  Filter stderr:"
  cat "$filter_stderr"
  exit 1
fi
if [[ "$command_exit" == "141" ]]; then
  echo "  ✗ FAIL: Pipeline command surfaced SIGPIPE exit 141"
  exit 1
fi
if [[ "$tee_exit" != "0" ]]; then
  echo "  ✗ FAIL: tee exited $tee_exit (expected 0)"
  cat "$filter_stderr"
  exit 1
fi
if [[ "$filter_exit" != "0" ]]; then
  echo "  ✗ FAIL: validation-output-filter exited $filter_exit (expected 0)"
  cat "$filter_stderr"
  exit 1
fi
for log in "$validation_log" "$raw_log"; do
  if ! grep -q '^==> ' "$log"; then
    echo "  ✗ FAIL: $log missing command boundary"
    cat "$log"
    exit 1
  fi
  if ! grep -q 'POST_TIMEOUT_STDOUT marker' "$log"; then
    echo "  ✗ FAIL: $log missing stdout written after watchdog window"
    cat "$log"
    exit 1
  fi
  if ! grep -q 'POST_TIMEOUT_STDERR marker' "$log"; then
    echo "  ✗ FAIL: $log missing stderr written after watchdog window"
    cat "$log"
    exit 1
  fi
  if ! grep -q 'exit_code=7' "$log"; then
    echo "  ✗ FAIL: $log missing command exit boundary"
    cat "$log"
    exit 1
  fi
done
rm -rf "$tmp_dir"
trap - EXIT
echo "  ✓ PASS: Long-running pipeline preserved exit 7 with post-watchdog output in both logs"
echo ""

# Test 6: Verify Pi JSON capture does not pipe Pi stdout through the progress stream
echo "TEST 6: Pi JSON capture preserves raw events when progress stream fails"
tmp_dir=$(mktemp -d)
cleanup_pi_capture_test() {
  rm -rf "$tmp_dir"
}
trap cleanup_pi_capture_test EXIT
fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin" "$tmp_dir/results"
helper_source="$tmp_dir/run-pi-json-capture.sh"
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
cat > "$fake_bin/timeout" <<'BASH'
#!/usr/bin/env bash
if [ "${1:-}" = "--signal=SIGTERM" ]; then
  shift
fi
shift
exec "$@"
BASH
chmod +x "$fake_bin/timeout"
set +e
PATH="$fake_bin:$PATH" \
KASEKI_RESULTS_DIR="$tmp_dir/results" \
KASEKI_PROVIDER=gateway \
llm_gateway_api_key=test \
llm_gateway_url=https://example.invalid \
bash -c ". '$helper_source'; run_pi_json_capture '$tmp_dir/raw.jsonl' 60 auto 'test prompt'"
capture_exit=$?
set -e
if [[ "$capture_exit" != "0" ]]; then
  echo "  ✗ FAIL: run_pi_json_capture returned $capture_exit (expected Pi exit 0)"
  cat "$tmp_dir/results/progress-stream-diagnostics.log" 2>/dev/null || true
  exit 1
fi
if ! grep -q 'raw event survived' "$tmp_dir/raw.jsonl"; then
  echo "  ✗ FAIL: raw Pi events were not preserved"
  cat "$tmp_dir/raw.jsonl" 2>/dev/null || true
  exit 1
fi
if ! grep -q 'progress stream failed pi_exit=0 progress_exit=9' "$tmp_dir/results/progress-stream-diagnostics.log"; then
  echo "  ✗ FAIL: progress stream failure was not diagnosed"
  cat "$tmp_dir/results/progress-stream-diagnostics.log" 2>/dev/null || true
  exit 1
fi
rm -rf "$tmp_dir"
trap - EXIT
echo "  ✓ PASS: Pi raw event capture survives progress-stream failure"
echo ""

# Test 7: Verify Pi JSON capture cannot hang when progress FIFO has no reader
echo "TEST 7: Pi JSON capture does not block when progress FIFO reader exits early"
tmp_dir=$(mktemp -d)
cleanup_pi_capture_test() {
  rm -rf "$tmp_dir"
}
trap cleanup_pi_capture_test EXIT
fake_bin="$tmp_dir/bin"
mkdir -p "$fake_bin" "$tmp_dir/results"
helper_source="$tmp_dir/run-pi-json-capture.sh"
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
cat > "$fake_bin/timeout" <<'BASH'
#!/usr/bin/env bash
if [ "${1:-}" = "--signal=SIGTERM" ]; then
  shift
fi
shift
exec "$@"
BASH
chmod +x "$fake_bin/timeout"
set +e
PATH="$fake_bin:$PATH" \
KASEKI_RESULTS_DIR="$tmp_dir/results" \
KASEKI_PROVIDER=gateway \
llm_gateway_api_key=test \
llm_gateway_url=https://example.invalid \
python3 - "$helper_source" "$tmp_dir/raw.jsonl" <<'PY'
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
capture_exit=$?
set -e
if [[ "$capture_exit" != "0" ]]; then
  echo "  ✗ FAIL: run_pi_json_capture returned $capture_exit (expected Pi exit 0, no FIFO hang)"
  cat "$tmp_dir/results/progress-stream-diagnostics.log" 2>/dev/null || true
  exit 1
fi
if ! grep -q 'raw event survived no fifo reader' "$tmp_dir/raw.jsonl"; then
  echo "  ✗ FAIL: raw Pi events were not preserved without a FIFO reader"
  cat "$tmp_dir/raw.jsonl" 2>/dev/null || true
  exit 1
fi
rm -rf "$tmp_dir"
trap - EXIT
echo "  ✓ PASS: Pi raw event capture does not hang without a FIFO reader"
echo ""

echo "✓ All E2E validation pipeline tests PASSED"
echo ""
echo "Summary: The SIGPIPE fix ensures that:"
echo "  1. Filter always exits 0 (diagnostic tool, not blocking)"
echo "  2. Filter output is still correctly filtered"
echo "  3. Errors are logged to stderr but don't prevent pipeline"
echo "  4. Command exit codes are preserved (no SIGPIPE 141)"
