#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'FAIL: provider runtime fallback: %s\n' "$*" >&2
  exit 1
}

# Load the production retry implementation while stubbing the Pi process itself.
eval "$(awk '
  /^capture_provider_error_from_summary\(\)/ { copy=1 }
  /^append_pre_coding_provider_fallback_error\(\)/ { exit }
  copy { print }
' "$REPO_ROOT/kaseki-agent.sh")"

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/results"
cat > "$TMP_DIR/bin/kaseki-pi-event-filter" <<'FILTER'
#!/usr/bin/env bash
cp "$1" "$2"
if ! grep -q 'stopReason.*error' "$1"; then
  printf '%s\n' '{}' > "$3"
  exit 0
fi
cat > "$3" <<'JSON'
{
  "primary_provider_error": {
    "type": "provider_error",
    "provider": "gateway",
    "api": "openai-completions",
    "model": "dynamic/kaseki-agent",
    "message": "Provider finish_reason: error",
    "retryable": true
  }
}
JSON
FILTER
chmod +x "$TMP_DIR/bin/kaseki-pi-event-filter"

PATH="$TMP_DIR/bin:$PATH"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_PROVIDER="gateway"
KASEKI_PROVIDER_FALLBACK="openrouter"
KASEKI_PROVIDER_FALLBACK_MODEL="auto"
KASEKI_SECRETS_DIR="$TMP_DIR/missing-secrets"
HOME="$TMP_DIR/home"
unset OPENROUTER_API_KEY OPENROUTER_API_KEY_FILE
if resolve_openrouter_fallback_key; then
  fail 'fallback key resolution accepted missing credentials'
fi
OPENROUTER_API_KEY="test-key"
PROVIDER_ERROR_RETRYABLE=""
PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
PROVIDER_ERROR_RETRY_RESULT="none"
PROVIDER_ERROR_FALLBACK_PROVIDER=""
PROVIDER_ERROR_FALLBACK_MODEL=""
PROVIDER_ERROR_FALLBACK_RESULT="none"
PI_CALL_COUNT=0

sleep() { :; }

run_pi_json_capture() {
  local raw_events_file="$1"
  PI_CALL_COUNT=$((PI_CALL_COUNT + 1))
  printf '%s:%s\n' "$KASEKI_PROVIDER" "$3" >> "$TMP_DIR/calls"
  if [ "$PI_CALL_COUNT" -lt 3 ]; then
    printf '%s\n' '{"type":"message_end","message":{"stopReason":"error","errorMessage":"Provider finish_reason: error"}}' > "$raw_events_file"
    # Pi 0.77 can report a successful process exit for a terminal provider
    # stream error. The wrapper must derive exit 88 from the event summary.
    return 0
  fi
  printf '%s\n' '{"type":"agent_end"}' > "$raw_events_file"
  return 0
}

set +e
run_pi_with_retry "$TMP_DIR/raw.jsonl" 30 dynamic/kaseki-agent prompt pi-summary "" coding 1
run_exit=$?
set -e

[ "$run_exit" -eq 0 ] || fail "expected fallback success, got exit $run_exit"
[ "$(sed -n '1p' "$TMP_DIR/calls")" = 'gateway:dynamic/kaseki-agent' ] || fail 'first call was not gateway'
[ "$(sed -n '2p' "$TMP_DIR/calls")" = 'gateway:dynamic/kaseki-agent' ] || fail 'retry was not gateway'
[ "$(sed -n '3p' "$TMP_DIR/calls")" = 'openrouter:auto' ] || fail 'fallback was not OpenRouter auto'
[ "$PROVIDER_ERROR_RETRY_ATTEMPT_COUNT" -eq 2 ] || fail 'retry attempt telemetry is incorrect'
[ "$PROVIDER_ERROR_RETRY_RESULT" = 'failed' ] || fail 'retry result telemetry is incorrect'
[ "$PROVIDER_ERROR_FALLBACK_PROVIDER" = 'openrouter' ] || fail 'fallback provider telemetry is missing'
[ "$PROVIDER_ERROR_FALLBACK_MODEL" = 'auto' ] || fail 'fallback model telemetry is missing'
[ "$PROVIDER_ERROR_FALLBACK_RESULT" = 'success' ] || fail 'fallback result telemetry is incorrect'
[ "$KASEKI_PROVIDER" = 'gateway' ] || fail 'primary provider was not restored'

# A subsequent clean coding attempt must retain the earlier recovery telemetry.
run_pi_json_capture() {
  local raw_events_file="$1"
  printf '%s\n' '{"type":"agent_end"}' > "$raw_events_file"
  return 0
}
cat > "$TMP_DIR/bin/kaseki-pi-event-filter" <<'FILTER'
#!/usr/bin/env bash
cp "$1" "$2"
printf '%s\n' '{}' > "$3"
FILTER
chmod +x "$TMP_DIR/bin/kaseki-pi-event-filter"

run_pi_with_retry "$TMP_DIR/raw-clean.jsonl" 30 dynamic/kaseki-agent prompt pi-summary "" coding 1 || \
  fail 'subsequent clean coding attempt failed'
[ "$PROVIDER_ERROR_RETRY_ATTEMPT_COUNT" -eq 2 ] || fail 'later coding attempt erased retry telemetry'
[ "$PROVIDER_ERROR_RETRY_RESULT" = 'failed' ] || fail 'later coding attempt erased retry result'
[ "$PROVIDER_ERROR_FALLBACK_RESULT" = 'success' ] || fail 'later coding attempt erased fallback result'

printf 'PASS: provider runtime fallback\n'
