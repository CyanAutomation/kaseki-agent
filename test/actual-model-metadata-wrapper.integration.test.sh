#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="actual-model-metadata-wrapper.integration.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${KASEKI_RUN_WRAPPER_INTEGRATION_TESTS:-0}" != "1" ]]; then
  echo "[$TEST_NAME] SKIP set KASEKI_RUN_WRAPPER_INTEGRATION_TESTS=1 to run wrapper integration smoke"
  exit 0
fi

tmp_root="$(mktemp -d)"
cleanup() {
  if [[ "${KASEKI_KEEP_TEST_ARTIFACTS:-0}" != "1" && -n "$tmp_root" ]]; then
    rm -rf "$tmp_root"
  fi
}
trap cleanup EXIT


run_wrapper_smoke() {
  local results_dir="$tmp_root/results"
  local results_dir="$tmp_root/results"
  mkdir -p "$results_dir"
  local fake_bin="$tmp_root/bin"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "pi 0.0.0-test"
  exit 0
fi
if [[ "${1:-}" == "--list-models" ]]; then
  echo "gateway/event-smoke-model"
  exit 0
fi
printf '{"type":"message","model":"event-smoke-model"}\n'
exit 0
PI

  cat > "$fake_bin/kaseki-pi-progress-stream" <<'PS'
#!/usr/bin/env bash
cat
PS

  cat > "$fake_bin/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
cat > "$3" <<'JSON'
{"selected_model":"summary-smoke-model","model":"fallback"}
JSON
cat "$1" > "$2"
exit 0
EF

  cat > "$fake_bin/validation-output-filter" <<'VOF'
#!/usr/bin/env bash
cat
VOF

  cat > "$fake_bin/timeout" <<'TO'
#!/usr/bin/env bash
while [[ "${1:-}" == -* ]]; do
  if [[ "${1:-}" == "-s" || "${1:-}" == "--signal" ]]; then
    shift 2
  else
    shift
  fi
done
shift
"$@"
TO

  cat > "$fake_bin/npm" <<'NPM'
#!/usr/bin/env bash
exit 0
NPM

  cat > "$fake_bin/git" <<'GIT'
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

  local fake_lib="$tmp_root/lib"
  mkdir -p "$fake_lib"
  touch "$fake_lib/event-aggregator.js" "$fake_lib/timestamp-tracker.js" "$fake_lib/progress-stream-utils.js"

  chmod +x "$fake_bin"/*

  set +e
  env PATH="$fake_bin:$PATH" KASEKI_RESULTS_DIR="$results_dir" KASEKI_LOG_DIR="$results_dir" KASEKI_APP_LIB_DIR="$fake_lib" OPENROUTER_API_KEY="test" GITHUB_APP_ENABLED=0 LLM_GATEWAY_URL="https://example.invalid/v1" LLM_GATEWAY_API_KEY="test" REPO_URL="https://example.com/repo.git" GIT_REF="main" TASK_PROMPT="test" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 KASEKI_SCOUTING=0 KASEKI_GOAL_CHECK=0 KASEKI_HASHLINE_EDITS=0 \
    bash "$REPO_ROOT/kaseki-agent.sh" >"$tmp_root/stdout.log" 2>"$tmp_root/stderr.log"
  code=$?
  set -e

  [[ "$code" -eq 0 ]] || { echo "[$TEST_NAME/wrapper-smoke] expected zero exit, got $code"; cat "$tmp_root/stderr.log" >&2; exit 1; }

  node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(m.actual_model!=="event-smoke-model")throw new Error(`expected event-smoke-model got ${m.actual_model}`);' "$results_dir/metadata.json"
  ! grep -q 'model_attribution_missing' "$results_dir/progress.jsonl"

  rm -rf "$tmp_root"
}

run_wrapper_smoke

echo "[$TEST_NAME] PASS"
