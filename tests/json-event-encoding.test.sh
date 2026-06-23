#!/usr/bin/env bash
# shellcheck disable=SC2034
# Tests JSONL event helpers safely escape shell-provided values.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

mkdir -p "$TMP_DIR/results"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
INSTANCE_NAME='instance "quoted"'

. "$ROOT_DIR/scripts/lib/json-events.sh"

emit_event 'quoted_event' 'detail=value with "quotes", comma, and = sign' 'path=src/a b.ts' '=ignored-empty-key'
emit_progress 'stage "one"' $'line one\nline two' 'ok,status'

node - "$TMP_DIR/results/progress.jsonl" <<'NODE'
const fs = require('node:fs');

function assertField(object, field, expected) {
  if (object[field] !== expected) {
    throw new Error(`unexpected ${field}: ${object[field]}`);
  }
}

const lines = fs.readFileSync(process.argv[2], 'utf8').trimEnd().split('\n');
const event = JSON.parse(lines[0]);
const progress = JSON.parse(lines[1]);

assertField(event, 'event_type', 'quoted_event');
assertField(event, 'detail', 'value with "quotes", comma, and = sign');
assertField(event, 'path', 'src/a b.ts');
if (Object.prototype.hasOwnProperty.call(event, '')) throw new Error('empty key should be ignored');

assertField(progress, 'stage', 'stage "one"');
assertField(progress, 'status', 'ok,status');
assertField(progress, 'detail', 'line one\nline two');
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
