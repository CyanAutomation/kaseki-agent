#!/usr/bin/env bash
# shellcheck disable=SC2034
# tests/github-preflight-auth.test.sh
# Verifies GitHub preflight auth helper reports structured helper failures safely.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SECRETS_DIR="$TMP_DIR/secrets"
HELPER_PATH="$TMP_DIR/github-app-token"
HEALTH_LOG="$TMP_DIR/github-health-check.log"
mkdir -p "$SECRETS_DIR"

cat > "$HELPER_PATH" <<'EOF_HELPER'
#!/usr/bin/env bash
if [ "$#" -eq 0 ]; then
  printf 'Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>\n' >&2
  exit 1
fi
if [ "$#" -eq 4 ] && [ "${KASEKI_TEST_HELPER_MODE:-failure}" = "success" ]; then
  printf '{"token":"%s"}\n' "${KASEKI_TEST_INSTALLATION_TOKEN:?}"
  exit 0
fi
if [ "$#" -eq 4 ] && [ "${KASEKI_TEST_HELPER_MODE:-failure}" = "empty-token" ]; then
  printf '{"token":""}\n'
  exit 0
fi
printf '{"error":"HTTP 404: installation not found for supplied repository","status":404}\n'
printf 'debug token %s should be redacted\n' "${KASEKI_TEST_REDACTED_TOKEN:?}" >&2
exit 1
EOF_HELPER
chmod +x "$HELPER_PATH"
printf '123456\n' > "$SECRETS_DIR/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_DIR/github_app_client_id"
printf '%s' '-----BEGIN RSA PRIVATE KEY----- SUPER-SECRET-PRIVATE-KEY-BODY -----END RSA PRIVATE KEY-----' > "$SECRETS_DIR/github_app_private_key"

# Stable entry point for helper functions under test.
# shellcheck source=../scripts/lib/json.sh
. "$PROJECT_ROOT/scripts/lib/json.sh"
# shellcheck source=../scripts/github-preflight-auth.sh
. "$PROJECT_ROOT/scripts/github-preflight-auth.sh"

# Test setup variables (SC2034: assigned for external use by sourced functions)
REPO_URL="https://github.com/acme/widgets"
KASEKI_SECRETS_DIR="$SECRETS_DIR"
KASEKI_RESULTS_DIR="$TMP_DIR"
KASEKI_HEALTH_LOG="$HEALTH_LOG"
KASEKI_GITHUB_APP_TOKEN_HELPER="$HELPER_PATH"
KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=1
KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK=0
KASEKI_TEST_REDACTED_TOKEN="ghp_${KASEKI_TEST_TOKEN_SUFFIX:-abcdefghijklmnopqrstuvwxyz1234567890}"
KASEKI_TEST_INSTALLATION_TOKEN="${KASEKI_TEST_INSTALLATION_TOKEN:-mock-installation-token}"
export KASEKI_TEST_REDACTED_TOKEN KASEKI_TEST_INSTALLATION_TOKEN

if check_github_operations_health >"$TMP_DIR/stdout.log" 2>"$TMP_DIR/stderr.log"; then
  printf '✗ health check unexpectedly passed when github-app-token returned a structured failure\n'
  exit 1
fi

if ! grep -q 'GitHub App token generation failed for owner/repo: HTTP 404: installation not found for supplied repository' "$HEALTH_LOG"; then
  printf '✗ health check log did not include sanitized structured helper error\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -q 'GitHub App private key metadata:' "$HEALTH_LOG"; then
  printf '✗ health check log did not include private key metadata\n'
  cat "$HEALTH_LOG"
  exit 1
fi

node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const key = fs.readFileSync(process.argv[2]);
const expectedHash = crypto.createHash("sha256").update(key).digest("hex");
if (metadata.byte_count !== key.length) throw new Error("byte_count mismatch");
if (metadata.first_pem_header_line !== "-----BEGIN RSA PRIVATE KEY-----") throw new Error(`header mismatch: ${metadata.first_pem_header_line}`);
if (metadata.pem_footer_present !== true) throw new Error("footer flag mismatch");
if (metadata.sha256_fingerprint !== expectedHash) throw new Error("fingerprint mismatch");
' "$TMP_DIR/github-app-private-key-metadata.json" "$SECRETS_DIR/github_app_private_key"

