#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

TEST_NAME="actual-model-metadata.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_case() {
  local case_name="$1"
  local expected_model="$2"
  local expect_warning="$3"

  rm -rf /results
  mkdir -p /results

  local tmp_root
  tmp_root="$(mktemp -d)"
  local fake_bin="$tmp_root/bin"
  mkdir -p "$fake_bin"

  cat > "$fake_bin/pi" <<'PI'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "pi 0.0.0-test"
  exit 0
fi
if [[ "${MODEL_CASE:-}" == "summary-model" ]]; then
  printf '{"type":"message","model":"event-model"}\n'
else
  printf '{"type":"message"}\n'
fi
exit 0
PI

  cat > "$fake_bin/kaseki-pi-progress-stream" <<'PS'
#!/usr/bin/env bash
cat
PS

  cat > "$fake_bin/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
if [[ "${MODEL_CASE:-}" == "summary-model" ]]; then
  cat > "$3" <<'JSON'
{"selected_model":"  gpt-4.1-mini  ","model":"fallback"}
JSON
  cat "$1" > "$2"
  exit 0
fi
cat > "$3" <<'JSON'
{"selected_model":"unknown","model":"null"}
JSON
cat "$1" > "$2"
exit 0
EF

  cat > "$fake_bin/timeout" <<'TO'
#!/usr/bin/env bash
shift 2
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

  chmod +x "$fake_bin"/*

  set +e
  env PATH="$fake_bin:$PATH" OPENROUTER_API_KEY="test" REPO_URL="https://example.com/repo.git" GIT_REF="main" TASK_PROMPT="test" KASEKI_VALIDATION_COMMANDS=":" KASEKI_ALLOW_EMPTY_DIFF=1 MODEL_CASE="$case_name" \
    bash "$REPO_ROOT/kaseki-agent.sh" >"$tmp_root/stdout.log" 2>"$tmp_root/stderr.log"
  code=$?
  set -e

  [[ "$code" -eq 0 ]] || { echo "[$TEST_NAME/$case_name] expected zero exit, got $code"; cat "$tmp_root/stderr.log" >&2; exit 1; }

  node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("/results/metadata.json","utf8"));if(m.actual_model!==process.argv[1])throw new Error(`expected ${process.argv[1]} got ${m.actual_model}`);' "$expected_model"

  if [[ "$expect_warning" == "1" ]]; then
    grep -q 'model_attribution_missing' /results/progress.jsonl
  else
    # shellcheck disable=SC2251
    ! grep -q 'model_attribution_missing' /results/progress.jsonl
  fi

  rm -rf "$tmp_root"
}

run_case "summary-model" "gpt-4.1-mini" "0"
run_case "missing-model" "unknown" "1"

echo "[$TEST_NAME] PASS"
