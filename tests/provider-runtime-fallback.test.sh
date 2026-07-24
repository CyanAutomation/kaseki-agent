#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'FAIL: empty-assistant provider retry: %s\n' "$*" >&2
  exit 1
}

# Load the production retry implementation while injecting Pi and delay behavior.
source "$REPO_ROOT/scripts/lib/provider-retry.sh"

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
    "type": "provider_empty_assistant_turn",
    "provider": "gateway",
    "api": "openai-completions",
    "model": "dynamic/kaseki-agent",
    "message": "Provider returned no assistant text or tool calls",
    "retryable": false
  }
}
JSON
FILTER
chmod +x "$TMP_DIR/bin/kaseki-pi-event-filter"

PATH="$TMP_DIR/bin:$PATH"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_PROVIDER="gateway"
KASEKI_SKIP_GATEWAY_HEALTH_CHECK=1
KASEKI_PROVIDER_FALLBACK="openrouter"
KASEKI_PROVIDER_FALLBACK_MODEL="auto"
PROVIDER_ERROR_RETRYABLE=""
PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
PROVIDER_ERROR_RETRY_RESULT="none"
PROVIDER_ERROR_FALLBACK_PROVIDER=""
PROVIDER_ERROR_FALLBACK_MODEL=""
PROVIDER_ERROR_FALLBACK_RESULT="none"
PROVIDER_ERROR_RECOVERY_JSON=""
PROVIDER_ERROR_PRIMARY_JSON=""
PI_CALL_COUNT=0

provider_retry_no_sleep() { :; }
KASEKI_PROVIDER_RETRY_SLEEP_HOOK=provider_retry_no_sleep

fake_pi_json_capture() {
  local raw_events_file="$1"
  PI_CALL_COUNT=$((PI_CALL_COUNT + 1))
  printf '%s:%s\n' "$KASEKI_PROVIDER" "$3" >> "$TMP_DIR/calls"
  printf '%s\n' '{"type":"message_end","message":{"stopReason":"error","errorMessage":"Provider finish_reason: error"}}' > "$raw_events_file"
  # Pi 0.77 can report a successful process exit for a terminal provider
  # stream error. The wrapper must derive exit 88 from the event summary.
  return 0
}
KASEKI_PROVIDER_RETRY_PI_CAPTURE_HOOK=fake_pi_json_capture

set +e
run_pi_with_retry "$TMP_DIR/raw.jsonl" 30 dynamic/kaseki-agent prompt pi-summary "" coding 1
run_exit=$?
set -e

[ "$run_exit" -eq 88 ] || fail "expected exhausted gateway retry exit 88, got $run_exit"
[ "$(wc -l < "$TMP_DIR/calls" | tr -d ' ')" -eq 2 ] || fail 'provider switching added an unexpected invocation'
[ "$(sed -n '1p' "$TMP_DIR/calls")" = 'gateway:dynamic/kaseki-agent' ] || fail 'first call was not gateway'
[ "$(sed -n '2p' "$TMP_DIR/calls")" = 'gateway:dynamic/kaseki-agent' ] || fail 'retry was not gateway'
[ "$PROVIDER_ERROR_RETRY_ATTEMPT_COUNT" -eq 2 ] || fail 'retry attempt telemetry is incorrect'
[ "$PROVIDER_ERROR_RETRY_RESULT" = 'failed' ] || fail 'retry result telemetry is incorrect'
[ -z "$PROVIDER_ERROR_FALLBACK_PROVIDER" ] || fail 'fallback provider telemetry must remain empty'
[ -z "$PROVIDER_ERROR_FALLBACK_MODEL" ] || fail 'fallback model telemetry must remain empty'
[ "$PROVIDER_ERROR_FALLBACK_RESULT" = 'none' ] || fail 'fallback result telemetry must remain none'
[ -n "$PROVIDER_ERROR_MESSAGE" ] || fail 'provider failure message was not preserved for diagnostics'
printf '%s' "$PROVIDER_ERROR_MESSAGE" | grep -q 'request_id=' || fail 'provider failure diagnostics omit the request id'
[ "$(node -e 'const fs=require("node:fs"); const entries=fs.readFileSync(process.argv[1], "utf8").trim().split(/\n/).map(JSON.parse); process.stdout.write(String(entries.every((entry) => entry.retryable === true)))' "$KASEKI_RESULTS_DIR/provider-attempts.jsonl")" = 'true' ] \
  || fail 'empty assistant turns should be marked retryable in attempt telemetry'
[ "$KASEKI_PROVIDER" = 'gateway' ] || fail 'primary provider was not restored/preserved'
[ -s "$KASEKI_RESULTS_DIR/provider-attempts/coding/primary-1.events.jsonl" ] || fail 'primary attempt 1 events were not preserved'
[ -s "$KASEKI_RESULTS_DIR/provider-attempts/coding/primary-2.events.jsonl" ] || fail 'primary attempt 2 events were not preserved'
[ ! -e "$KASEKI_RESULTS_DIR/provider-attempts/coding/fallback-1.events.jsonl" ] || fail 'fallback attempt artifact must not exist'
[ "$(wc -l < "$KASEKI_RESULTS_DIR/provider-attempts.jsonl" | tr -d ' ')" -eq 2 ] || fail 'provider attempt manifest should contain gateway attempts only'
printf '%s' "$PROVIDER_ERROR_PRIMARY_JSON" | grep -q '"provider":"gateway"' || fail 'primary provider error attribution was not preserved'

printf 'PASS: empty-assistant provider retry\n'
