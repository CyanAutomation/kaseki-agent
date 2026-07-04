# Provider retry/fallback support for kaseki-agent.sh.
#
# Hook variables for tests/integration seams:
#   KASEKI_PROVIDER_RETRY_PI_CAPTURE_HOOK - function used to invoke Pi (default: run_pi_json_capture)
#   KASEKI_PROVIDER_RETRY_SLEEP_HOOK      - function used to delay retries (default: sleep)

provider_retry_pi_capture() {
  local hook="${KASEKI_PROVIDER_RETRY_PI_CAPTURE_HOOK:-run_pi_json_capture}"
  "$hook" "$@"
}

provider_retry_sleep() {
  local hook="${KASEKI_PROVIDER_RETRY_SLEEP_HOOK:-sleep}"
  "$hook" "$@"
}

provider_retry_emit_progress() {
  if declare -F emit_progress >/dev/null 2>&1; then
    emit_progress "$@"
  fi
}

capture_provider_error_from_summary() {
  local summary_file="$1"
  local phase="$2"
  local payload

  [ -s "$summary_file" ] || return 1
  payload="$(node - "$summary_file" "$phase" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [summaryPath, phase] = process.argv.slice(2);
let summary;
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch { process.exit(0); }
const error = summary && typeof summary === 'object'
  ? summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null)
  : null;
if (!error || typeof error !== 'object' || typeof error.message !== 'string' || !error.message.trim()) {
  process.exit(0);
}
const normalized = {
  type: typeof error.type === 'string' && error.type ? error.type : 'provider_error',
  phase,
  provider: typeof error.provider === 'string' ? error.provider : '',
  api: typeof error.api === 'string' ? error.api : '',
  model: typeof error.model === 'string' ? error.model : '',
  message: error.message,
};
process.stdout.write(JSON.stringify(normalized));
NODE
)"
  [ -n "$payload" ] || return 1

  printf '%s\n' "$payload" > "${KASEKI_RESULTS_DIR}/provider-error.json"
  PROVIDER_ERROR_TYPE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.type || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PHASE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.phase || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PROVIDER="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.provider || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_API="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.api || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MODEL="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.model || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MESSAGE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.message || ""));' "$payload" 2>/dev/null || true)"
  return 0
}

capture_provider_error_from_log() {
  local log_file="$1"
  local phase="$2"
  local payload

  [ -s "$log_file" ] || return 1
  payload="$(node - "$log_file" "$phase" "$KASEKI_PROVIDER" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [logPath, phase, provider] = process.argv.slice(2);
let text = '';
try { text = fs.readFileSync(logPath, 'utf8'); } catch { process.exit(0); }
const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
if (lines.length === 0) process.exit(0);
const keywords = [
  /gateway/i,
  /provider/i,
  /api key/i,
  /auth/i,
  /unauthori[sz]ed/i,
  /\b401\b/,
  /\b403\b/,
  /model/i,
  /manifest/i,
  /fetch/i,
  /network/i,
  /responses/i,
  /openai/i,
];
const matched = lines.filter((line) => keywords.some((pattern) => pattern.test(line)));
const selected = (matched.length ? matched : lines).slice(-8).join('\n');
if (!selected) process.exit(0);
const lower = selected.toLowerCase();
const type = lower.includes('api key') || lower.includes('auth') || lower.includes('401') || lower.includes('403')
  ? 'provider_auth_error'
  : 'provider_error';
process.stdout.write(JSON.stringify({
  type,
  phase,
  provider: provider || '',
  api: '',
  model: '',
  message: selected,
}));
NODE
)"
  [ -n "$payload" ] || return 1

  printf '%s\n' "$payload" > "${KASEKI_RESULTS_DIR}/provider-error.json"
  PROVIDER_ERROR_TYPE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.type || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PHASE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.phase || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_PROVIDER="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.provider || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_API="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.api || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MODEL="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.model || ""));' "$payload" 2>/dev/null || true)"
  PROVIDER_ERROR_MESSAGE="$(node -e 'const p=JSON.parse(process.argv[1]); process.stdout.write(String(p.message || ""));' "$payload" 2>/dev/null || true)"
  return 0
}

