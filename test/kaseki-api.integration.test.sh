#!/usr/bin/env bash
# shellcheck disable=SC2015
set -euo pipefail

TEST_NAME="kaseki-api.integration.test"
# Test fixture: intentional fake API key for integration testing (allowlisted in .kaseki-secret-allowlist)
API_KEY="sk-test-integration-key"
PORT="${KASEKI_TEST_API_PORT:-18080}"
BASE_URL="http://127.0.0.1:${PORT}/api"

TMP_ROOT="$(mktemp -d)"
if [[ -z "$TMP_ROOT" || ! -d "$TMP_ROOT" ]]; then
  echo "[$TEST_NAME] ERROR: Failed to create temporary directory"
  exit 1
fi
RESULTS_DIR="${TMP_ROOT}/results"
API_LOG_DIR="${TMP_ROOT}/api-logs"
FAKE_REPO_ROOT="${TMP_ROOT}/fake-repo"
FAKE_SCRIPT="${FAKE_REPO_ROOT}/scripts/kaseki-activate.sh"
SERVER_LOG="${TMP_ROOT}/server.log"
POLL_INTERVAL_SECONDS="${KASEKI_TEST_POLL_INTERVAL_SECONDS:-0.1}"
READY_TIMEOUT_SECONDS="${KASEKI_TEST_READY_TIMEOUT_SECONDS:-8}"
JOB_TIMEOUT_SECONDS="${KASEKI_TEST_JOB_TIMEOUT_SECONDS:-12}"
CURL_TIMEOUT_SECONDS="${KASEKI_TEST_CURL_TIMEOUT_SECONDS:-2}"

mkdir -p "$RESULTS_DIR" "$API_LOG_DIR" "${FAKE_REPO_ROOT}/scripts"

cleanup() {
  local ec=$?
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [[ $ec -ne 0 ]]; then
    echo "[$TEST_NAME] FAILED (exit=$ec)"
    echo "[$TEST_NAME] Diagnostics:"
    [[ -f "$SERVER_LOG" ]] && tail -n 120 "$SERVER_LOG" | sed 's/^/[server] /'
    [[ -d "$RESULTS_DIR" ]] && find "$RESULTS_DIR" -maxdepth 3 -type f | sed 's/^/[artifact] /' || true
  fi

  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

cat > "$FAKE_SCRIPT" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
log_dir="${KASEKI_LOG_DIR:?missing KASEKI_LOG_DIR}"
mkdir -p "$log_dir"
printf '{"event":"start","stage":"bootstrap","detail":"boot"}\n' > "$log_dir/progress.jsonl"
printf 'fake stdout\n' > "$log_dir/stdout.log"
printf 'fake stderr\n' > "$log_dir/stderr.log"
printf '{"failure":null}\n' > "$log_dir/metadata.json"
printf '{"event":"done","stage":"complete","detail":"done"}\n' >> "$log_dir/progress.jsonl"
SCRIPT
chmod +x "$FAKE_SCRIPT"

echo "[$TEST_NAME] starting api server on :$PORT"
KASEKI_API_KEYS="$API_KEY" \
KASEKI_API_PORT="$PORT" \
KASEKI_RESULTS_DIR="$RESULTS_DIR" \
KASEKI_API_LOG_DIR="$API_LOG_DIR" \
KASEKI_API_MAX_CONCURRENT_RUNS=1 \
KASEKI_AGENT_TIMEOUT_SECONDS=30 \
PWD="$FAKE_REPO_ROOT" \
node dist/kaseki-api-service.js >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

now_ms() {
  python3 - <<'PY'
import time
print(int(time.monotonic() * 1000))
PY
}

timeout_ms() {
  python3 - "$1" <<'PY'
import sys
print(int(float(sys.argv[1]) * 1000))
PY
}

print_poll_diagnostics() {
  local label="$1"
  local endpoint="$2"
  local timeout_seconds="$3"
  local last_status="$4"
  local last_response="$5"
  local last_error="$6"

  echo "[$TEST_NAME] ${label} did not become ready within ${timeout_seconds}s"
  echo "[$TEST_NAME] endpoint=$endpoint"
  echo "[$TEST_NAME] last_http_status=${last_status:-<none>}"
  if [[ -n "$last_response" ]]; then
    echo "[$TEST_NAME] last_response=$last_response"
  fi
  if [[ -n "$last_error" ]]; then
    echo "[$TEST_NAME] last_curl_error=$last_error"
  fi
}

wait_for_api_readiness() {
  local endpoint="$BASE_URL/ready"
  local timeout_seconds="$READY_TIMEOUT_SECONDS"
  local deadline=$(( $(now_ms) + $(timeout_ms "$timeout_seconds") ))
  local body_file err_file status last_status="" last_response="" last_error=""

  body_file="$(mktemp "$TMP_ROOT/ready-body.XXXXXX")"
  err_file="$(mktemp "$TMP_ROOT/ready-error.XXXXXX")"

  while (( $(now_ms) < deadline )); do
    : >"$body_file"
    : >"$err_file"
    status="$(curl -sS --max-time "$CURL_TIMEOUT_SECONDS" -o "$body_file" -w '%{http_code}' "$endpoint" 2>"$err_file" || true)"
    last_status="$status"
    last_response="$(head -c 1000 "$body_file" || true)"
    last_error="$(head -c 1000 "$err_file" || true)"

    if [[ "$status" == "200" ]] && python3 - "$body_file" <<'PY'
import json
import sys
try:
    payload = json.load(open(sys.argv[1], encoding='utf-8'))
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)
raise SystemExit(0 if payload.get('status') == 'ready' else 1)
PY
    then
      return 0
    fi

    sleep "$POLL_INTERVAL_SECONDS"
  done

  print_poll_diagnostics "readiness endpoint" "$endpoint" "$timeout_seconds" "$last_status" "$last_response" "$last_error"
  return 1
}

