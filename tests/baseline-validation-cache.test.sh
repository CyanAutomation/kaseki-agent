#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-baseline-cache.XXXXXX")"
cleanup() {
  local test_status=$?
  trap - EXIT
  if ! rm -rf -- "$TMP_DIR"; then
    printf '✗ failed to remove test directory: %s\n' "$TMP_DIR" >&2
    exit 1
  fi
  exit "$test_status"
}
trap cleanup EXIT
. "$ROOT_DIR/scripts/npm-install-helpers.sh"
. "$ROOT_DIR/scripts/validation-command-preflight.sh"
eval "$(awk '/^baseline_validation_cache_key\(\)/ { emit=1 } /^choose_baseline_log_dir\(\)/ { if (emit) exit } emit { print }' "$ROOT_DIR/kaseki-agent.sh")"

fail() { printf '✗ %s\n' "$*" >&2; exit 1; }
REAL_NODE="$(command -v node)"
FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN" "$TMP_DIR/results"
cat > "$FAKE_BIN/node" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then printf '%s\n' "${FAKE_NODE_VERSION:-v24.0.0}"; else exec "$REAL_NODE" "$@"; fi
EOF
cat > "$FAKE_BIN/npm" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then printf '%s\n' "${FAKE_NPM_VERSION:-11.0.0}"; else exit 2; fi
EOF
cat > "$FAKE_BIN/go" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "version" ]; then printf 'go version %s linux/amd64\n' "${FAKE_GO_VERSION:-go1.24.0}"; else exit 2; fi
EOF
cat > "$FAKE_BIN/make" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then printf 'GNU Make %s\n' "${FAKE_MAKE_VERSION:-4.4}"; else exit 2; fi
EOF
chmod +x "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/go" "$FAKE_BIN/make"
export REAL_NODE PATH="$FAKE_BIN:$PATH"

REPO_URL="https://example.invalid/repository.git"
BASELINE_RESOLVED_REF="trunk"
BASELINE_COMMIT_SHA="1111111111111111111111111111111111111111"
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm test"
BASELINE_VALIDATION_EXIT=0
KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_BASELINE_CACHE_ROOT="$TMP_DIR/cache"
KASEKI_BASELINE_CACHE_MAX_AGE_HOURS=24
KASEKI_BASELINE_CACHE_DISABLED=0
KASEKI_NPM_OMIT_DEV=0 KASEKI_INSTALL_IGNORE_SCRIPTS=0
KASEKI_SKIP_MISSING_NPM_SCRIPTS=1 KASEKI_VALIDATION_FAIL_FAST=1
KASEKI_VALIDATION_RUN_ALL_COMMANDS=0 KASEKI_VALIDATION_TIMEOUT_SECONDS=300
KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS=900
export REPO_URL BASELINE_RESOLVED_REF BASELINE_COMMIT_SHA KASEKI_PRE_AGENT_VALIDATION_COMMANDS
export KASEKI_SKIP_MISSING_NPM_SCRIPTS KASEKI_VALIDATION_FAIL_FAST KASEKI_VALIDATION_RUN_ALL_COMMANDS
export KASEKI_VALIDATION_TIMEOUT_SECONDS KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS
export BASELINE_VALIDATION_EXIT

grep -q 'record_stage_timing "dependency cache publish"' "$ROOT_DIR/kaseki-agent.sh" || fail 'dependency cache publish duration is not recorded'
grep -q 'workspace_cache_publish' "$ROOT_DIR/kaseki-agent.sh" || fail 'dependency cache publish metric is not emitted'

printf 'visible\n' > "$KASEKI_RESULTS_DIR/validation-baseline.log"
printf 'raw\n' > "$KASEKI_RESULTS_DIR/validation-baseline-raw.log"
printf 'timing\n' > "$KASEKI_RESULTS_DIR/validation-baseline-timings.tsv"
original_key="$(baseline_validation_cache_key)"
original_dir="$(baseline_validation_cache_dir)"
save_baseline_validation_to_cache "$original_dir" || fail 'could not save cache fixture'
rm -f "$KASEKI_RESULTS_DIR"/validation-baseline*.log "$KASEKI_RESULTS_DIR"/validation-baseline-timings.tsv
restore_baseline_validation_from_cache "$original_dir" || fail 'same SHA and inputs did not produce a cache hit'
cp "$original_dir/manifest.json" "$TMP_DIR/manifest.json"
printf '%s\n' '{"schema_version":999}' > "$original_dir/manifest.json"
if restore_baseline_validation_from_cache "$original_dir"; then
  fail 'cache with an invalid manifest schema was restored'
fi
cp "$TMP_DIR/manifest.json" "$original_dir/manifest.json"

BASELINE_COMMIT_SHA="2222222222222222222222222222222222222222"
[ "$(baseline_validation_cache_key)" != "$original_key" ] || fail 'baseline SHA did not invalidate the key'
[ ! -d "$(baseline_validation_cache_dir)" ] || fail 'baseline SHA unexpectedly hit cache'
BASELINE_COMMIT_SHA="1111111111111111111111111111111111111111"
FAKE_NODE_VERSION=v26.0.0; export FAKE_NODE_VERSION
[ "$(baseline_validation_cache_key)" != "$original_key" ] || fail 'Node runtime identity did not invalidate the key'
unset FAKE_NODE_VERSION
FAKE_GO_VERSION=go1.26.0; export FAKE_GO_VERSION
[ "$(baseline_validation_cache_key)" != "$original_key" ] || fail 'Go toolchain identity did not invalidate the key'
unset FAKE_GO_VERSION
FAKE_MAKE_VERSION=4.5; export FAKE_MAKE_VERSION
[ "$(baseline_validation_cache_key)" != "$original_key" ] || fail 'Make toolchain identity did not invalidate the key'
unset FAKE_MAKE_VERSION
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run build;npm test"; export KASEKI_PRE_AGENT_VALIDATION_COMMANDS
[ "$(baseline_validation_cache_key)" != "$original_key" ] || fail 'validation commands did not invalidate the key'

BASELINE_VALIDATION_EXIT=127
unreliable_cache_dir="$TMP_DIR/unreliable-cache"
if save_baseline_validation_to_cache "$unreliable_cache_dir"; then
  fail 'command-not-found baseline result was cached'
fi
[ ! -e "$unreliable_cache_dir/manifest.json" ] || fail 'infrastructure failure left a cache manifest'

printf '✓ Baseline cache hits only for matching commit and validation inputs.\n'