provider_error_is_terminal() {
  [ -n "$PROVIDER_ERROR_MESSAGE" ]
}

clear_provider_error() {
  PROVIDER_ERROR_TYPE=""
  PROVIDER_ERROR_PHASE=""
  PROVIDER_ERROR_PROVIDER=""
  PROVIDER_ERROR_API=""
  PROVIDER_ERROR_MODEL=""
  PROVIDER_ERROR_MESSAGE=""
  PROVIDER_ERROR_RETRYABLE=""
  PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
  PROVIDER_ERROR_RETRY_RESULT="none"
  PROVIDER_ERROR_FALLBACK_PROVIDER=""
  PROVIDER_ERROR_FALLBACK_MODEL=""
  PROVIDER_ERROR_FALLBACK_RESULT="none"
  PROVIDER_ERROR_PRIMARY_JSON=""
  PROVIDER_ERROR_RECOVERY_JSON=""
}

# Record provider health history for trend tracking
record_provider_health() {
  local provider="$1"
  local phase="$2"
  local exit_code="$3"
  local retry_attempt_count="${PROVIDER_ERROR_RETRY_ATTEMPT_COUNT:-0}"
  local retry_result="${PROVIDER_ERROR_RETRY_RESULT:-none}"
  local error_type="${PROVIDER_ERROR_TYPE:-}"
  local error_message="${PROVIDER_ERROR_MESSAGE:-}"
  
  local health_status="success"
  if [ "$exit_code" -eq 88 ]; then
    health_status="failed"
  fi
  
  local health_cache_dir="${KASEKI_CACHE_DIR:-/agents/kaseki-cache}"
  mkdir -p "$health_cache_dir" || return 1
  
  local health_file="$health_cache_dir/provider-health.jsonl"
  
  node - "$health_file" "$provider" "$phase" "$exit_code" "$health_status" "$error_type" "$error_message" "$retry_attempt_count" "$retry_result" "${KASEKI_INFERENCE_REQUEST_ID:-}" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [file, provider, phase, exitCode, status, errorType, errorMsg, retryCount, retryResult, requestId] = process.argv.slice(2);

const entry = {
  timestamp: new Date().toISOString(),
  provider,
  phase,
  exit_code: parseInt(exitCode),
  status,
  error_type: errorType || null,
  error_message: errorMsg || null,
  retry_attempt_count: parseInt(retryCount),
  retry_result: retryResult,
  correlation_id: requestId || null,
};

// Append to health file
try {
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', { encoding: 'utf8', flag: 'a' });
} catch (e) {
  // Ignore write errors; health tracking is non-critical
}
NODE
}

# Check for provider degradation based on recent health history
check_provider_degradation() {
  local provider="$1"
  local lookback_count="${KASEKI_PROVIDER_HEALTH_LOOKBACK:-20}"  # Check last N runs
  local failure_threshold_percent="${KASEKI_PROVIDER_DEGRADATION_THRESHOLD:-50}"  # Alert if >50% fail
  
  local health_cache_dir="${KASEKI_CACHE_DIR:-/agents/kaseki-cache}"
  local health_file="$health_cache_dir/provider-health.jsonl"
  
  if [ ! -f "$health_file" ]; then
    return 0  # No history yet
  fi
  
  local stats
  stats=$(node - "$provider" "$health_file" "$lookback_count" <<'NODE'
const provider = process.argv[2];
const healthFile = process.argv[3];
const lookbackCount = parseInt(process.argv[4] || '20', 10);
let failCount = 0;
let totalCount = 0;

try {
  const fs = require('fs');
  const lines = fs.readFileSync(healthFile, 'utf8').split('\n').filter(Boolean);
  const relevantLines = lines.slice(-lookbackCount);
  for (const line of relevantLines) {
    try {
      const entry = JSON.parse(line);
      if (entry.provider === provider) {
        totalCount++;
        if (entry.exit_code === 88) failCount++;
      }
    } catch {}
  }
} catch {}

if (totalCount > 0) {
  const failPercent = Math.round((failCount / totalCount) * 100);
  process.stdout.write(JSON.stringify({ fail_count: failCount, total_count: totalCount, fail_percent: failPercent }));
}
NODE
)
  
  if [ -n "$stats" ]; then
    local fail_percent
    fail_percent=$(echo "$stats" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).fail_percent)' 2>/dev/null || echo "0")
    
    if [ "$((fail_percent))" -gt "$failure_threshold_percent" ]; then
      printf '[DEGRADATION ALERT] %s provider is failing %d%% of requests (threshold: %d%%)\n' \
        "$provider" "$fail_percent" "$failure_threshold_percent" >&2
      printf '[RECOMMENDATION] Switch KASEKI_PROVIDER to alternative or investigate %s service health\n' \
        "$provider" >&2
      return 1
    fi
  fi
  
  return 0
}

