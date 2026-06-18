#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="kaseki-api.process-smoke.test"
# Test fixture: intentional fake API key for integration testing (allowlisted in .kaseki-secret-allowlist)
API_KEY="sk-test-integration-key"
TMP_ROOT="$(mktemp -d)"
RESULTS_DIR="${TMP_ROOT}/results"
API_LOG_DIR="${TMP_ROOT}/api-logs"
FAKE_REPO_ROOT="${TMP_ROOT}/fake-repo"
FAKE_SCRIPT="${FAKE_REPO_ROOT}/scripts/kaseki-activate.sh"
SERVER_LOG="${TMP_ROOT}/server.log"
READY_TIMEOUT_SECONDS="${KASEKI_TEST_READY_TIMEOUT_SECONDS:-6}"
JOB_TIMEOUT_SECONDS="${KASEKI_TEST_JOB_TIMEOUT_SECONDS:-8}"
CURL_TIMEOUT_SECONDS="${KASEKI_TEST_CURL_TIMEOUT_SECONDS:-2}"
PORT=""
SERVER_PID=""

mkdir -p "$RESULTS_DIR" "$API_LOG_DIR" "${FAKE_REPO_ROOT}/scripts"

cleanup() {
  local ec=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ $ec -ne 0 ]]; then
    echo "[$TEST_NAME] FAILED (exit=$ec)"
    [[ -f "$SERVER_LOG" ]] && tail -n 120 "$SERVER_LOG" | sed 's/^/[server] /'
    [[ -d "$RESULTS_DIR" ]] && find "$RESULTS_DIR" -maxdepth 3 -type f | sed 's/^/[artifact] /' || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 24 )); then
  echo "[$TEST_NAME] SKIP process smoke requires Node.js >=24; current node is $(node -v)"
  exit 0
fi

random_available_port() {
  node - <<'NODE'
const server = require('node:net').createServer();
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  server.close(() => process.stdout.write(String(port)));
});
NODE
}

wait_until() {
  local timeout_seconds="$1"
  local check_command="$2"
  local deadline=$((SECONDS + timeout_seconds))
  until bash -c "$check_command"; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 0.05
  done
}

cat > "$FAKE_SCRIPT" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
log_dir="${KASEKI_LOG_DIR:?missing KASEKI_LOG_DIR}"
mkdir -p "$log_dir"
printf '{"event":"start","stage":"bootstrap","detail":"boot"}\n' > "$log_dir/progress.jsonl"
printf 'fake stdout\n' > "$log_dir/stdout.log"
printf 'fake stderr\n' > "$log_dir/stderr.log"
printf '{"failure":null,"exit_code":0}\n' > "$log_dir/metadata.json"
printf '{"event":"done","stage":"complete","detail":"done"}\n' >> "$log_dir/progress.jsonl"
SCRIPT
chmod +x "$FAKE_SCRIPT"

PORT="$(random_available_port)"
echo "[$TEST_NAME] starting api server on random port :$PORT"
KASEKI_API_KEYS="$API_KEY" \
KASEKI_API_PORT="$PORT" \
KASEKI_RESULTS_DIR="$RESULTS_DIR" \
KASEKI_API_LOG_DIR="$API_LOG_DIR" \
KASEKI_API_MAX_CONCURRENT_RUNS=1 \
KASEKI_AGENT_TIMEOUT_SECONDS=30 \
KASEKI_SKIP_BOOTSTRAP_CHECK=1 \
PWD="$FAKE_REPO_ROOT" \
node dist/kaseki-api-service.js >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

wait_until "$READY_TIMEOUT_SECONDS" "grep -q 'service_started' '$SERVER_LOG' || curl -fsS --max-time '$CURL_TIMEOUT_SECONDS' 'http://127.0.0.1:$PORT/api/ready' >/dev/null" || {
  echo "[$TEST_NAME] service did not signal readiness within ${READY_TIMEOUT_SECONDS}s"
  exit 1
}

READY_RESP="$(curl -fsS --max-time "$CURL_TIMEOUT_SECONDS" "http://127.0.0.1:$PORT/api/ready")"
node -e "const p=JSON.parse(process.argv[1]); if (p.status !== 'ready') throw new Error('not ready: '+process.argv[1])" "$READY_RESP"

RUN_RESP="$(curl -fsS --max-time "$CURL_TIMEOUT_SECONDS" -X POST "http://127.0.0.1:$PORT/api/runs" \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"repoUrl":"https://github.com/example/repo","publishMode":"none"}')"
JOB_ID="$(node -e "const p=JSON.parse(process.argv[1]); if (!['queued','running'].includes(p.status)) throw new Error('bad status '+p.status); console.log(p.id)" "$RUN_RESP")"

wait_until "$JOB_TIMEOUT_SECONDS" "curl -fsS --max-time '$CURL_TIMEOUT_SECONDS' -H 'Authorization: Bearer $API_KEY' 'http://127.0.0.1:$PORT/api/runs/$JOB_ID/status' | node -e \"let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{const p=JSON.parse(b); process.exit(['completed','failed'].includes(p.status)?0:1)})\"" || {
  echo "[$TEST_NAME] job $JOB_ID did not reach a terminal state within ${JOB_TIMEOUT_SECONDS}s"
  exit 1
}

echo "[$TEST_NAME] PASS job_id=$JOB_ID"
