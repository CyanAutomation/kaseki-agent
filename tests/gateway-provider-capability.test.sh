#!/usr/bin/env bash
# Regression test: gateway provider registration is checked before Pi agent phases.

set -euo pipefail

TEST_NAME="gateway provider capability preflight"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$REPO_ROOT/kaseki-agent.sh"
TMP_DIR="$(mktemp -d)"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
PI_CALLS="$TMP_DIR/pi-calls.log"
RUN_LOG="$TMP_DIR/kaseki-run.log"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "✗ FAIL: $TEST_NAME: $*" >&2
  if [ -f "$RUN_LOG" ]; then
test_provider_capability() {
    local provider="${1:-anthropic}"
    local model="${2:-claude-3-sonnet}"
    
    # Validate inputs contain only safe characters
    if [[ ! "$provider" =~ ^[a-zA-Z0-9_-]+$ ]] || [[ ! "$model" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        echo "Error: Invalid provider or model name format"
        return 1
    fi
    
    echo "Testing provider capability: $provider with model: $model"
    
    local response
    response=$(curl -s -X POST "" \
  fi
  exit 1
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  if ! [ -f "$file" ]; then
    fail "expected file $file does not exist"
  fi
  if ! grep -qE "$pattern" "$file"; then
    fail "expected $file to contain pattern: $pattern"
  fi
}

mkdir -p "$FAKE_BIN" "$RESULTS_DIR" "$TMP_DIR/pi-extensions" "$TMP_DIR/home/.pi/extensions"

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$PI_CALLS"
case "\${1:-}" in
  --version)
    printf '%s\n' 'pi 9.9.9-test'
    exit 0
    ;;
  --list-models)
    printf '%s\n' 'openrouter'
    printf '%s\n' 'anthropic'
    exit 0
    ;;
  *)
    printf '%s\n' "unexpected pi agent invocation: \$*" >&2
    exit 97
    ;;
esac
EOF_PI
chmod +x "$FAKE_BIN/pi"

set +e
env \
  PATH="$FAKE_BIN:$PATH" \
  HOME="$TMP_DIR/home" \
  PI_EXTENSIONS_DIR="$TMP_DIR/pi-extensions" \
  KASEKI_RESULTS_DIR="$RESULTS_DIR" \
  KASEKI_PROVIDER=gateway \
  KASEKI_MODEL=auto \
  LLM_GATEWAY_URL="https://gateway.example.invalid/v1/responses" \
  LLM_GATEWAY_API_KEY="test-key-not-used" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_DRY_RUN=0 \
  bash "$SCRIPT_UNDER_TEST" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 2 ] || fail "expected setup failure exit 2, got $run_exit"

assert_file_contains "$RUN_LOG" 'Provider capability check failed for KASEKI_PROVIDER=gateway'
assert_file_contains "$RUN_LOG" 'worker image/Pi extension did not register gateway'
assert_file_contains "$RUN_LOG" 'before goal-setting/scouting/coding'
assert_file_contains "$RESULTS_DIR/pi-stderr.log" 'Provider capability check failed'
assert_file_contains "$RESULTS_DIR/progress.jsonl" 'gateway_provider_not_registered'

if grep -Eq 'goal-setting|scouting|coding|--mode json' "$PI_CALLS"; then
  fail "Pi agent phase was invoked despite missing gateway registration: $(cat "$PI_CALLS")"
fi

node - "$RESULTS_DIR/provider-capability.json" "$TMP_DIR/pi-extensions" "$TMP_DIR/home/.pi/extensions" <<'NODE' || fail "provider capability artifact did not contain expected diagnostics"
const fs = require('node:fs');
const artifact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedExtensions = process.argv[3];
const expectedHomeExtensions = process.argv[4];
const failures = [];
if (artifact.ok !== false) failures.push(`ok=${artifact.ok}`);
if (artifact.provider !== 'gateway') failures.push(`provider=${artifact.provider}`);
if (artifact.command !== 'pi --list-models') failures.push(`command=${artifact.command}`);
if (artifact.exit_code !== 0) failures.push(`exit_code=${artifact.exit_code}`);
if (!String(artifact.pi_version).includes('pi 9.9.9-test')) failures.push(`pi_version=${artifact.pi_version}`);
if (artifact.extension_paths_checked?.PI_EXTENSIONS_DIR !== expectedExtensions) {
  failures.push(`PI_EXTENSIONS_DIR=${artifact.extension_paths_checked?.PI_EXTENSIONS_DIR}`);
}
if (artifact.extension_paths_checked?.HOME_PI_EXTENSIONS !== expectedHomeExtensions) {
  failures.push(`HOME_PI_EXTENSIONS=${artifact.extension_paths_checked?.HOME_PI_EXTENSIONS}`);
}
if (!String(artifact.remediation).includes('did not register provider gateway')) failures.push(`remediation=${artifact.remediation}`);
if (String(artifact.output_tail).includes('gateway')) failures.push('output_tail unexpectedly contains gateway');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
NODE

echo "✓ PASS: $TEST_NAME"
