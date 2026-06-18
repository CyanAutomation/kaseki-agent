#!/bin/bash
# test/hashline-integration.test.sh
#
# Thin CLI smoke test for hashline event handler argument wiring and artifact paths.
# Behavioral coverage lives in tests/hashline-event-handler.test.ts.

set -euo pipefail

TEST_DIR=""
cleanup() {
  if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
    rm -rf "$TEST_DIR"
  fi
}
trap cleanup EXIT

TEST_DIR=$(mktemp -d)
WORKSPACE_DIR="$TEST_DIR/workspace"
ARTIFACT_DIR="$TEST_DIR/artifacts"
mkdir -p "$WORKSPACE_DIR" "$ARTIFACT_DIR"

EVENTS_FILE="$ARTIFACT_DIR/pi-events.raw.jsonl"
HASHLINE_EVENTS_FILE="$ARTIFACT_DIR/custom-hashline-events.jsonl"
HASHLINE_SUMMARY_FILE="$ARTIFACT_DIR/custom-hashline-summary.json"

cat > "$EVENTS_FILE" <<'EVENTS'
{"type":"message","content":"No edits needed"}
EVENTS

npx tsx src/hashline-event-handler-cli.ts \
  "$EVENTS_FILE" \
  "$WORKSPACE_DIR" \
  "$HASHLINE_EVENTS_FILE" \
  "$HASHLINE_SUMMARY_FILE" \
  > "$ARTIFACT_DIR/hashline-cli.stdout" \
  2> "$ARTIFACT_DIR/hashline-cli.stderr"

[ -f "$HASHLINE_EVENTS_FILE" ]
[ -f "$HASHLINE_SUMMARY_FILE" ]
[ -s "$HASHLINE_SUMMARY_FILE" ]
[ ! -s "$HASHLINE_EVENTS_FILE" ]

node -e '
const fs = require("node:fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (summary.applied !== 0 || summary.rejected !== 0 || summary.errors !== 0 || summary.totalLinesModified !== 0) {
  throw new Error(`Unexpected summary: ${JSON.stringify(summary)}`);
}
' "$HASHLINE_SUMMARY_FILE"

grep -F "$HASHLINE_EVENTS_FILE" "$ARTIFACT_DIR/hashline-cli.stdout" >/dev/null
grep -F "$HASHLINE_SUMMARY_FILE" "$ARTIFACT_DIR/hashline-cli.stdout" >/dev/null

echo "✓ hashline CLI smoke test passed"
