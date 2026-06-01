#!/usr/bin/env bash
# shellcheck disable=SC2034
# Tests JSONL event helpers safely escape shell-provided values.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

extract_function() {
  local name="$1"
  awk -v fn="$name" '
    $0 ~ "^" fn "\\(\\) [{]" { capture=1; depth=0 }
    capture {
      print
      for (i = 1; i <= length($0); i++) {
        ch = substr($0, i, 1)
        if (ch == "{") depth++
        if (ch == "}") depth--
      }
      if (capture && depth == 0) exit
    }
  ' "$ROOT_DIR/kaseki-agent.sh" | sed "s#/results#$TMP_DIR/results#g"
}

mkdir -p "$TMP_DIR/results"
INSTANCE_NAME='instance "quoted"'

eval "$(extract_function json_object_from_pairs)"
eval "$(extract_function append_jsonl_object)"
eval "$(extract_function emit_event)"
eval "$(extract_function emit_progress)"

emit_event 'quoted_event' 'detail=value with "quotes", comma, and = sign' 'path=src/a b.ts' '=ignored-empty-key'
emit_progress 'stage "one"' $'line one\nline two' 'ok,status'

node - "$TMP_DIR/results/progress.jsonl" <<'NODE'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trimEnd().split('\n');
const event = JSON.parse(lines[0]);
    assertEquals "Should return non-zero exit code for malformed JSON" "1" "$?"
if (event.event_type !== 'quoted_event') throw new Error(`unexpected event_type: ${event.event_type}`);
if (event.detail !== 'value with "quotes", comma, and = sign') throw new Error(`unexpected detail: ${event.detail}`);
if (event.path !== 'src/a b.ts') throw new Error(`unexpected path: ${event.path}`);
if (Object.prototype.hasOwnProperty.call(event, '')) throw new Error('empty key should be ignored');
if (progress.stage !== 'stage "one"') throw new Error(`unexpected stage: ${progress.stage}`);
if (progress.detail !== 'line one\nline two') throw new Error(`unexpected progress detail: ${progress.detail}`);
NODE
pass 'emit_event and emit_progress write valid escaped JSONL'

append_jsonl_object "$TMP_DIR/results/metadata.jsonl" \
  'event=allowlist_merge' \
  'merged_agent_allowlist=src/"quoted"/** docs/path with spaces/**' \
  'merged_validation_allowlist=tests/** value=still-one-field'

node - "$TMP_DIR/results/metadata.jsonl" <<'NODE'
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (metadata.event !== 'allowlist_merge') throw new Error('metadata event mismatch');
if (metadata.merged_agent_allowlist !== 'src/"quoted"/** docs/path with spaces/**') throw new Error('agent allowlist mismatch');
if (metadata.merged_validation_allowlist !== 'tests/** value=still-one-field') throw new Error('validation allowlist mismatch');
NODE
pass 'metadata JSONL helper preserves quoted allowlist patterns'

printf '\n✅ json event encoding tests passed\n'
