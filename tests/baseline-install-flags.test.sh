#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-baseline-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

# shellcheck source=/dev/null
. "$ROOT_DIR/scripts/npm-install-helpers.sh"
eval "$(awk '/^choose_baseline_log_dir\(\)/ { emit=1 } /^checkout_baseline_repo\(\)/ { emit=0 } emit { print }' "$ROOT_DIR/kaseki-agent.sh")"
eval "$(awk '/^checkout_baseline_repo\(\)/ { emit=1 } /^run_baseline_validation\(\)/ { if (emit) exit; emit=0 } emit { print }' "$ROOT_DIR/kaseki-agent.sh")"

FAKE_BIN="$TMP_DIR/bin"
FAKE_BASELINE_SOURCE="$TMP_DIR/source"
mkdir -p "$FAKE_BIN" "$FAKE_BASELINE_SOURCE" "$TMP_DIR/workspace/repo" "$TMP_DIR/results" "$TMP_DIR/logs"
printf '%s\n' '{"name":"baseline-fixture","version":"1.0.0"}' > "$FAKE_BASELINE_SOURCE/package.json"

cat > "$FAKE_BIN/git" <<'EOF_GIT'
#!/usr/bin/env bash
if [ "${1:-}" != "clone" ]; then exit 2; fi
target=""
for arg in "$@"; do target="$arg"; done
mkdir -p "$target"
cp -R "$FAKE_BASELINE_SOURCE/." "$target/"
EOF_GIT
cat > "$FAKE_BIN/npm" <<'EOF_NPM'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$FAKE_NPM_ARGS"
exit "${FAKE_NPM_EXIT:-0}"
EOF_NPM
chmod +x "$FAKE_BIN/git" "$FAKE_BIN/npm"

emit_progress() { :; }
emit_error_event() { :; }
KASEKI_WORKSPACE_BASELINE_DIR="$TMP_DIR/baseline"
KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_LOG_DIR="$TMP_DIR/logs"
REPO_URL="$FAKE_BASELINE_SOURCE"
export FAKE_BASELINE_SOURCE FAKE_NPM_ARGS="$TMP_DIR/npm-args" PATH="$FAKE_BIN:$PATH"

KASEKI_NPM_OMIT_DEV=0
KASEKI_INSTALL_IGNORE_SCRIPTS=1
export KASEKI_NPM_OMIT_DEV KASEKI_INSTALL_IGNORE_SCRIPTS
checkout_baseline_repo
[ "$(cat "$FAKE_NPM_ARGS")" = 'ci --prefer-offline --ignore-scripts' ] || {
  printf '✗ baseline npm install did not use Kaseki install flags: %s\n' "$(cat "$FAKE_NPM_ARGS")" >&2
  exit 1
}

KASEKI_NPM_OMIT_DEV=1
KASEKI_INSTALL_IGNORE_SCRIPTS=0
export KASEKI_NPM_OMIT_DEV KASEKI_INSTALL_IGNORE_SCRIPTS
checkout_baseline_repo
[ "$(cat "$FAKE_NPM_ARGS")" = 'ci --prefer-offline --omit=dev' ] || {
  printf '✗ baseline npm install ignored configured dependency flags: %s\n' "$(cat "$FAKE_NPM_ARGS")" >&2
  exit 1
}

FAKE_NPM_EXIT=1
export FAKE_NPM_EXIT
BASELINE_SETUP_FAILURE_REASON=""
if checkout_baseline_repo; then
  printf '✗ baseline setup unexpectedly passed a failed npm ci\n' >&2
  exit 1
fi
[ "$BASELINE_SETUP_FAILURE_REASON" = 'dependency_install_failed' ] || {
  printf '✗ baseline install failure reason was not retained: %s\n' "$BASELINE_SETUP_FAILURE_REASON" >&2
  exit 1
}

printf '✓ Baseline install mirrors production npm flags and distinguishes setup failures.\n'
