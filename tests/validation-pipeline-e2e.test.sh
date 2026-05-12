#!/bin/bash
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

long_running_command='for i in 1 2 3 4; do echo "stdout tick $i"; echo "stderr tick $i" >&2; sleep 0.6; done; echo "POST_TIMEOUT_STDOUT marker"; echo "POST_TIMEOUT_STDERR marker" >&2; exit 7'

set +e
{
  printf '\n==> %s\n' "$long_running_command"
  bash -c "$long_running_command"
  command_exit=$?
  printf 'exit_code=%s\n' "$command_exit"
  exit "$command_exit"
} 2>&1 \
  | tee --output-error=warn \
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
echo "✓ All E2E validation pipeline tests PASSED"
echo ""
echo "Summary: The SIGPIPE fix ensures that:"
echo "  1. Filter always exits 0 (diagnostic tool, not blocking)"
echo "  2. Filter output is still correctly filtered"
echo "  3. Errors are logged to stderr but don't prevent pipeline"
echo "  4. Command exit codes are preserved (no SIGPIPE 141)"