# Calculate exponential backoff delay with optional jitter for retry attempts
calculate_retry_delay() {
  local attempt=$1  # 1, 2, 3...
  local base_seconds="${KASEKI_PROVIDER_RETRY_BASE_SECONDS:-3}"
  local max_seconds="${KASEKI_PROVIDER_RETRY_MAX_SECONDS:-60}"

  # Guard arithmetic inputs explicitly. Parameter expansion defaults only cover
  # unset/empty values, while whitespace-only or non-numeric values would still
  # break shell arithmetic and backoff capping.
  if ! [[ "$attempt" =~ ^[0-9]+$ ]] || [ "$attempt" -lt 1 ]; then
    attempt=1
  fi
  if ! [[ "$base_seconds" =~ ^[0-9]+$ ]] || [ "$base_seconds" -lt 1 ]; then
    base_seconds=3
  fi
  if ! [[ "$max_seconds" =~ ^[0-9]+$ ]] || [ "$max_seconds" -lt 1 ]; then
    max_seconds=60
  fi
  
  # Exponential: 3 * (2 ^ (attempt - 1))
  # Attempt 1: 3s, Attempt 2: 6s, Attempt 3: 12s
  local delay_seconds=$((base_seconds * (2 ** (attempt - 1))))
  
  # Cap at max (default 60s)
  if [ "$delay_seconds" -gt "$max_seconds" ]; then
    delay_seconds="$max_seconds"
  fi
  
  # Add jitter: ±20%
  local jitter_seconds=0
  if [ "${KASEKI_PROVIDER_RETRY_JITTER:-1}" = "1" ]; then
    local jitter_percent=20
    jitter_seconds=$((delay_seconds * jitter_percent / 100))
    local jitter_offset=$((-jitter_seconds + RANDOM % (2 * jitter_seconds + 1)))
    delay_seconds=$((delay_seconds + jitter_offset))
  fi
  
  echo "$delay_seconds"
}

# Check gateway health before attempting Pi invocation
pre_check_gateway_health() {
  local provider="${1:-gateway}"
  local gateway_url="${KASEKI_GATEWAY_URL:-https://kaseki-tunnel.scheimann.xyz}"
  
  printf '[GATEWAY HEALTH] Checking %s health at %s/health\n' "$provider" "$gateway_url" >&2
  
  if curl -sf --max-time 5 --connect-timeout 3 "$gateway_url/health" > /tmp/gateway-health.json 2>&1; then
    local ready
    ready=$(jq -r 'if has("ready") then (.ready | tostring) else "unknown" end' /tmp/gateway-health.json 2>/dev/null || echo "unknown")
    if [ "$ready" = "true" ]; then
      printf '[GATEWAY HEALTH] ✓ Gateway responsive and ready\n' >&2
      return 0
    fi
    if [ "$ready" = "false" ]; then
      printf '[GATEWAY HEALTH] ✗ Gateway responsive but not ready; refusing provider request\n' >&2
      return 1
    fi
    printf '[GATEWAY HEALTH] Gateway responsive but readiness was not reported; proceeding with caution\n' >&2
    return 0
  else
    printf '[GATEWAY HEALTH] ✗ Gateway unreachable (timeout or error); proceeding with caution\n' >&2
    return 1
  fi
}

