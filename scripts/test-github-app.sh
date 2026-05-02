#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/dist/github-app-token.js"
RUNNER="$ROOT_DIR/run-kaseki.sh"

if [ ! -x "$HELPER" ]; then
  if command -v npx >/dev/null 2>&1; then
    npx --yes tsc "$ROOT_DIR/src/github-app-token.ts" --outDir "$ROOT_DIR/dist" --target es2020 --module commonjs --esModuleInterop >/dev/null 2>&1 || true
    chmod +x "$HELPER" 2>/dev/null || true
  fi
fi

if [ ! -x "$HELPER" ]; then
  echo "Expected executable helper at $HELPER" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

assert_token_error_contract() {
  local expected_exit="$1"
  local expected_substring="$2"
  shift 2

  local stdout_file="$TMP_DIR/token.stdout"
  local stderr_file="$TMP_DIR/token.stderr"

  set +e
  node "$HELPER" "$@" >"$stdout_file" 2>"$stderr_file"
  local status=$?
  set -e

  if [ "$status" -ne "$expected_exit" ]; then
    echo "Unexpected helper exit code. expected=$expected_exit got=$status args=[$*]" >&2
    exit 1
  fi

  if [ "$expected_substring" = "Usage:" ]; then
    if ! grep -q "Usage:" "$stderr_file"; then
      echo "Expected usage message in stderr for args=[$*]" >&2
      exit 1
    fi
    if [ -s "$stdout_file" ]; then
      echo "Expected empty stdout for usage errors" >&2
      exit 1
    fi
    return
  fi

  node -e '
const fs = require("node:fs");
const stdoutPath = process.argv[1];
const expected = process.argv[2];
const raw = fs.readFileSync(stdoutPath, "utf8").trim();
if (!raw) throw new Error("expected JSON output on stdout");
let parsed;
try { parsed = JSON.parse(raw); } catch (err) { throw new Error(`invalid JSON output: ${err.message}`); }
if (!parsed.error || typeof parsed.error !== "string") throw new Error("missing string error field");
if (!parsed.error.includes(expected)) throw new Error(`error field missing expected substring: ${expected}`);
' "$stdout_file" "$expected_substring"
}

echo "Test 1: helper arg validation + structured failures"
assert_token_error_contract 1 "Usage:"
assert_token_error_contract 1 "Usage:" "123" "missing.pem" "owner"
assert_token_error_contract 1 "ENOENT" "123" "$TMP_DIR/does-not-exist.pem" "owner" "repo"

MOCK_KEY="$TMP_DIR/mock-key.pem"
openssl genrsa -out "$MOCK_KEY" 2048 >/dev/null 2>&1

run_helper_with_https_mock() {
  local fixture="$1"
  local stdout_file="$TMP_DIR/mock-${fixture}.stdout"
  local stderr_file="$TMP_DIR/mock-${fixture}.stderr"

  set +e
  NODE_OPTIONS="--require $TMP_DIR/mock-https.js" MOCK_GITHUB_FIXTURE="$fixture" \
    node "$HELPER" "123" "$MOCK_KEY" "octo" "hello" >"$stdout_file" 2>"$stderr_file"
  local status=$?
  set -e

  echo "$status" > "$TMP_DIR/mock-${fixture}.status"
}

cat > "$TMP_DIR/mock-https.js" <<'EOF_JS'
const https = require('node:https');
const { EventEmitter } = require('node:events');

const fixture = process.env.MOCK_GITHUB_FIXTURE;
const original = https.request;

https.request = (options, cb) => {
  const req = new EventEmitter();
  req.end = () => {
    const res = new EventEmitter();
    res.statusCode = 500;
    let body = '{"error":"unconfigured fixture"}';

    if (fixture === 'success-installation') {
      if (options.path.endsWith('/installation')) {
        res.statusCode = 200;
        body = JSON.stringify({ id: 777 });
      } else if (options.path.includes('/access_tokens')) {
        res.statusCode = 201;
        body = JSON.stringify({ token: 'ghu_fixture_token', expires_at: '2026-06-01T00:00:00Z' });
      }
    } else if (fixture === 'installation-failure' && options.path.endsWith('/installation')) {
      res.statusCode = 404;
      body = JSON.stringify({ message: 'Not Found' });
    } else if (fixture === 'token-failure') {
      if (options.path.endsWith('/installation')) {
        res.statusCode = 200;
        body = JSON.stringify({ id: 777 });
      } else if (options.path.includes('/access_tokens')) {
        res.statusCode = 403;
        body = JSON.stringify({ message: 'Forbidden' });
      }
    }

    process.nextTick(() => {
      cb(res);
      res.emit('data', Buffer.from(body));
      res.emit('end');
    });
  };
  req.on = (...args) => EventEmitter.prototype.on.apply(req, args);
  return req;
};

process.on('exit', () => { https.request = original; });
EOF_JS

