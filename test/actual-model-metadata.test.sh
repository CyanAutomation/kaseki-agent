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


echo "[$TEST_NAME] PASS"
