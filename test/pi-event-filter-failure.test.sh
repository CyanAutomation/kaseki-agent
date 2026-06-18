#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="pi-event-filter-failure.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TMP_ROOT="$(mktemp -d)"
FAKE_BIN="$TMP_ROOT/bin"
RESULTS_DIR="$TMP_ROOT/results"
RAW_EVENTS="$TMP_ROOT/raw-events.jsonl"
mkdir -p "$FAKE_BIN" "$RESULTS_DIR"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cat > "$RAW_EVENTS" <<'JSONL'
{"type":"message","model":"fake-model"}
JSONL

cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
printf 'filter stderr details\n' >&2
exit 7
EF
chmod +x "$FAKE_BIN/kaseki-pi-event-filter"

export PATH="$FAKE_BIN:$PATH"
export KASEKI_RESULTS_DIR="$RESULTS_DIR"
export KASEKI_TEST_RAW_EVENTS="$RAW_EVENTS"
export KASEKI_PI_EVENT_FILTER_HELPER_TEST=1
export REPO_URL="https://example.com/repo.git"
export GIT_REF="main"
export TASK_PROMPT="test"

set +e
bash "$REPO_ROOT/kaseki-agent.sh" >"$TMP_ROOT/stdout.log" 2>"$TMP_ROOT/stderr.log"
code=$?
set -e

if [[ "$code" -ne 7 ]]; then
  echo "[$TEST_NAME] expected event-filter exit 7, got $code"
  exit 1
fi

grep -q 'pi_event_filter_failed' "$RESULTS_DIR/progress.jsonl"
grep -q 'kaseki-pi-event-filter' "$RESULTS_DIR/metadata.json"
grep -q 'filter stderr details' "$RESULTS_DIR/pi-stderr.log"
grep -q 'ERROR: kaseki-pi-event-filter failed' "$RESULTS_DIR/pi-stderr.log"
mode="$(stat -c '%a' "$RESULTS_DIR/pi-stderr.log")"
if [[ "$mode" != "600" ]]; then
  echo "[$TEST_NAME] expected pi-stderr.log mode 600, got $mode"
  exit 1
fi
cmp -s "$RAW_EVENTS" "$RESULTS_DIR/pi-events.raw.jsonl"

echo "[$TEST_NAME] PASS"
