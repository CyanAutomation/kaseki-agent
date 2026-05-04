#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="pi-event-filter-failure.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TMP_ROOT="$(mktemp -d)"
FAKE_BIN="$TMP_ROOT/bin"
mkdir -p "$FAKE_BIN" /results

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cat > "$FAKE_BIN/pi" <<'PI'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "pi 0.0.0-test"
  exit 0
fi
printf '{"type":"message","model":"fake-model"}\n'
exit 0
PI

cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'PS'
#!/usr/bin/env bash
cat
PS

cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
exit 7
EF

cat > "$FAKE_BIN/timeout" <<'TO'
#!/usr/bin/env bash
shift 2
"$@"
TO

cat > "$FAKE_BIN/npm" <<'NPM'
#!/usr/bin/env bash
exit 0
NPM

cat > "$FAKE_BIN/git" <<'GIT'
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

chmod +x "$FAKE_BIN"/*

export PATH="$FAKE_BIN:$PATH"
export OPENROUTER_API_KEY="test"
export REPO_URL="https://example.com/repo.git"
export GIT_REF="main"
export TASK_PROMPT="test"
export KASEKI_VALIDATION_COMMANDS=":"
export KASEKI_ALLOW_EMPTY_DIFF=1

set +e
bash "$REPO_ROOT/kaseki-agent.sh" >"$TMP_ROOT/stdout.log" 2>"$TMP_ROOT/stderr.log"
code=$?
set -e

if [[ "$code" -eq 0 ]]; then
  echo "[$TEST_NAME] expected non-zero exit when event filter fails"
  exit 1
fi

grep -q 'pi_event_filter_failed' /results/progress.jsonl
grep -q 'kaseki-pi-event-filter' /results/metadata.json
grep -q 'ERROR: kaseki-pi-event-filter failed' /results/pi-stderr.log

echo "[$TEST_NAME] PASS"
