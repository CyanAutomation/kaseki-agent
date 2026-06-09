#!/usr/bin/env bash
# Regression test: baseline checkout logging must not redirect into an unavailable host log directory.

set -euo pipefail

TEST_NAME="baseline log dir fallback"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
RUN_LOG="$TMP_DIR/kaseki-run.log"
PI_MARKER="$TMP_DIR/pi-invoked.log"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
    echo "--- kaseki run log ---" >&2
    tail -120 "$RUN_LOG" >&2 || true
  fi
  exit 1
}

mkdir -p "$FAKE_REPO" "$FAKE_BIN" "$RESULTS_DIR"

cat > "$FAKE_REPO/README.md" <<'README'
# fake repo
README

git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add README.md
git -C "$FAKE_REPO" \
  -c user.email=kaseki-test@example.invalid \
  -c user.name="Kaseki Test" \
  commit -q -m "initial fake repo"

cat > "$FAKE_BIN/validation-output-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat
EOF_FILTER
chmod +x "$FAKE_BIN/validation-output-filter"

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
echo "pi invoked: \$*" >> "$PI_MARKER"
exit 97
EOF_PI
chmod +x "$FAKE_BIN/pi"

set +e
env \
  KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace" \
  KASEKI_WORKSPACE_BASELINE_DIR="$TMP_DIR/workspace/baseline" \
  KASEKI_RESULTS_DIR="$RESULTS_DIR" \
  KASEKI_CACHE_DIR="$TMP_DIR/cache" \
  KASEKI_LOG_DIR="/proc/kaseki-missing-log-dir" \
  PATH="$FAKE_BIN:$PATH" \
  REPO_URL="$FAKE_REPO" \
  GIT_REF="main" \
  OPENROUTER_API_KEY="test-key-not-used" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_GIT_CACHE_MODE=off \
  KASEKI_BASELINE_VALIDATION_ENABLED=1 \
  KASEKI_BASELINE_CACHE_DISABLED=1 \
  KASEKI_PRE_AGENT_VALIDATION=1 \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS="false" \
  KASEKI_VALIDATION_COMMANDS="false" \
  KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" \
  KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  bash "$SCRIPT_UNDER_TEST" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

if [ "$run_exit" -ne 1 ]; then
  fail "expected kaseki-agent.sh to exit with validation status 1, got $run_exit"
fi

if grep -q 'baseline-checkout\.log: No such file or directory' "$RUN_LOG"; then
  fail "baseline checkout still redirects to unavailable KASEKI_LOG_DIR"
fi

if ! [ -f "$RESULTS_DIR/baseline-checkout.log" ]; then
  fail "expected baseline checkout log in KASEKI_RESULTS_DIR"
fi

if [ -s "$PI_MARKER" ]; then
  fail "pi executable should not be invoked after failing pre-agent validation"
fi

echo "✓ PASS: $TEST_NAME"