echo "Test 2: helper token-generation flow with stubbed GitHub API"
run_helper_with_https_mock success-installation
[ "$(cat "$TMP_DIR/mock-success-installation.status")" -eq 0 ] || { echo "Expected success fixture to exit 0" >&2; exit 1; }
node -e '
const fs = require("node:fs");
const out = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (out.token !== "ghu_fixture_token") throw new Error("token mismatch");
if (out.expires_at !== "2026-06-01T00:00:00Z") throw new Error("expires_at mismatch");
' "$TMP_DIR/mock-success-installation.stdout"

run_helper_with_https_mock installation-failure
[ "$(cat "$TMP_DIR/mock-installation-failure.status")" -eq 1 ] || { echo "Expected installation failure exit 1" >&2; exit 1; }
node -e 'const f=require("node:fs"); const out=JSON.parse(f.readFileSync(process.argv[1],"utf8")); if (!out.error.includes("Failed to get installation ID")) throw new Error("missing installation error");' "$TMP_DIR/mock-installation-failure.stdout"

run_helper_with_https_mock token-failure
[ "$(cat "$TMP_DIR/mock-token-failure.status")" -eq 1 ] || { echo "Expected token failure exit 1" >&2; exit 1; }
node -e 'const f=require("node:fs"); const out=JSON.parse(f.readFileSync(process.argv[1],"utf8")); if (!out.error.includes("Failed to get access token")) throw new Error("missing token error");' "$TMP_DIR/mock-token-failure.stdout"

echo "Test 3/4: run-kaseki metadata + credential artifact handling"
DOCKER_BIN="$TMP_DIR/docker"
cat > "$DOCKER_BIN" <<'EOF_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "run" ]; then
  result_dir=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-v" ]; then
      shift
      case "$1" in
        *:/results) result_dir="${1%%:/results}" ;;
      esac
    fi
    shift || true
  done
  [ -n "$result_dir" ] || { echo "missing results mount" >&2; exit 1; }
  mkdir -p "$result_dir"
  cat > "$result_dir/metadata.json" <<'META'
{
  "github_pr_url": "https://github.com/octo/hello/pull/42",
  "github_push_exit_code": 0,
  "github_pr_exit_code": 1
}
META
  touch "$result_dir/stdout.log" "$result_dir/stderr.log" "$result_dir/progress.log" "$result_dir/progress.jsonl" "$result_dir/quality.log" "$result_dir/secret-scan.log" "$result_dir/git-push.log"
  exit 0
fi
exit 0
EOF_DOCKER
chmod +x "$DOCKER_BIN"

KASEKI_ROOT="$TMP_DIR/kaseki-root"
mkdir -p "$KASEKI_ROOT"
HOST_KEY_FILE="$TMP_DIR/github-app.pem"
printf '%s\n' 'PRIVATEKEY' > "$HOST_KEY_FILE"

mkdir -p "$TMP_DIR/scripts"
cat > "$TMP_DIR/scripts/kaseki-preflight.sh" <<'EOF_PREFLIGHT'
#!/usr/bin/env bash
exit 0
EOF_PREFLIGHT
chmod +x "$TMP_DIR/scripts/kaseki-preflight.sh"

set +e
env PATH="$TMP_DIR:/usr/bin:/bin" \
  KASEKI_ROOT="$KASEKI_ROOT" \
  OPENROUTER_API_KEY="dummy" \
  GITHUB_APP_ID="1" \
  GITHUB_APP_CLIENT_ID="abc" \
  GITHUB_APP_PRIVATE_KEY_FILE="$HOST_KEY_FILE" \
  "$RUNNER" >"$TMP_DIR/run.stdout" 2>"$TMP_DIR/run.stderr"
run_status=$?
set -e

[ -f "$TMP_DIR/run.stderr" ] || true
result_dir="$KASEKI_ROOT/kaseki-results/kaseki-1"
[ -d "$result_dir" ] || { echo "Expected result dir" >&2; exit 1; }

node -e '
const fs = require("node:fs");
const path = require("node:path");
const dir = process.argv[1];
const jsonFiles = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
let found = false;
for (const file of jsonFiles) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
  if (Object.prototype.hasOwnProperty.call(data, "github_pr_url") &&
      Object.prototype.hasOwnProperty.call(data, "github_push_exit_code") &&
      Object.prototype.hasOwnProperty.call(data, "github_pr_exit_code")) {
    found = true;
    break;
  }
}
if (!found) throw new Error("no JSON artifact includes github_pr_url/github_push_exit_code/github_pr_exit_code");
' "$result_dir"

if ! grep -q "workspace_removed=" "$result_dir/cleanup.log"; then
  echo "Expected cleanup.log to include workspace removal status" >&2
  exit 1
fi

if [ ! -f "$result_dir/cleanup.log" ]; then
  echo "Expected cleanup.log artifact" >&2
  exit 1
fi

echo "All behavior-focused GitHub App tests passed"