if grep -q 'SUPER-SECRET-PRIVATE-KEY-BODY' "$HEALTH_LOG" "$TMP_DIR/github-app-private-key-metadata.json"; then
  printf '✗ health check metadata leaked private key body content\n'
  cat "$HEALTH_LOG"
  cat "$TMP_DIR/github-app-private-key-metadata.json"
  exit 1
fi

if grep -q 'github operations health check PASSED' "$HEALTH_LOG"; then
  printf '✗ health check reported PASSED after the helper failure\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if grep -q "$KASEKI_TEST_REDACTED_TOKEN" "$HEALTH_LOG"; then
  printf '✗ health check log leaked token-like stderr content\n'
  cat "$HEALTH_LOG"
  exit 1
fi

ASKPASS_LOG="$TMP_DIR/askpass.log"
KASEKI_GITHUB_ASKPASS_DIR="$TMP_DIR/askpass-runtime"
if ! create_github_askpass_helper "$ASKPASS_LOG" '[test-askpass]'; then
  printf '✗ askpass helper creation failed\n'
  cat "$ASKPASS_LOG"
  exit 1
fi
if [ ! -x "$GITHUB_ASKPASS_FILE" ]; then
  printf '✗ askpass helper is not executable\n'
  exit 1
fi
TEST_ASKPASS_TOKEN="${KASEKI_TEST_ASKPASS_TOKEN:-mock-askpass-token}"
username_output="$(KASEKI_GITHUB_TOKEN="$TEST_ASKPASS_TOKEN" "$GITHUB_ASKPASS_FILE" 'Username for https://github.com')"
password_output="$(KASEKI_GITHUB_TOKEN="$TEST_ASKPASS_TOKEN" "$GITHUB_ASKPASS_FILE" 'Password for https://github.com')"
rm -f "$GITHUB_ASKPASS_FILE"
if ! constant_time_equals "x-access-token" "$username_output" || ! constant_time_equals "$TEST_ASKPASS_TOKEN" "$password_output"; then
  printf '✗ askpass helper did not return expected username/password prompt responses\n'
  printf 'username=%s password=%s\n' "$username_output" "$password_output"
  exit 1
fi

printf '✓ health check fails with sanitized structured helper error, safe metadata, token redaction, and working askpass helper\n'


KASEKI_TEST_HELPER_MODE=success
export KASEKI_TEST_HELPER_MODE
if ! check_github_operations_health >"$TMP_DIR/success-stdout.log" 2>"$TMP_DIR/success-stderr.log"; then
  printf '✗ health check failed when github-app-token returned a valid token\n'
  cat "$TMP_DIR/success-stdout.log"
  cat "$TMP_DIR/success-stderr.log"
  cat "$HEALTH_LOG"
  exit 1
fi
if ! grep -q 'github operations health check PASSED' "$HEALTH_LOG"; then
  printf '✗ health check did not report PASSED after valid token generation\n'
  cat "$HEALTH_LOG"
  exit 1
fi
printf '✓ health check passes with valid mock token and standard success exit code\n'

KASEKI_TEST_HELPER_MODE=empty-token
export KASEKI_TEST_HELPER_MODE
if check_github_operations_health >"$TMP_DIR/empty-token-stdout.log" 2>"$TMP_DIR/empty-token-stderr.log"; then
  printf '✗ health check unexpectedly passed when github-app-token returned an empty token\n'
  cat "$HEALTH_LOG"
  exit 1
fi
if ! grep -q 'GitHub authentication failed: Unable to obtain installation token' "$HEALTH_LOG"; then
  printf '✗ health check did not report empty installation token failure\n'
  cat "$HEALTH_LOG"
  exit 1
fi
printf '✓ health check fails when mock token is empty with standard failure exit code\n'
