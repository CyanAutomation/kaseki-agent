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
run_pi_capture_fixture() {
  local raw_events_file="$1"
  PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$tmp_dir/results" KASEKI_PROVIDER=gateway llm_gateway_api_key=test llm_gateway_url=https://example.invalid bash -c ". scripts/lib/pi-json-capture.sh; emit_error_event() { printf 'emit_error_event %s\n' "\$*" >> '$tmp_dir/results/events.log'; }; run_pi_json_capture '$raw_events_file' 60 auto 'test prompt'"
}
run_phase_tool_manifest_test() {
  echo "TEST 6A: Pi capture uses phase-specific tool manifests"
  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"
  cat > "$fake_bin/pi" <<'BASH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$KASEKI_RESULTS_DIR/pi-args.log"
printf '{"type":"agent_end"}\n'
BASH
  chmod +x "$fake_bin/pi"
  cat > "$fake_bin/kaseki-pi-progress-stream" <<'BASH'
#!/usr/bin/env bash
cat >/dev/null
BASH
  chmod +x "$fake_bin/kaseki-pi-progress-stream"
  make_timeout_passthrough "$fake_bin/timeout"

  PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$tmp_dir/results" KASEKI_PROVIDER=gateway KASEKI_INFERENCE_PHASE=goal-check bash -c ". scripts/lib/pi-json-capture.sh; emit_error_event() { :; }; run_pi_json_capture '$tmp_dir/raw.jsonl' 60 auto 'test prompt'"
  grep -q -- '--tools read,search' "$tmp_dir/results/pi-args.log" || fail "Pi phase tools" "goal-check did not use read-only tools"
  if grep -Eq -- '--tools .*\b(write|bash)\b' "$tmp_dir/results/pi-args.log"; then
    fail "Pi phase tools" "goal-check received a mutation or shell tool"
  fi
  grep -q 'Tool-output target:' "$tmp_dir/results/pi-args.log" || fail "Pi output budget" "bounded-output instruction was not supplied"
  : > "$tmp_dir/results/pi-args.log"
  PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$tmp_dir/results" KASEKI_PROVIDER=gateway KASEKI_INFERENCE_PHASE=run-evaluation bash -c ". scripts/lib/pi-json-capture.sh; emit_error_event() { :; }; run_pi_json_capture '$tmp_dir/raw.jsonl' 60 auto 'test prompt'"
  grep -q -- '--tools read,search' "$tmp_dir/results/pi-args.log" || fail "Pi phase tools" "run-evaluation did not use the controller-persisted read-only manifest"
  if grep -Eq -- '--tools .*\b(write|bash)\b' "$tmp_dir/results/pi-args.log"; then
    fail "Pi phase tools" "run-evaluation received a mutation or shell tool"
  fi
  rm -rf "$tmp_dir"; tmp_dir=""; trap - EXIT
  echo "  ✓ PASS: Pi phase-specific tools and output budget are applied"
  echo ""
}

run_evaluator_prompt_contract_test() {
  echo "TEST 6B: Evaluator prompts use controller-persisted JSON"
  if grep -q 'Write exactly one JSON object to \$RUN_EVALUATION_CANDIDATE_ARTIFACT' scripts/evaluation-prompts.sh; then
    fail "Evaluator prompt contract" "run-evaluation still requires the read-only agent to write an artifact"
  fi
  grep -q 'Kaseki validates and persists the response' scripts/evaluation-prompts.sh || fail "Evaluator prompt contract" "run-evaluation does not declare controller persistence"
  echo "  ✓ PASS: Evaluator output contract is controller-persisted"
  echo ""
}
run_pi_json_capture_progress_failure_test() {
  echo "SECTION: Pi JSON capture behavior"
  echo "TEST 6: Pi JSON capture preserves raw events when progress stream fails"

  tmp_dir=$(mktemp -d)
  trap cleanup_tmp_dir EXIT
  fake_bin="$tmp_dir/bin"
  mkdir -p "$fake_bin" "$tmp_dir/results"

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
  run_pi_capture_fixture "$tmp_dir/raw.jsonl"
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

run_phase_tool_manifest_test
run_evaluator_prompt_contract_test
run_pi_json_capture_progress_failure_test
