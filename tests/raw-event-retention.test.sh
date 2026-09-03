#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

extract_function() {
  awk -v fn="$1" '
    $0 ~ "^" fn "\\(\\) \\{" { capture=1; depth=0 }
    capture {
      print
      for (i = 1; i <= length($0); i++) {
        ch = substr($0, i, 1)
        if (ch == "{") depth++
        if (ch == "}") depth--
      }
      if (capture && depth == 0) exit
    }
  ' "$ROOT_DIR/kaseki-agent.sh"
}

KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$KASEKI_RESULTS_DIR"
eval "$(extract_function prune_raw_event_artifacts)"

printf '{"raw":true}\n' > "$KASEKI_RESULTS_DIR/scouting-events.raw.jsonl"
printf '{"sanitized":true}\n' > "$KASEKI_RESULTS_DIR/scouting-events.jsonl"
printf '{"raw":true}\n' > "$KASEKI_RESULTS_DIR/goal-check-events.raw.jsonl"

prune_raw_event_artifacts

[ ! -e "$KASEKI_RESULTS_DIR/scouting-events.raw.jsonl" ] || { echo 'raw event export should be removed after a sanitized export succeeds' >&2; exit 1; }
[ -e "$KASEKI_RESULTS_DIR/goal-check-events.raw.jsonl" ] || { echo 'raw event export should remain when no sanitized export exists' >&2; exit 1; }

printf '{"raw":true}\n' > "$KASEKI_RESULTS_DIR/scouting-events.raw.jsonl"
KASEKI_RETAIN_RAW_EVENTS=1 prune_raw_event_artifacts
[ -e "$KASEKI_RESULTS_DIR/scouting-events.raw.jsonl" ] || { echo 'explicit raw-event retention should preserve the raw export' >&2; exit 1; }

echo 'raw-event-retention.test.sh PASS'
