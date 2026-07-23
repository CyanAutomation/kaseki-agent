#!/usr/bin/env bash
# Integration test: exit-code-86 diagnostics are emitted by the Kaseki scouting
# artifact validation path, not by a standalone chmod writability probe.

set -euo pipefail

TEST_NAME="exit-code-86-diagnostics"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
FAKE_REPO="$TMP_DIR/fake-repo"
FAKE_BIN="$TMP_DIR/bin"
RESULTS_DIR="$TMP_DIR/results"
WORKSPACE_REPO="$TMP_DIR/repo"
APP_LIB="$TMP_DIR/app/lib"
RUN_LOG="$TMP_DIR/kaseki-run.log"
PI_CALLS="$TMP_DIR/pi-calls.log"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- $TEST_NAME run log ---" >&2
    tail -120 "$RUN_LOG" 2>/dev/null >&2 || true
    echo "--- results stderr ---" >&2
    tail -120 "$RESULTS_DIR/stderr.log" 2>/dev/null >&2 || true
    echo "--- results stdout ---" >&2
    tail -80 "$RESULTS_DIR/stdout.log" 2>/dev/null >&2 || true
    echo "--- scouting validation errors ---" >&2
    cat "$RESULTS_DIR/scouting-validation-errors.jsonl" 2>/dev/null >&2 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $TEST_NAME: $*" >&2
  exit 1
}

