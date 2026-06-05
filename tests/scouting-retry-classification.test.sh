#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="scouting retry classification"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $TEST_NAME: $*" >&2; exit 1; }

run_case() {
  local case_name="$1" payload_file="$2" expected_reason="$3"
  local case_dir="$TMP_DIR/$case_name"
  local fake_repo="$case_dir/fake-repo" fake_bin="$case_dir/bin" results_dir="$case_dir/results"
  local workspace_repo="$case_dir/repo" app_lib="$case_dir/app/lib"
  local run_log="$case_dir/run.log" pi_calls="$case_dir/pi-calls.log"

  mkdir -p "$fake_repo/deps/fake-dep" "$fake_bin" "$results_dir" "$workspace_repo" "$app_lib" "$case_dir/scripts"
  : > "$pi_calls"
  cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$case_dir/scripts/allowlist-helper.sh"
  touch "$app_lib/event-aggregator.js" "$app_lib/timestamp-tracker.js" "$app_lib/progress-stream-utils.js"

  sed "s#\${KASEKI_WORKSPACE_DIR}/repo#$workspace_repo#; s#/workspace/repo#$workspace_repo#g; s#/results#$results_dir#g; s#/app/lib#$app_lib#g" "$REPO_ROOT/kaseki-agent.sh" > "$case_dir/kaseki-agent-modified.sh"
  chmod +x "$case_dir/kaseki-agent-modified.sh"

  printf '%s\n' '{"name":"fake-scouting-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$fake_repo/package.json"
  printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$fake_repo/deps/fake-dep/package.json"
  printf '%s\n' '{"name":"fake-scouting-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-scouting-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}' > "$fake_repo/package-lock.json"
  git -C "$fake_repo" init -q -b main
  git -C "$fake_repo" add package.json package-lock.json deps/fake-dep/package.json
  git -C "$fake_repo" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

  cat > "$fake_bin/pi" <<'EOF_PI'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="${*: -1}"
printf 'scouting\n' >> "__PI_CALLS__"
cat "__PAYLOAD_FILE__" > "__RESULTS_DIR__/scouting-candidate.json"
printf '{"type":"message","model":"test-model"}\n'
EOF_PI
  sed -i "s#__PI_CALLS__#$pi_calls#g; s#__PAYLOAD_FILE__#$payload_file#g; s#__RESULTS_DIR__#$results_dir#g" "$fake_bin/pi"

  cat > "$fake_bin/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
cat
EOF_PROGRESS
  cat > "$fake_bin/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
  cat > "$fake_bin/timeout" <<'EOF_TIMEOUT'
#!/usr/bin/env bash
shift 2
"$@"
EOF_TIMEOUT
  cat > "$fake_bin/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
  chmod +x "$fake_bin"/*

  set +e
  env PATH="$fake_bin:$PATH" REPO_URL="$fake_repo" GIT_REF=main TASK_PROMPT="inspect then code" OPENROUTER_API_KEY=test \
    GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off KASEKI_DEPENDENCY_CACHE_DIR="$case_dir/dependency-cache" \
    KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$case_dir/image-cache" KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check" \
    KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 bash "$case_dir/kaseki-agent-modified.sh" > "$run_log" 2>&1
  local run_exit=$?
  set -e

  [ "$run_exit" -ne 0 ] || fail "$case_name: expected non-zero exit"
  local calls
  calls="$(cat "$pi_calls" 2>/dev/null || true)"
  [ "$calls" = $'scouting' ] || fail "$case_name: scouting should run once without retry (calls=$calls)"
  [ "$(cat "$results_dir/scouting-validation-reason.txt")" = "$expected_reason" ] || fail "$case_name: reason mismatch"
  [ -s "$results_dir/scouting-validation-errors.jsonl" ] || fail "$case_name: missing scouting validation errors jsonl"
  node - "$results_dir/scouting-validation-errors.jsonl" "$expected_reason" <<'NODE' || fail "$case_name: invalid scouting validation errors jsonl"
const fs = require('node:fs');
const logPath = process.argv[2];
const expectedReason = process.argv[3];
const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\n+/).filter(Boolean);
if (!lines.length) throw new Error('expected at least one validation error line');
const entries = lines.map((line) => JSON.parse(line));
for (const entry of entries) {
  for (const key of ['timestamp', 'reason_code', 'field', 'expected', 'actual', 'severity', 'suggestion']) {
    if (!(key in entry)) throw new Error(`missing key ${key}`);
  }
  if (entry.reason_code !== expectedReason) throw new Error(`expected ${expectedReason}, got ${entry.reason_code}`);
}
if (expectedReason === 'malformed_json') {
  const entry = entries[0];
  if (entry.field !== 'root') throw new Error('malformed JSON should target root');
  if (!String(entry.actual).includes('JSON')) throw new Error('malformed JSON should capture parser error text');
  if (!String(entry.suggestion).includes('/results/scouting-candidate.json')) throw new Error('malformed JSON should include targeted candidate suggestion');
}
if (expectedReason === 'schema_mismatch' && !entries.some((entry) => entry.field === 'requirements')) {
  throw new Error('schema mismatch should identify requirements field');
}
NODE
}

MALFORMED_PAYLOAD="$TMP_DIR/malformed.json"
SCHEMA_PAYLOAD="$TMP_DIR/schema.json"
printf '%s' '{"task":' > "$MALFORMED_PAYLOAD"
printf '%s\n' '{"task":"inspect","requirements":"not-array","relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[]}' > "$SCHEMA_PAYLOAD"

run_case malformed_json "$MALFORMED_PAYLOAD" malformed_json
run_case schema_mismatch "$SCHEMA_PAYLOAD" schema_mismatch

echo "PASS: $TEST_NAME"
