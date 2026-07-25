#!/bin/bash
set -euo pipefail
fail() { local contract="$1"; shift; echo "  ✗ FAIL [$contract]: $*" >&2; exit 1; }
print_file_if_exists() { local label="$1" file="$2"; echo "  --- $label ($file) ---" >&2; if [[ -f "$file" ]]; then cat "$file" >&2; else echo "  <missing>" >&2; fi; }
cleanup_tmp_dir() { if [[ -n "${tmp_dir:-}" ]]; then rm -rf "$tmp_dir"; fi; }
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
run_pi_capture_fixture_with_timeout() {
  local raw_events_file="$1"
  PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$tmp_dir/results" KASEKI_PROVIDER=gateway llm_gateway_api_key=test llm_gateway_url=https://example.invalid python3 - "$raw_events_file" <<'PYTHON'
import os, subprocess, sys
raw_path = sys.argv[1]
cmd = f". scripts/lib/pi-json-capture.sh; emit_error_event() {{ :; }}; run_pi_json_capture {raw_path!r} 60 auto 'test prompt'"
try:
    completed = subprocess.run(['bash', '-c', cmd], timeout=5, env=os.environ.copy())
except subprocess.TimeoutExpired:
    sys.exit(124)
sys.exit(completed.returncode)
PYTHON
}
run_pi_json_capture_no_reader_test() {
  echo "TEST 7: Pi JSON capture does not block when progress FIFO reader exits early"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"

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
  run_pi_capture_fixture_with_timeout "$tmp_dir/raw.jsonl"
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

run_pi_json_capture_timeout_status_test() {
  echo "TEST 8: Pi JSON capture preserves and diagnoses timeout status"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"

  cat > "$fake_bin/timeout" <<'BASH'
#!/usr/bin/env bash
exit 124
BASH
  cat > "$fake_bin/kaseki-pi-progress-stream" <<'BASH'
#!/usr/bin/env bash
cat >/dev/null
BASH
  chmod +x "$fake_bin/timeout" "$fake_bin/kaseki-pi-progress-stream"

  set +e
  run_pi_capture_fixture_with_timeout "$tmp_dir/raw.jsonl"
  local capture_exit=$?
  set -e

  [[ "$capture_exit" == "124" ]] || fail "Pi capture timeout status" "returned $capture_exit (expected 124)"
  grep -q 'Pi JSON capture timed out after 60s' "$tmp_dir/results/progress-stream-diagnostics.log" || {
    print_file_if_exists "progress diagnostics" "$tmp_dir/results/progress-stream-diagnostics.log"
    fail "Pi capture timeout diagnostics" "timeout was not diagnosed distinctly"
  }

  rm -rf "$tmp_dir"
  tmp_dir=""
  trap - EXIT
  echo "  ✓ PASS: Pi timeout status remains distinct from other capture failures"
  echo ""
}

run_pi_json_capture_no_reader_test
run_pi_json_capture_timeout_status_test