mkdir -p "$FAKE_REPO/deps/fake-dep" "$FAKE_BIN" "$RESULTS_DIR" "$WORKSPACE_REPO" "$APP_LIB" "$TMP_DIR/scripts/lib"
cp "$REPO_ROOT/scripts/allowlist-helper.sh" "$TMP_DIR/scripts/allowlist-helper.sh"
cat > "$TMP_DIR/scripts/scouting-allowlist.js" <<'EOF_SCOUTING_ALLOWLIST'
#!/usr/bin/env node
const fs = require('node:fs');
const [, , command, candidatePath, finalPath, errorPath, jsonlPath] = process.argv;
if (command !== 'validate') process.exit(2);
let artifact;
try { artifact = JSON.parse(fs.readFileSync(candidatePath, 'utf8')); } catch (error) {
  const out = { reason_code: 'malformed_json', details: String(error.message || error) };
  fs.writeFileSync(errorPath, JSON.stringify(out));
  fs.appendFileSync(jsonlPath, JSON.stringify({ ...out, field: 'scouting-candidate.json', severity: 'critical' }) + '\n');
  process.exit(1);
}
const required = ['task', 'requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];
const missing = required.filter((key) => !(key in artifact));
if (missing.length) {
  const out = { reason_code: 'schema_mismatch', details: `missing required fields: ${missing.join(', ')}` };
  fs.writeFileSync(errorPath, JSON.stringify(out));
  fs.appendFileSync(jsonlPath, JSON.stringify({ ...out, field: 'scouting-candidate.json', severity: 'critical' }) + '\n');
  process.exit(1);
}
fs.writeFileSync(finalPath, JSON.stringify(artifact, null, 2) + '\n');
process.exit(0);
EOF_SCOUTING_ALLOWLIST
chmod +x "$TMP_DIR/scripts/scouting-allowlist.js"
cp "$REPO_ROOT/scripts/lib/json.sh" "$TMP_DIR/scripts/lib/json.sh"
cp "$REPO_ROOT/scripts/lib/json-events.sh" "$TMP_DIR/scripts/lib/json-events.sh"
cp "$REPO_ROOT/scripts/lib/artifact-consolidation.sh" "$TMP_DIR/scripts/lib/artifact-consolidation.sh"
cp "$REPO_ROOT/scripts/dependency-cache-helpers.sh" "$TMP_DIR/scripts/dependency-cache-helpers.sh"
cp "$REPO_ROOT/scripts/npm-install-helpers.sh" "$TMP_DIR/scripts/npm-install-helpers.sh"
cp "$REPO_ROOT/scripts/agent-prompt.sh" "$TMP_DIR/scripts/agent-prompt.sh"
touch "$APP_LIB/event-aggregator.js" "$APP_LIB/timestamp-tracker.js" "$APP_LIB/progress-stream-utils.js"

MODIFIED_SCRIPT="$TMP_DIR/kaseki-agent-modified.sh"
sed "s#\"\${KASEKI_WORKSPACE_DIR}\"/repo#$WORKSPACE_REPO#g; s#\${KASEKI_WORKSPACE_DIR}/repo#$WORKSPACE_REPO#g; s#/workspace/repo#$WORKSPACE_REPO#g; s#/results#$RESULTS_DIR#g; s#/app/lib#$APP_LIB#g; s#/app/scripts#$TMP_DIR/scripts#g" "$REPO_ROOT/kaseki-agent.sh" > "$MODIFIED_SCRIPT"
chmod +x "$MODIFIED_SCRIPT"
"$REPO_ROOT/tests/helpers/stage-scouting-templates.sh" "$REPO_ROOT" "$MODIFIED_SCRIPT"
: > "$PI_CALLS"

printf '%s\n' '{"name":"fake-exit86-repo","version":"1.0.0","private":true,"scripts":{"check":"exit 0"},"dependencies":{"fake-dep":"file:deps/fake-dep"}}' > "$FAKE_REPO/package.json"
printf '%s\n' '{"name":"fake-dep","version":"1.0.0","private":true}' > "$FAKE_REPO/deps/fake-dep/package.json"
cat > "$FAKE_REPO/package-lock.json" <<'JSON'
{"name":"fake-exit86-repo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"fake-exit86-repo","version":"1.0.0","dependencies":{"fake-dep":"file:deps/fake-dep"}},"deps/fake-dep":{"version":"1.0.0"},"node_modules/fake-dep":{"resolved":"deps/fake-dep","link":true}}}
JSON
git -C "$FAKE_REPO" init -q -b main
git -C "$FAKE_REPO" add package.json package-lock.json deps/fake-dep/package.json
git -C "$FAKE_REPO" -c user.email=kaseki-test@example.invalid -c user.name="Kaseki Test" commit -q -m initial

cat > "$FAKE_BIN/pi" <<EOF_PI
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
if [ "\${1:-}" = "--list-models" ]; then echo "gateway/dynamic/kaseki-agent"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "\$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "$PI_CALLS"
  # Deliberately omit required scouting fields to drive validate_scouting_artifact
  # through the real schema-mismatch / exit-code-86 path.
  printf '%s\n' '{"task":"inspect"}' > "$RESULTS_DIR/scouting-candidate.json"
else
  printf 'unexpected\n' >> "$PI_CALLS"
fi
printf '{"type":"message","model":"test-model"}\n'
EOF_PI
cat > "$FAKE_BIN/kaseki-pi-progress-stream" <<'EOF_PROGRESS'
#!/usr/bin/env bash
progress_file="${1:-/tmp/progress.jsonl}"
cat > /dev/null
printf '%s\n' '{"stage":"pi scouting agent","message":"synthetic progress event"}' >> "$progress_file"
EOF_PROGRESS
cat > "$FAKE_BIN/kaseki-pi-event-filter" <<'EOF_FILTER'
#!/usr/bin/env bash
cat "$1" > "$2"
printf '{"selected_model":"test-model"}\n' > "$3"
EOF_FILTER
cat > "$FAKE_BIN/timeout" <<'EOF_TIMEOUT'
#!/usr/bin/env bash
shift 2
"$@"
EOF_TIMEOUT
cat > "$FAKE_BIN/validation-output-filter" <<'EOF_VALIDATION_FILTER'
#!/usr/bin/env bash
cat
EOF_VALIDATION_FILTER
chmod +x "$FAKE_BIN"/*

set +e
env PATH="$FAKE_BIN:$PATH" REPO_URL="$FAKE_REPO" GIT_REF=main TASK_PROMPT="inspect repository" \
  OPENROUTER_API_KEY=test LLM_GATEWAY_URL=https://example.invalid/v1 LLM_GATEWAY_API_KEY=test GITHUB_APP_ENABLED=0 KASEKI_GIT_CACHE_MODE=off \
  KASEKI_WORKSPACE_DIR="$TMP_DIR" KASEKI_DEPENDENCY_CACHE_DIR="$TMP_DIR/dependency-cache" KASEKI_IMAGE_DEPENDENCY_CACHE_DIR="$TMP_DIR/image-cache" \
  KASEKI_TASK_MODE=inspect KASEKI_SCOUTING=1 KASEKI_GOAL_SETTING=0 KASEKI_GOAL_CHECK=0 KASEKI_RUN_EVALUATION=0 KASEKI_BASELINE_VALIDATION_ENABLED=0 \
  KASEKI_PRE_AGENT_VALIDATION_COMMANDS=":" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 \
  bash "$MODIFIED_SCRIPT" > "$RUN_LOG" 2>&1
run_exit=$?
set -e

[ "$run_exit" -eq 86 ] || fail "expected exit 86 from scouting artifact validation, got $run_exit"
[ "$(cat "$PI_CALLS")" = "scouting" ] || fail "expected only scouting Pi to run before failure"

node - "$RESULTS_DIR" <<'NODE' || fail "artifact assertions failed"
const fs = require('node:fs');
const path = require('node:path');
const resultsDir = process.argv[2];
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(resultsDir, name), 'utf8'));
const metadata = readJson('metadata.json');
const failure = readJson('failure.json');
const validationLines = fs.readFileSync(path.join(resultsDir, 'scouting-validation-errors.jsonl'), 'utf8').trim().split(/\n+/).map(JSON.parse);
const progress = fs.readFileSync(path.join(resultsDir, 'progress.jsonl'), 'utf8');
const errors = [];
if (metadata.exit_code !== 86) errors.push(`metadata.exit_code=${metadata.exit_code}`);
if (metadata.scouting_exit_code !== 86) errors.push(`metadata.scouting_exit_code=${metadata.scouting_exit_code}`);
if (metadata.failed_command !== 'pi scouting agent') errors.push(`metadata.failed_command=${JSON.stringify(metadata.failed_command)}`);
if (metadata.filesystem_diagnostics?.check_status !== 'writable') errors.push(`filesystem check=${JSON.stringify(metadata.filesystem_diagnostics)}`);
if (metadata.filesystem_diagnostics?.suggests_docker_run_fix !== false) errors.push('filesystem diagnostic should not claim a docker run fix for schema mismatch');
if (failure.exit_code !== 86) errors.push(`failure.exit_code=${failure.exit_code}`);
if (failure.failed_command !== 'pi scouting agent') errors.push(`failure.failed_command=${JSON.stringify(failure.failed_command)}`);
if (!String(failure.diagnostic_reason || '').includes('schema_mismatch')) errors.push(`failure.diagnostic_reason=${JSON.stringify(failure.diagnostic_reason)}`);
if (!validationLines.some((entry) => entry.reason_code === 'schema_mismatch' && entry.field === 'scouting-candidate.json' && entry.severity === 'critical')) {
  errors.push('missing critical schema_mismatch scouting validation artifact');
}
if (!progress.includes('pi_scouting_artifact_invalid') || !progress.includes('pi_scouting_failed')) {
  errors.push('progress.jsonl missing scouting failure error events');
}
if (errors.length) throw new Error(errors.join('\n'));
NODE

echo "PASS: $TEST_NAME"
