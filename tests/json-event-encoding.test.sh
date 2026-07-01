#!/usr/bin/env bash
# shellcheck disable=SC2034
# Tests JSONL event helpers preserve event fields while generic escaping is
# covered by test/json-helpers.test.ts.

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

emit_event 'edge_event' \
  'empty_value=' \
  'duplicate=first' \
  'duplicate=second' \
  '=ignored-empty-key' \
  $'message=line one\nline two\tctrl:\001' \
  'path=src/a b.ts'

emit_progress 'stage:empty-detail' '' ''

node - "$TMP_DIR/results/progress.jsonl" <<'NODE'
const fs = require('node:fs');

function assertField(object, field, expected) {
  if (object[field] !== expected) {
    throw new Error(`unexpected ${field}: ${JSON.stringify(object[field])}; expected ${JSON.stringify(expected)}`);
  }
}

function assertNoField(object, field) {
  if (Object.prototype.hasOwnProperty.call(object, field)) {
    throw new Error(`unexpected field ${JSON.stringify(field)}: ${JSON.stringify(object[field])}`);
  }
}

const raw = fs.readFileSync(process.argv[2], 'utf8').trimEnd();
const lines = raw === '' ? [] : raw.split('\n');
if (lines.length !== 2) throw new Error(`expected 2 JSONL records, got ${lines.length}`);

const event = JSON.parse(lines[0]);
const progress = JSON.parse(lines[1]);

assertField(event, 'component', 'kaseki-agent');
assertField(event, 'instance', 'instance "quoted"');
assertField(event, 'event_type', 'edge_event');
assertField(event, 'empty_value', '');
assertField(event, 'duplicate', 'second');
assertField(event, 'message', 'line one\nline two\tctrl:\u0001');
assertField(event, 'path', 'src/a b.ts');
assertNoField(event, '');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(event.timestamp)) {
  throw new Error(`unexpected event timestamp: ${event.timestamp}`);
}

assertField(progress, 'component', 'kaseki-agent');
assertField(progress, 'instance', 'instance "quoted"');
assertField(progress, 'stage', 'stage:empty-detail');
assertField(progress, 'status', 'info');
assertField(progress, 'detail', '');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(progress.timestamp)) {
  throw new Error(`unexpected progress timestamp: ${progress.timestamp}`);
}
NODE
pass 'emit_event and emit_progress write semantically valid event JSONL edge cases'

append_jsonl_object "$TMP_DIR/results/metadata.jsonl" \
  'event=allowlist_merge' \
  'empty_value=' \
  'merged_agent_allowlist=src/** docs/path with spaces/**' \
  'merged_validation_allowlist=tests/** value=still-one-field' \
  'repeated=old' \
  'repeated=new' \
  '=ignored-empty-key'

node - "$TMP_DIR/results/metadata.jsonl" <<'NODE'
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const expected = {
  event: 'allowlist_merge',
  empty_value: '',
  merged_agent_allowlist: 'src/** docs/path with spaces/**',
  merged_validation_allowlist: 'tests/** value=still-one-field',
  repeated: 'new',
};

for (const [field, value] of Object.entries(expected)) {
  if (metadata[field] !== value) {
    throw new Error(`unexpected ${field}: ${JSON.stringify(metadata[field])}; expected ${JSON.stringify(value)}`);
  }
}

if (Object.prototype.hasOwnProperty.call(metadata, '')) {
  throw new Error('empty key should be ignored');
}
NODE
pass 'append_jsonl_object preserves event metadata semantics'

printf '\n✅ json event encoding tests passed\n'
