#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="kaseki-api.integration.test"
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
sleep 0.2
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

for _ in $(seq 1 80); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health" || true)"
  if [[ "$code" == "200" ]]; then
    break
  fi
  sleep 0.1
done

if [[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health" || true)" != "200" ]]; then
  echo "[$TEST_NAME] health endpoint did not become ready"
  exit 1
fi

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
obj=json.loads(sys.argv[1])
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
for _ in $(seq 1 120); do
  STATUS_RESP="$(curl -sS -H "Authorization: Bearer $API_KEY" "$BASE_URL/runs/$JOB_ID/status")"
  cur="$(python3 - "$STATUS_RESP" <<'PY'
import json, sys
print(json.loads(sys.argv[1]).get('status',''))
PY
)"
  [[ -n "$history" ]] && history+=" "
  history+="$cur"
  if [[ "$cur" == "completed" || "$cur" == "failed" ]]; then
    final="$cur"
    break
  fi
  sleep 0.1
done

if [[ -z "$final" ]]; then
  echo "[$TEST_NAME] job did not reach terminal state; history=$history"
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