cap_jsonl_artifact() {
  local file="$1" max_bytes="${2:-$KASEKI_PI_EVENTS_MAX_BYTES}" size tmp
  [ -f "$file" ] || return 0
  size=$(wc -c < "$file" 2>/dev/null || echo 0)
  [ "$size" -le "$max_bytes" ] && return 0
  tmp="${file}.capped.$$"
  {
    printf '{"type":"artifact_truncated","original_bytes":%s,"retained_bytes":%s}\n' "$size" "$max_bytes"
    tail -c "$max_bytes" "$file" | sed '1d'
  } > "$tmp"
  mv "$tmp" "$file"
  printf '[ARTIFACT CAP] Trimmed %s from %s bytes to the latest %s bytes\n' "$file" "$size" "$max_bytes" >&2
}

# Log the classification reason for why error was marked as retryable
log_retry_classification_reason() {
  local phase_name="$1"
  local error_message="$2"
  
  # Extract classification details from error message if available
  local category="unknown"
  local confidence="low"
  
  if echo "$error_message" | grep -qi "finish_reason.*error"; then
    category="unknown"
    confidence="medium"
  elif echo "$error_message" | grep -qi "503\|service.*unavailable"; then
    category="service_unavailable"
    confidence="high"
  elif echo "$error_message" | grep -qi "429\|rate.*limit"; then
    category="rate_limited"
    confidence="high"
  elif echo "$error_message" | grep -qi "timeout\|econnreset\|etimedout"; then
    category="gateway_timeout"
    confidence="high"
  elif echo "$error_message" | grep -qi "tool.*call.*json\|malformed"; then
    category="malformed_request"
    confidence="high"
  fi
  
  printf '[RETRY CLASSIFICATION] %s phase error classified as retryable (category: %s, confidence: %s)\n' \
    "$phase_name" "$category" "$confidence" >&2
}

snapshot_provider_attempt() {
  local raw_events_file="$1" summary_file="$2" phase_name="$3" provider="$4" model="$5" attempt_name="$6"
  local attempt_dir="${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}"
  mkdir -p "$attempt_dir"
  cp "$raw_events_file" "$attempt_dir/${attempt_name}.events.jsonl" 2>/dev/null || true
  cp "$summary_file" "$attempt_dir/${attempt_name}.summary.json" 2>/dev/null || true
  node - "$summary_file" "$provider" "$model" "$phase_name" "$attempt_name" "${KASEKI_INFERENCE_REQUEST_ID:-}" > "$attempt_dir/${attempt_name}.json" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const [summaryPath, provider, model, phase, attempt, requestId] = process.argv.slice(2);
let summary = {};
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
const error = summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null);

// Extract token usage from summary
const tokens = summary.tokens || summary.usage || {};
const tokenInfo = {
  input_tokens: tokens.input_tokens || tokens.prompt_tokens || 0,
  output_tokens: tokens.output_tokens || tokens.completion_tokens || 0,
  total_tokens: tokens.total_tokens || 0,
};

// Extract timing info if available
const timing = {};
if (summary.start_time && summary.end_time) {
  timing.latency_ms = new Date(summary.end_time).getTime() - new Date(summary.start_time).getTime();
}

process.stdout.write(JSON.stringify({
  timestamp: new Date().toISOString(), phase, attempt, provider, model,
  request_id: requestId || undefined,
  response_id: error?.response_id || undefined,
  status_code: error?.status_code || undefined,
  error_code: error?.error_code || undefined,
  retryable: error?.retryable === true,
  tokens: tokenInfo,
  timing: timing,
  error: error || null,
}, null, 2) + '\n');
NODE
  node - "$attempt_dir/${attempt_name}.json" <<'NODE' >> "${KASEKI_RESULTS_DIR}/provider-attempts.jsonl" 2>/dev/null || true
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify(value) + '\n');
NODE
}

provider_error_json_from_summary() {
  local summary_file="$1" phase_name="$2" provider="$3" model="$4"
  node - "$summary_file" "$phase_name" "$provider" "$model" <<'NODE' 2>/dev/null || printf '{}'
const fs = require('node:fs');
const [summaryPath, phase, provider, model] = process.argv.slice(2);
let summary = {};
try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}
const error = summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null) || {};
process.stdout.write(JSON.stringify({
  type: error.type || 'provider_error', phase, provider: error.provider || provider,
  api: error.api || '', model: error.model || model, message: error.message || '',
  retryable: error.retryable === true
}));
NODE
}