wait_for_api_readiness

RUN_PAYLOAD='{"repoUrl":"https://github.com/example/repo"}'
RUN_RESP="$(curl -sS -X POST "$BASE_URL/runs" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  --data "$RUN_PAYLOAD")"

JOB_ID="$(python3 - "$RUN_RESP" <<'PY'
import json, re, sys
try:
    obj=json.loads(sys.argv[1])
except (json.JSONDecodeError, ValueError) as e:
    raise SystemExit(f"API returned invalid JSON: {e}; response: {sys.argv[1][:200]}")
if obj.get('status') not in {'queued','running'}:
    raise SystemExit(f"expected status queued|running, got {obj.get('status')}")
idv=obj.get('id','')
if not re.fullmatch(r'kaseki-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', idv):
    raise SystemExit(f"invalid job id format: {idv}")
print(idv)
PY
)"

LIST_RESP="$(curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/runs")"
python3 - "$LIST_RESP" "$JOB_ID" <<'PY'
import json, sys
try:
    obj=json.loads(sys.argv[1])
except (json.JSONDecodeError, ValueError) as e:
    raise SystemExit(f"API returned invalid JSON: {e}; response: {sys.argv[1][:200]}")
job_id=sys.argv[2]
if obj.get('total',0) < 1:
    raise SystemExit('runs total is < 1')
runs=obj.get('runs',[])
match=[r for r in runs if r.get('id')==job_id]
if not match:
    raise SystemExit('submitted run missing from list response')
PY

history=""
final=""
last_status_code=""
last_status_response=""
last_status_error=""
status_body_file="$(mktemp "$TMP_ROOT/status-body.XXXXXX")"
status_error_file="$(mktemp "$TMP_ROOT/status-error.XXXXXX")"
status_deadline=$(( $(now_ms) + $(timeout_ms "$JOB_TIMEOUT_SECONDS") ))
while (( $(now_ms) < status_deadline )); do
  : >"$status_body_file"
  : >"$status_error_file"
  last_status_code="$(curl -sS --max-time "$CURL_TIMEOUT_SECONDS" -o "$status_body_file" -w '%{http_code}' \
    -H "Authorization: Bearer $API_KEY" "$BASE_URL/runs/$JOB_ID/status" 2>"$status_error_file" || true)"
  last_status_response="$(head -c 1000 "$status_body_file" || true)"
  last_status_error="$(head -c 1000 "$status_error_file" || true)"

  if [[ "$last_status_code" == "200" ]]; then
    cur="$(python3 - "$last_status_response" <<'PY'
import json, sys
try:
    print(json.loads(sys.argv[1]).get('status',''))
except (json.JSONDecodeError, ValueError) as e:
    raise SystemExit(f"API returned invalid JSON: {e}; response: {sys.argv[1][:200]}")
PY
)"
    [[ -n "$history" ]] && history+=" "
    history+="$cur"
    if [[ "$cur" == "completed" || "$cur" == "failed" ]]; then
      final="$cur"
      break
    fi
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

if [[ -z "$final" ]]; then
  echo "[$TEST_NAME] job did not reach terminal state within ${JOB_TIMEOUT_SECONDS}s; history=$history"
  echo "[$TEST_NAME] status_endpoint=$BASE_URL/runs/$JOB_ID/status"
  echo "[$TEST_NAME] last_http_status=${last_status_code:-<none>}"
  [[ -n "$last_status_response" ]] && echo "[$TEST_NAME] last_response=$last_status_response"
  [[ -n "$last_status_error" ]] && echo "[$TEST_NAME] last_curl_error=$last_status_error"
  exit 1
fi

python3 - "$history" <<'PY'
import sys
states=sys.argv[1].split()
allowed={
    'queued': {'queued','running','completed','failed'},
    'running': {'running','completed','failed'},
    'completed': {'completed'},
    'failed': {'failed'},
}
for a,b in zip(states, states[1:]):
    if b not in allowed.get(a,set()):
        raise SystemExit(f'invalid state transition: {a} -> {b}; full={states}')
PY

ART_DIR="$RESULTS_DIR/$JOB_ID"
for f in progress.jsonl metadata.json stdout.log stderr.log; do
  if [[ ! -f "$ART_DIR/$f" ]]; then
    echo "[$TEST_NAME] missing artifact file: $ART_DIR/$f"
    exit 1
  fi
done

echo "[$TEST_NAME] PASS job_id=$JOB_ID final=$final"
