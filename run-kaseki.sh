#!/usr/bin/env bash
set -euo pipefail

ROOT="/agents"
RUNS="$ROOT/kaseki-runs"
RESULTS="$ROOT/kaseki-results"
IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:0.1.0}"
REPO_URL="${REPO_URL:-https://github.com/CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"
KASEKI_MODEL="${KASEKI_MODEL:-openrouter/free}"
KASEKI_AGENT_TIMEOUT_SECONDS="${KASEKI_AGENT_TIMEOUT_SECONDS:-1200}"
KASEKI_VALIDATION_COMMANDS="${KASEKI_VALIDATION_COMMANDS:-npm run check;npm run test;npm run build}"
KASEKI_DEBUG_RAW_EVENTS="${KASEKI_DEBUG_RAW_EVENTS:-0}"
KASEKI_KEEP_WORKSPACE="${KASEKI_KEEP_WORKSPACE:-1}"
KASEKI_CHANGED_FILES_ALLOWLIST="${KASEKI_CHANGED_FILES_ALLOWLIST:-src/lib/parser.ts tests/parser.validation.ts}"
KASEKI_MAX_DIFF_BYTES="${KASEKI_MAX_DIFF_BYTES:-200000}"
TASK_PROMPT="${TASK_PROMPT:-Make normalizeRole treat a non-string Name fallback safely when FriendlyName is empty or missing. It should fall back to \"Unnamed Role\" instead of preserving arbitrary truthy non-string values. Add or update a focused Vitest case in tests/parser.validation.ts. Do not print, inspect, or expose environment variables, secrets, credentials, or API keys. Keep changes limited to the source and test files needed for this fix.}"
INSTANCE="${1:-}"

if [ -z "$INSTANCE" ]; then
  next=1
  while [ -e "$RUNS/kaseki-$next" ] || [ -e "$RESULTS/kaseki-$next" ]; do
    next=$((next + 1))
  done
  INSTANCE="kaseki-$next"
fi

case "$INSTANCE" in
  kaseki-[0-9]*) ;;
  *) echo "Instance must look like kaseki-N, got: $INSTANCE" >&2; exit 2 ;;
esac

RUN_DIR="$RUNS/$INSTANCE"
RESULT_DIR="$RESULTS/$INSTANCE"
WORKSPACE="$RUN_DIR/workspace"
SECRET_FILE="$RUN_DIR/openrouter_api_key"
HOST_SECRET_FILE="${OPENROUTER_API_KEY_FILE:-/run/secrets/openrouter_api_key}"

cleanup_secret() {
  rm -f "$SECRET_FILE"
}
trap cleanup_secret EXIT

mkdir -p "$WORKSPACE" "$RESULT_DIR"
chmod 0755 "$RUN_DIR" "$WORKSPACE" "$RESULT_DIR"

START_EPOCH="$(date +%s)"

cat > "$RESULT_DIR/host-start.json" <<META
{
  "instance": "$INSTANCE",
  "repo_url": "$REPO_URL",
  "git_ref": "$GIT_REF",
  "provider": "$KASEKI_PROVIDER",
  "model": "$KASEKI_MODEL",
  "changed_files_allowlist": "$KASEKI_CHANGED_FILES_ALLOWLIST",
  "max_diff_bytes": $KASEKI_MAX_DIFF_BYTES,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "host": "$(hostname)",
  "image": "$IMAGE"
}
META

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  key_source="env"
  key_value="$OPENROUTER_API_KEY"
elif [ -r "$HOST_SECRET_FILE" ]; then
  key_source="secret file"
  key_value="$(cat "$HOST_SECRET_FILE")"
else
  {
    printf 'OpenRouter API key is required. '
    printf 'Set OPENROUTER_API_KEY or provide a readable secret file at %s (override with OPENROUTER_API_KEY_FILE).\n' "$HOST_SECRET_FILE"
  } > "$RESULT_DIR/stderr.log"
  : > "$RESULT_DIR/stdout.log"
  : > "$RESULT_DIR/pi-events.jsonl"
  : > "$RESULT_DIR/git.status"
  : > "$RESULT_DIR/git.diff"
  : > "$RESULT_DIR/validation.log"
  printf '2\n' > "$RESULT_DIR/exit_code"
  printf '2\n' > "$RESULT_DIR/host_docker_exit_code"
  printf 'elapsed_seconds=0\n' > "$RESULT_DIR/resource.time"
  cat > "$RESULT_DIR/metadata.json" <<META
{
  "instance": "$INSTANCE",
  "repo_url": "$REPO_URL",
  "git_ref": "$GIT_REF",
  "provider": "$KASEKI_PROVIDER",
  "model": "$KASEKI_MODEL",
  "exit_code": 2,
  "failed_command": "missing OPENROUTER_API_KEY"
}
META
  cat "$RESULT_DIR/stderr.log" >&2
  exit 2
