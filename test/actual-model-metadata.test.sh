#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="actual-model-metadata.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$REPO_ROOT/scripts/resolve-actual-model.js"

assert_model() {
  local case_name="$1"
  local expected_model="$2"
  local summary_json="$3"
  local events_jsonl="$4"

  local tmp_root
  tmp_root="$(mktemp -d)"
  printf '%s\n' "$summary_json" > "$tmp_root/pi-summary.json"
  printf '%s\n' "$events_jsonl" > "$tmp_root/raw-events.jsonl"

  local actual_model
  actual_model="$(node "$HELPER" "$tmp_root/pi-summary.json" "$tmp_root/raw-events.jsonl")"
  if [[ "$actual_model" != "$expected_model" ]]; then
    echo "[$TEST_NAME/$case_name] expected $expected_model, got $actual_model" >&2
    exit 1
  fi

  rm -rf "$tmp_root"
}

assert_model \
  "event-stream-model-wins" \
  "event-model" \
  '{"selected_model":"summary-model","model":"fallback"}' \
  '{"type":"message","model":"event-model"}'

assert_model \
  "summary-selected-model-trimmed" \
  "gpt-4.1-mini" \
  '{"selected_model":"  gpt-4.1-mini  ","model":"fallback"}' \
  '{"type":"message"}'

assert_model \
  "unknown-missing-attribution" \
  "unknown" \
  '{"selected_model":"unknown","model":"null"}' \
  '{"type":"message"}'

if node "$HELPER" >/tmp/actual-model-missing-args.out 2>/tmp/actual-model-missing-args.err; then
  echo "[$TEST_NAME/missing-args] expected helper to fail without arguments" >&2
  exit 1
fi
grep -q 'Usage: resolve-actual-model.js <summaryPath> <eventsPath>' /tmp/actual-model-missing-args.err
rm -f /tmp/actual-model-missing-args.out /tmp/actual-model-missing-args.err

run_wrapper_smoke() {
  rm -rf /results
  mkdir -p /results

  local tmp_root
  tmp_root="$(mktemp -d)"
  local fake_bin="$tmp_root/bin"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "pi 0.0.0-test"
  exit 0
fi
printf '{"type":"message","model":"event-smoke-model"}\n'
exit 0
PI

  cat > "$fake_bin/kaseki-pi-progress-stream" <<'PS'
#!/usr/bin/env bash
cat
PS

  cat > "$fake_bin/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
cat > "$3" <<'JSON'
{"selected_model":"summary-smoke-model","model":"fallback"}
JSON
cat "$1" > "$2"
exit 0
EF

  cat > "$fake_bin/validation-output-filter" <<'VOF'
#!/usr/bin/env bash
cat
VOF

  cat > "$fake_bin/timeout" <<'TO'
#!/usr/bin/env bash
while [[ "${1:-}" == -* ]]; do
  if [[ "${1:-}" == "-s" || "${1:-}" == "--signal" ]]; then
    shift 2
  else
    shift
  fi
done
shift
"$@"
TO

  cat > "$fake_bin/npm" <<'NPM'
#!/usr/bin/env bash
exit 0
NPM

  cat > "$fake_bin/git" <<'GIT'
#!/usr/bin/env bash
case "${1:-}" in
  clone) mkdir -p /workspace/repo; exit 0 ;;
  checkout|config|add|commit) exit 0 ;;
  status) exit 0 ;;
  diff) exit 0 ;;
  rev-parse) echo "abc123"; exit 0 ;;
  *) exit 0 ;;
esac
GIT

  local fake_lib="$tmp_root/lib"
  mkdir -p "$fake_lib"
  touch "$fake_lib/event-aggregator.js" "$fake_lib/timestamp-tracker.js" "$fake_lib/progress-stream-utils.js"

  chmod +x "$fake_bin"/*

  set +e
  env PATH="$fake_bin:$PATH" KASEKI_APP_LIB_DIR="$fake_lib" OPENROUTER_API_KEY="test" GITHUB_APP_ENABLED=0 LLM_GATEWAY_URL="https://example.invalid/v1/responses" LLM_GATEWAY_API_KEY="test" REPO_URL="https://example.com/repo.git" GIT_REF="main" TASK_PROMPT="test" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 KASEKI_SCOUTING=0 KASEKI_GOAL_CHECK=0 KASEKI_HASHLINE_EDITS=0 \
    bash "$REPO_ROOT/kaseki-agent.sh" >"$tmp_root/stdout.log" 2>"$tmp_root/stderr.log"
  code=$?
  set -e

  [[ "$code" -eq 0 ]] || { echo "[$TEST_NAME/wrapper-smoke] expected zero exit, got $code"; cat "$tmp_root/stderr.log" >&2; exit 1; }

  node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("/results/metadata.json","utf8"));if(m.actual_model!=="event-smoke-model")throw new Error(`expected event-smoke-model got ${m.actual_model}`);'
  ! grep -q 'model_attribution_missing' /results/progress.jsonl

  rm -rf "$tmp_root"
}

run_wrapper_smoke

# Warning emission stays at wrapper level because the helper has a value-only interface.
rm -rf /results
mkdir -p /results
emit_event() { printf '%s\n' "$*" >> /results/progress.jsonl; }
ACTUAL_MODEL="$(node "$HELPER" /results/missing-summary.json /results/missing-events.jsonl)"
if [[ "$ACTUAL_MODEL" == "unknown" ]]; then
  emit_event "warning" "warning_type=model_attribution_missing" "detail=Unable to resolve model from pi-summary.json or raw events"
fi
grep -q 'model_attribution_missing' /results/progress.jsonl

echo "[$TEST_NAME] PASS"
