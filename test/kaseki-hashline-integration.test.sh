#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

TEST_NAME="kaseki-hashline-integration.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tmp_root=""
cleanup() {
  [ "${KASEKI_KEEP_TEST_ARTIFACTS:-0}" = "1" ] && return 0
  rm -rf "$tmp_root" /results /workspace/repo 2>/dev/null || true
}
trap cleanup EXIT

hash8() {
  printf '%s' "$1" | sha256sum | cut -c1-8
}

assert_file_contains() {
  local file="$1"
  local pattern="$2"
  if ! grep -q "$pattern" "$file" 2>/dev/null; then
    echo "[$TEST_NAME] expected $file to contain $pattern" >&2
    return 1
  fi
}

assert_json_number() {
  local file="$1"
  local expr="$2"
  local expected="$3"
  local actual
  actual=$(jq -r "$expr" "$file")
  if [ "$actual" != "$expected" ]; then
    echo "[$TEST_NAME] expected $expr in $file to be $expected, got $actual" >&2
    return 1
  fi
}

main() {
  cleanup
  tmp_root="$(mktemp -d)"
  mkdir -p /results "$tmp_root/bin" "$tmp_root/lib"

  local target_line target_hash
  target_line='  return 42;'
  target_hash="$(hash8 "$target_line")"

  cat > "$tmp_root/bin/git" <<'GIT'
#!/usr/bin/env bash
case "${1:-}" in
  clone)
    dest="${@: -1}"
    rm -rf "$dest"
    mkdir -p "$dest"
    cat > "$dest/src.js" <<'SRC'
function answer() {
  return 42;
}
SRC
    exit 0
    ;;
  -C)
    case "${3:-}" in
      rev-parse) echo "abc123"; exit 0 ;;
      diff|status|config|add|commit|checkout) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  rev-parse) echo "abc123"; exit 0 ;;
  diff|status|config|add|commit|checkout) exit 0 ;;
  *) exit 0 ;;
esac
GIT

  cat > "$tmp_root/bin/pi" <<'PI'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "pi 0.0.0-test"
  exit 0
fi
cat <<'EVENTS'
{"type":"assistantMessage","assistantMessageEvent":{"type":"message","partial":{"content":[{"type":"text","text":"Applying hashline edit"}]}}}
{"type":"tool_call","tool_name":"hashline_edit","call":{"file":"repo/src.js","anchor":{"start_hash":"__TARGET_HASH__","end_hash":"__TARGET_HASH__","context_lines":2},"replacement":"  return 43;"}}
EVENTS
exit 0
PI
  sed -i "s/__TARGET_HASH__/$target_hash/g" "$tmp_root/bin/pi"

  cat > "$tmp_root/bin/kaseki-pi-progress-stream" <<'PS'
#!/usr/bin/env bash
cat
PS

  cat > "$tmp_root/bin/kaseki-pi-event-filter" <<'EF'
#!/usr/bin/env bash
cat "$1" > "$2"
cat > "$3" <<'JSON'
{"selected_model":"test-model","model":"test-model"}
JSON
EF

  cat > "$tmp_root/bin/timeout" <<'TO'
#!/usr/bin/env bash
if [[ "${1:-}" == --signal=* ]]; then
  shift
fi
shift
"$@"
TO

  cat > "$tmp_root/bin/validation-output-filter" <<'VOF'
#!/usr/bin/env bash
cat
VOF

  cat > "$tmp_root/bin/npm" <<'NPM'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo "0.0.0-test"; fi
exit 0
NPM

  cat > "$tmp_root/bin/npx" <<NPX
#!/usr/bin/env bash
if [[ "\${1:-}" == "tsx" ]]; then
  shift
  exec "$REPO_ROOT/node_modules/.bin/tsx" "\$@"
fi
echo "unexpected npx invocation: \$*" >&2
exit 127
NPX

  chmod +x "$tmp_root/bin"/*

  touch "$tmp_root/lib/event-aggregator.js" "$tmp_root/lib/timestamp-tracker.js" "$tmp_root/lib/progress-stream-utils.js"
  cat > "$tmp_root/lib/hashline-event-handler-cli.js" <<CLI
import '$REPO_ROOT/src/hashline-event-handler-cli.ts';
CLI

  set +e
  env PATH="$tmp_root/bin:$PATH" \
    OPENROUTER_API_KEY="test-key-not-used" \
    LLM_GATEWAY_URL="https://gateway.invalid/v1/responses" \
    LLM_GATEWAY_API_KEY="test-key-not-used" \
    KASEKI_PROVIDER="openrouter" \
    REPO_URL="https://example.com/repo.git" \
    GIT_REF="main" \
    TASK_PROMPT="exercise hashline boundary" \
    KASEKI_APP_LIB_DIR="$tmp_root/lib" \
    KASEKI_VALIDATION_COMMANDS=":" \
    KASEKI_PRE_AGENT_VALIDATION=0 \
    KASEKI_BASELINE_VALIDATION_ENABLED=0 \
    KASEKI_TS_PRE_CHECK=0 \
    KASEKI_SCOUTING=0 \
    KASEKI_GOAL_SETTING=0 \
    KASEKI_GOAL_CHECK=0 \
    KASEKI_RUN_EVALUATION=0 \
    GITHUB_APP_ENABLED=0 \
    KASEKI_ALLOW_EMPTY_DIFF=1 \
    KASEKI_GIT_CACHE_MODE=off \
    bash "$REPO_ROOT/kaseki-agent.sh" >"$tmp_root/stdout.log" 2>"$tmp_root/stderr.log"
  local code=$?
  set -e

  if [ "$code" -ne 0 ]; then
    echo "[$TEST_NAME] expected kaseki-agent.sh to exit 0, got $code" >&2
    cat "$tmp_root/stderr.log" >&2
    exit 1
  fi

  [ -f /results/hashline-events.jsonl ] || { echo "[$TEST_NAME] missing hashline-events.jsonl" >&2; cat /results/hashline-validation.log 2>/dev/null >&2 || true; exit 1; }
  [ -f /results/hashline-summary.json ] || { echo "[$TEST_NAME] missing hashline-summary.json" >&2; exit 1; }
  assert_json_number /results/hashline-summary.json '.applied' '1'
  assert_json_number /results/hashline-summary.json '.rejected' '0'
  assert_file_contains /workspace/repo/src.js 'return 43;'
  jq empty /results/hashline-summary.json

  echo "[$TEST_NAME] PASS"
}

main "$@"