check_if_provider_error_retryable() {
  # Check if the most recent provider error (from summary file) is retryable
  # Sets PROVIDER_ERROR_RETRYABLE variable and returns 0 if retryable, 1 if not
  local summary_file="$1"
  
  PROVIDER_ERROR_RETRYABLE="false"
  [ -s "$summary_file" ] || return 1
  
  # Check if primary_provider_error.retryable is true
  if node -e "
const fs = require('node:fs');
const summary = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const error = summary && typeof summary === 'object'
  ? summary.primary_provider_error || (Array.isArray(summary.provider_errors) ? summary.provider_errors[0] : null)
  : null;
if (error && typeof error === 'object' && error.retryable === true) {
  process.exit(0);  // Retryable
}
process.exit(1);  // Not retryable or no error
" "$summary_file" 2>/dev/null; then
    PROVIDER_ERROR_RETRYABLE="true"
    return 0
  fi
  return 1
}

run_pi_with_retry() {
  # Wrapper around run_pi_json_capture that implements automatic single retry for transient provider errors.
  # 
  # Arguments:
  #   $1: raw_events_file    - Path to write raw event JSONL
  #   $2: timeout_seconds    - Timeout for Pi invocation
  #   $3: model              - Model to use
  #   $4: prompt             - Task prompt
  #   $5: summary_file_base  - Base path for summary files (without .json extension, e.g., "pi-summary")
  #   $6: stderr_target      - Optional: stderr file path
  #   $7: phase_name         - Phase name for logging (e.g., "coding", "scouting")
  #
  # Returns:
  #   Exit code from Pi invocation (after retry logic applied)
  #
  # Sets global variables:
  #   PROVIDER_ERROR_RETRY_ATTEMPT_COUNT - 0 if no retry, 1-2 if retried
  #   PROVIDER_ERROR_RETRY_RESULT - "none" (no error), "success" (retry succeeded), "failed" (retry failed)
  #
  # Behavior:
  # - Calls run_pi_json_capture to invoke Pi
  # - Runs the event filter after every invocation because Pi can exit 0 even
  #   when the provider stream reports a terminal finish_reason:error event
  # - Normalizes a terminal provider event to exit 88 before retry decisions
  # - If retryable: sleep 3s, clears raw events, retries once
  # - Caller may run the event filter again when collecting final artifacts
  # - Max 2 total invocations (initial + 1 retry)
  
  local raw_events_file="$1"
  local timeout_seconds="$2"
  local model="$3"
  local prompt="$4"
  local summary_file_base="$5"
  local stderr_target="${6:-}"
  local phase_name="${7:-unknown}"
  local pi_exit summary_file attempt=1 original_provider="$KASEKI_PROVIDER" primary_response_id="" retry_response_id=""
  local original_prompt="$prompt" provider_error_type="" original_model="$model"
  local previous_retryable="${PROVIDER_ERROR_RETRYABLE:-}"
  local previous_retry_attempt_count="${PROVIDER_ERROR_RETRY_ATTEMPT_COUNT:-0}"
  local previous_retry_result="${PROVIDER_ERROR_RETRY_RESULT:-none}"
  local previous_fallback_provider="${PROVIDER_ERROR_FALLBACK_PROVIDER:-}"
  local previous_fallback_model="${PROVIDER_ERROR_FALLBACK_MODEL:-}"
  local previous_fallback_result="${PROVIDER_ERROR_FALLBACK_RESULT:-none}"
  
  # Reset retry tracking
  PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=0
  PROVIDER_ERROR_RETRY_RESULT="none"
  PROVIDER_ERROR_FALLBACK_PROVIDER=""
  PROVIDER_ERROR_FALLBACK_MODEL=""
  PROVIDER_ERROR_FALLBACK_RESULT="none"
  
  invoke_pi() {
    KASEKI_INFERENCE_PHASE="$phase_name"
    if [ "$KASEKI_PROVIDER" = "$original_provider" ]; then
      KASEKI_INFERENCE_ATTEMPT="primary-$attempt"
    else
      KASEKI_INFERENCE_ATTEMPT="fallback-1"
    fi
    # Request ID is already generated before calling invoke_pi
    export KASEKI_INFERENCE_PHASE KASEKI_INFERENCE_ATTEMPT KASEKI_INFERENCE_REQUEST_ID
    if [ -n "$stderr_target" ]; then
      provider_retry_pi_capture "$raw_events_file" "$timeout_seconds" "$model" "$prompt" "$stderr_target"
    else
      provider_retry_pi_capture "$raw_events_file" "$timeout_seconds" "$model" "$prompt"
    fi
  }

  summarize_invocation() {
    summary_file="${KASEKI_RESULTS_DIR}/${summary_file_base}.json"
    if [ "$summary_file_base" = "pi-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/pi-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "scouting-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/scouting-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "goal-setting-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/goal-setting-events.jsonl" "$summary_file" 2>/dev/null || true
    elif [ "$summary_file_base" = "goal-check-summary" ]; then
      kaseki-pi-event-filter "$raw_events_file" "${KASEKI_RESULTS_DIR}/goal-check-events.jsonl" "$summary_file" 2>/dev/null || true
    else
      cp "$raw_events_file" "${summary_file_base}.jsonl" 2>/dev/null || true
    fi

    # Pi 0.77 may return success even though an OpenAI-compatible stream ended
    # with finish_reason:error. Treat the structured event as authoritative.
    if capture_provider_error_from_summary "$summary_file" "$phase_name"; then
      pi_exit=88
      check_if_provider_error_retryable "$summary_file" || true
      return 0
    fi
    return 1
  }

  # First attempt
  # Generate request ID early for logging
  KASEKI_INFERENCE_REQUEST_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())' 2>/dev/null || printf 'req-%s' "$(date +%s)")"
  export KASEKI_INFERENCE_REQUEST_ID
  
  if [ "$original_provider" = "gateway" ] && [ -z "${KASEKI_SKIP_GATEWAY_HEALTH_CHECK:-}" ]; then
    if ! pre_check_gateway_health "$original_provider"; then
      PROVIDER_ERROR_TYPE="provider_not_ready"
      PROVIDER_ERROR_MESSAGE="Gateway health endpoint is reachable but not ready"
      PROVIDER_ERROR_PHASE="$phase_name"
      PROVIDER_ERROR_PROVIDER="$original_provider"
      PROVIDER_ERROR_MODEL="$model"
      PROVIDER_ERROR_RETRYABLE="false"
      printf '[PROVIDER BLOCKED] %s; skipping inference request\n' "$PROVIDER_ERROR_MESSAGE" >&2
      return 88
    fi
  fi
  
  printf '[CORRELATION] Request %s sent to %s (provider: %s, model: %s)\n' \
    "$KASEKI_INFERENCE_REQUEST_ID" "$phase_name" "$original_provider" "$model" >&2
  
  invoke_pi
  pi_exit=$?
  summarize_invocation || true
  snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$original_provider" "$model" "primary-1"
  primary_response_id="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.primary_provider_error?.response_id||""))}catch{}' "$summary_file" 2>/dev/null || true)"
  if [ "$pi_exit" -eq 88 ]; then
    PROVIDER_ERROR_PRIMARY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$original_provider" "$model")"
  fi

  # For phase-specific retries, we need to check provider errors
  # Only retry if we got exit 88 (provider error) on first attempt
  if [ "$pi_exit" -eq 88 ] && [ "$attempt" -eq 1 ]; then
    # Check if error is retryable
    if check_if_provider_error_retryable "$summary_file"; then
      provider_error_message="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.primary_provider_error?.message||""))}catch{}' "$summary_file" 2>/dev/null || true)"
      log_retry_classification_reason "$phase_name" "$provider_error_message"
      
      provider_error_type="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.primary_provider_error?.type||""))}catch{}' "$summary_file" 2>/dev/null || true)"
      if [ "$provider_error_type" = "malformed_tool_call" ]; then
        prompt="$original_prompt

Recovery instruction: The previous response emitted malformed tool-call JSON. Emit one small tool call at a time. Ensure every tool argument is complete, valid JSON before continuing."
        printf '[RETRY CORRECTION] Retrying malformed tool call with constrained JSON guidance\n' >&2
      fi
      
      local retry_delay_seconds
      retry_delay_seconds=$(calculate_retry_delay 1)
      printf '[RETRY] Provider error is retryable in %s phase; attempting retry 1/1 after %ss delay (model: %s, correlation_id: %s)\n' \
        "$phase_name" "$retry_delay_seconds" "$model" "$KASEKI_INFERENCE_REQUEST_ID" >&2
      provider_retry_emit_progress "$phase_name" "provider retry scheduled (attempt 2/2 in ${retry_delay_seconds}s)"
      
      PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=1
      provider_retry_sleep "$retry_delay_seconds"
      rm -f "$raw_events_file" 2>/dev/null || true
      : > "$raw_events_file"
      
      attempt=2
      previous_request_id="$KASEKI_INFERENCE_REQUEST_ID"
      KASEKI_INFERENCE_REQUEST_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())' 2>/dev/null || printf 'req-%s-retry' "$(date +%s)")"
      export KASEKI_INFERENCE_REQUEST_ID
      prompt="$prompt