fi

if [ -z "$key_value" ]; then
  printf 'OpenRouter API key source "%s" resolved to an empty value.\n' "$key_source" > "$RESULT_DIR/stderr.log"
  : > "$RESULT_DIR/stdout.log"
  : > "$RESULT_DIR/pi-events.jsonl"
  : > "$RESULT_DIR/git.status"
  : > "$RESULT_DIR/git.diff"
  : > "$RESULT_DIR/validation.log"
  printf '2\n' > "$RESULT_DIR/exit_code"
  printf '2\n' > "$RESULT_DIR/host_docker_exit_code"
  printf 'elapsed_seconds=0\n' > "$RESULT_DIR/resource.time"
  cat > "$RESULT_DIR/metadata.json" <<META
{
  "instance": "$INSTANCE",
  "repo_url": "$REPO_URL",
  "git_ref": "$GIT_REF",
  "provider": "$KASEKI_PROVIDER",
  "model": "$KASEKI_MODEL",
  "exit_code": 2,
  "failed_command": "empty OpenRouter API key from $key_source"
}
META
  cat "$RESULT_DIR/stderr.log" >&2
  exit 2
fi

printf 'OpenRouter API key source: %s\n' "$key_source"
printf '%s' "$key_value" > "$SECRET_FILE"
chmod 0600 "$SECRET_FILE"
unset key_value

set +e
docker run --rm \
    --name "$INSTANCE" \
    --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=256m \
    --security-opt no-new-privileges:true \
    --cap-drop ALL \
    --pids-limit 256 \
    --memory 768m \
    --cpus 1.0 \
    -u 1000:1000 \
    -e KASEKI_INSTANCE="$INSTANCE" \
    -e REPO_URL="$REPO_URL" \
    -e GIT_REF="$GIT_REF" \
    -e KASEKI_PROVIDER="$KASEKI_PROVIDER" \
    -e KASEKI_MODEL="$KASEKI_MODEL" \
    -e KASEKI_AGENT_TIMEOUT_SECONDS="$KASEKI_AGENT_TIMEOUT_SECONDS" \
    -e KASEKI_VALIDATION_COMMANDS="$KASEKI_VALIDATION_COMMANDS" \
    -e KASEKI_DEBUG_RAW_EVENTS="$KASEKI_DEBUG_RAW_EVENTS" \
    -e KASEKI_CHANGED_FILES_ALLOWLIST="$KASEKI_CHANGED_FILES_ALLOWLIST" \
    -e KASEKI_MAX_DIFF_BYTES="$KASEKI_MAX_DIFF_BYTES" \
    -e TASK_PROMPT="$TASK_PROMPT" \
    -e OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
    -v "$WORKSPACE:/workspace:rw" \
    -v "$RESULT_DIR:/results:rw" \
    -v "$SECRET_FILE:/run/secrets/openrouter_api_key:ro" \
    -w /workspace \
    "$IMAGE"
DOCKER_EXIT="$?"
set -e
cleanup_secret

END_EPOCH="$(date +%s)"
printf 'elapsed_seconds=%s\n' "$((END_EPOCH - START_EPOCH))" > "$RESULT_DIR/resource.time"
printf '%s\n' "$DOCKER_EXIT" > "$RESULT_DIR/host_docker_exit_code"

if [ "$DOCKER_EXIT" -eq 0 ] && [ "$KASEKI_KEEP_WORKSPACE" != "1" ]; then
  rm -rf "$WORKSPACE"
fi

printf '%s\n' "$INSTANCE"
printf 'run_dir=%s\n' "$RUN_DIR"
printf 'result_dir=%s\n' "$RESULT_DIR"
exit "$DOCKER_EXIT"
