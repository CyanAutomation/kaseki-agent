#!/usr/bin/env bash
set -euo pipefail

# Contract: when the Pi event filter helper fails, kaseki-agent propagates the
# helper exit code, preserves helper stderr, emits failure progress/metadata,
# keeps artifact permissions private, and leaves the raw Pi event stream intact.

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

fail() {
  echo "[$TEST_NAME] $*" >&2
  exit 1
}

assert_file_contains() {
  local target_file="$1"
  local expected_content="$2"
  local protected_behavior="$3"

  if ! grep -Fq -- "$expected_content" "$target_file"; then
    {
      echo "[$TEST_NAME] assertion failed: $protected_behavior"
      echo "[$TEST_NAME] target file: $target_file"
      echo "[$TEST_NAME] expected content: $expected_content"
      echo "[$TEST_NAME] file contents:"
      sed 's/^/[file] /' "$target_file" 2>/dev/null || true
    } >&2
    exit 1
  fi
}

assert_files_equal() {
  local expected_file="$1"
  local actual_file="$2"
  local protected_behavior="$3"

  if ! cmp -s "$expected_file" "$actual_file"; then
    {
      echo "[$TEST_NAME] assertion failed: $protected_behavior"
      echo "[$TEST_NAME] target file: $actual_file"
      echo "[$TEST_NAME] expected content from: $expected_file"
      echo "[$TEST_NAME] expected file contents:"
      sed 's/^/[expected] /' "$expected_file" 2>/dev/null || true
      echo "[$TEST_NAME] actual file contents:"
      sed 's/^/[actual] /' "$actual_file" 2>/dev/null || true
    } >&2
    exit 1
  fi
}

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
  fail "expected event-filter exit 7, got $code"
fi

assert_file_contains \
  "$RESULTS_DIR/progress.jsonl" \
  'pi_event_filter_failed' \
  'helper failures emit a progress event visible to callers'
assert_file_contains \
  "$RESULTS_DIR/metadata.json" \
  'kaseki-pi-event-filter' \
  'metadata records the failing helper for diagnostics'
assert_file_contains \
  "$RESULTS_DIR/pi-stderr.log" \
  'filter stderr details' \
  'helper stderr persists in the Pi stderr artifact'
assert_file_contains \
  "$RESULTS_DIR/pi-stderr.log" \
  'ERROR: kaseki-pi-event-filter failed' \
  'the persisted stderr artifact includes the user-facing helper failure banner'

mode="$(stat -c '%a' "$RESULTS_DIR/pi-stderr.log")"
if [[ "$mode" != "600" ]]; then
  fail "expected pi-stderr.log mode 600, got $mode"
fi

assert_files_equal \
  "$RAW_EVENTS" \
  "$RESULTS_DIR/pi-events.raw.jsonl" \
  'raw Pi events are preserved when the helper fails'

echo "[$TEST_NAME] PASS"