Retry request identity: $KASEKI_INFERENCE_REQUEST_ID. Treat this as a fresh inference attempt; do not replay a cached response from the previous request."
      printf '[RETRY CORRELATION] Fresh request %s replaces failed request %s for retry attempt\n' \
        "$KASEKI_INFERENCE_REQUEST_ID" "$previous_request_id" >&2
      provider_retry_emit_progress "$phase_name" "provider retry started (attempt 2/2)"
      invoke_pi
      pi_exit=$?
      summarize_invocation || true
      snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$original_provider" "$model" "primary-2"
      retry_response_id="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String(s.primary_provider_error?.response_id||""))}catch{}' "$summary_file" 2>/dev/null || true)"
      
      # Extract detailed context for duplicate detection
      local attempt1_latency="" attempt2_latency="" attempt1_tokens="" attempt2_tokens=""
      if [ -f "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-1.json" ]; then
        attempt1_latency="$(jq -r '.timing.latency_ms // "unknown"' "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-1.json" 2>/dev/null || echo "unknown")"
        attempt1_tokens="$(jq -r '.tokens | "input:\(.input_tokens),output:\(.output_tokens)"' "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-1.json" 2>/dev/null || echo "unknown")"
      fi
      if [ -f "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-2.json" ]; then
        attempt2_latency="$(jq -r '.timing.latency_ms // "unknown"' "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-2.json" 2>/dev/null || echo "unknown")"
        attempt2_tokens="$(jq -r '.tokens | "input:\(.input_tokens),output:\(.output_tokens)"' "${KASEKI_RESULTS_DIR}/provider-attempts/${phase_name}/primary-2.json" 2>/dev/null || echo "unknown")"
      fi
      
      if [ -n "$primary_response_id" ] && [ "$retry_response_id" = "$primary_response_id" ]; then
        printf '[RETRY DUPLICATE] Gateway returned the same response_id=%s (attempt1_latency=%sms, attempt2_latency=%sms, tokens_1=%s, tokens_2=%s); treating as exhausted (not a transient retry candidate)\n' \
          "$retry_response_id" "$attempt1_latency" "$attempt2_latency" "$attempt1_tokens" "$attempt2_tokens" >&2
      fi
      
      if [ "$pi_exit" -eq 88 ]; then
        PROVIDER_ERROR_PRIMARY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$original_provider" "$model")"
      fi
      
      if [ "$pi_exit" -eq 0 ]; then
        PROVIDER_ERROR_RETRY_RESULT="success"
        provider_retry_emit_progress "$phase_name" "provider retry succeeded (attempt 2/2)"
        printf '[RETRY SUCCESS] Provider error resolved on retry in %s phase (correlation_id: %s)\n' \
          "$phase_name" "$KASEKI_INFERENCE_REQUEST_ID" >&2
      elif [ "$pi_exit" -eq 88 ]; then
        PROVIDER_ERROR_RETRY_ATTEMPT_COUNT=2
        PROVIDER_ERROR_RETRY_RESULT="failed"
        provider_retry_emit_progress "$phase_name" "provider retry exhausted (attempt 2/2); finalizing diagnostics"
        printf '[RETRY EXHAUSTED] Provider error persisted after retry in %s phase; budget exhausted (correlation_id: %s); exiting with code 88\n' \
          "$phase_name" "$KASEKI_INFERENCE_REQUEST_ID" >&2
      fi
    fi
  fi

  # A configured fallback is an explicit operator opt-in. Use it only after a
  # retryable primary provider error has exhausted the primary retry budget.
  if [ "$pi_exit" -eq 88 ] && [ "$PROVIDER_ERROR_RETRY_RESULT" = "failed" ] && \
    [ -n "${KASEKI_PROVIDER_FALLBACK:-}" ] && \
    { [ "$KASEKI_PROVIDER_FALLBACK" != "$original_provider" ] || [ -n "${KASEKI_PROVIDER_FALLBACK_MODEL:-}" ]; }; then
    fallback_provider="$KASEKI_PROVIDER_FALLBACK"
    fallback_model="${KASEKI_PROVIDER_FALLBACK_MODEL:-$original_model}"
    PROVIDER_ERROR_FALLBACK_PROVIDER="$fallback_provider"
    PROVIDER_ERROR_FALLBACK_MODEL="$fallback_model"
    PROVIDER_ERROR_FALLBACK_RESULT="attempted"
    KASEKI_PROVIDER="$fallback_provider"
    model="$fallback_model"
    attempt=1
    rm -f "$raw_events_file" 2>/dev/null || true
    : > "$raw_events_file"
    previous_request_id="$KASEKI_INFERENCE_REQUEST_ID"
    KASEKI_INFERENCE_REQUEST_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())' 2>/dev/null || printf 'req-%s-fallback' "$(date +%s)")"
    export KASEKI_INFERENCE_REQUEST_ID
    printf '[PROVIDER FALLBACK] Primary provider exhausted; request %s replaces %s using provider=%s model=%s\n' \
      "$KASEKI_INFERENCE_REQUEST_ID" "$previous_request_id" "$fallback_provider" "$fallback_model" >&2
    invoke_pi
    pi_exit=$?
    summarize_invocation || true
    snapshot_provider_attempt "$raw_events_file" "$summary_file" "$phase_name" "$fallback_provider" "$fallback_model" "fallback-1"
    if [ "$pi_exit" -eq 0 ]; then
      PROVIDER_ERROR_FALLBACK_RESULT="success"
      PROVIDER_ERROR_RECOVERY_JSON="$(provider_error_json_from_summary "$summary_file" "$phase_name" "$fallback_provider" "$fallback_model")"
      printf '[PROVIDER FALLBACK SUCCESS] provider=%s model=%s correlation_id=%s\n' \
        "$fallback_provider" "$fallback_model" "$KASEKI_INFERENCE_REQUEST_ID" >&2
    else
      PROVIDER_ERROR_FALLBACK_RESULT="failed"
      printf '[PROVIDER FALLBACK FAILED] provider=%s model=%s correlation_id=%s exit=%s\n' \
        "$fallback_provider" "$fallback_model" "$KASEKI_INFERENCE_REQUEST_ID" "$pi_exit" >&2
    fi
    KASEKI_PROVIDER="$original_provider"
    model="$original_model"
  fi

  # A later goal-check coding attempt must not erase recovery telemetry from an
  # earlier attempt when the later invocation itself needed no recovery.
  if [ "$pi_exit" -eq 0 ] && [ "$PROVIDER_ERROR_RETRY_ATTEMPT_COUNT" -eq 0 ] && \
    [ "$PROVIDER_ERROR_FALLBACK_RESULT" = "none" ] && \
    { [ "$previous_retry_attempt_count" -gt 0 ] || [ "$previous_fallback_result" != "none" ]; }; then
    PROVIDER_ERROR_RETRYABLE="$previous_retryable"
    PROVIDER_ERROR_RETRY_ATTEMPT_COUNT="$previous_retry_attempt_count"
    PROVIDER_ERROR_RETRY_RESULT="$previous_retry_result"
    PROVIDER_ERROR_FALLBACK_PROVIDER="$previous_fallback_provider"
    PROVIDER_ERROR_FALLBACK_MODEL="$previous_fallback_model"
    PROVIDER_ERROR_FALLBACK_RESULT="$previous_fallback_result"
  fi
  
  return "$pi_exit"
}
