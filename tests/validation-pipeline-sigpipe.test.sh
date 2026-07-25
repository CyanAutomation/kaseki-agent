#!/bin/bash
set -euo pipefail
fail() { local contract="$1"; shift; echo "  ✗ FAIL [$contract]: $*" >&2; exit 1; }
print_file_if_exists() { local label="$1" file="$2"; echo "  --- $label ($file) ---" >&2; if [[ -f "$file" ]]; then cat "$file" >&2; else echo "  <missing>" >&2; fi; }
cleanup_tmp_dir() { if [[ -n "${tmp_dir:-}" ]]; then rm -rf "$tmp_dir"; fi; }
FILTER_SCRIPT="dist/validation-output-filter.js"
[[ -f "$FILTER_SCRIPT" ]] || fail "filter setup" "$FILTER_SCRIPT is missing; run npm run build before this test"

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

  cmp -s "$validation_log" "$raw_log" || { print_file_if_exists "validation log" "$validation_log"; print_file_if_exists "raw log" "$raw_log"; fail "SIGPIPE log contents" "tee outputs differed"; }
  [[ ! -s "$filter_stderr" ]] || { print_file_if_exists "filter stderr" "$filter_stderr"; fail "SIGPIPE filter stderr" "pipeline emitted unexpected filter or tee stderr"; }

  for log in "$validation_log" "$raw_log"; do
    grep -q '^==> ' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE log boundary" "$log missing command boundary"; }
    grep -q 'POST_STREAM_STDOUT marker' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE stdout capture" "$log missing stdout marker"; }
    grep -q 'POST_STREAM_STDERR marker' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE stderr capture" "$log missing stderr marker"; }
    grep -q 'exit_code=7' "$log" || { print_file_if_exists "log" "$log"; fail "SIGPIPE exit marker" "$log missing command exit boundary"; }
  done

  grep -q 'filter-startup:' "$filter_diagnostics" || { print_file_if_exists "filter diagnostics" "$filter_diagnostics"; fail "SIGPIPE diagnostics" "missing filter startup diagnostic"; }
  grep -q 'filter-close: exit_code=0' "$filter_diagnostics" || { print_file_if_exists "filter diagnostics" "$filter_diagnostics"; fail "SIGPIPE diagnostics" "missing successful filter close diagnostic"; }
  ! grep -q '141' "$filter_diagnostics" || fail "SIGPIPE diagnostics" "filter diagnostics contained exit 141"

  rm -rf "$tmp_dir"
  tmp_dir=""
  trap - EXIT
  echo "  ✓ PASS: Pipeline preserved exit 7 and captured deterministic stream markers"
  echo ""
}

run_sigpipe_regression_test
