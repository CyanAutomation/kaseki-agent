#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2016
# tests/github-preflight-auth.test.sh
# Verifies GitHub preflight auth smoke test reports structured helper failures.

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
printf '{"error":"HTTP 404: installation not found for supplied repository","status":404}\n'
printf 'debug token ghp_abcdefghijklmnopqrstuvwxyz1234567890 should be redacted\n' >&2
exit 1
EOF_HELPER
chmod +x "$HELPER_PATH"
printf '123456\n' > "$SECRETS_DIR/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_DIR/github_app_client_id"
printf '%s' '-----BEGIN RSA PRIVATE KEY----- SUPER-SECRET-PRIVATE-KEY-BODY -----END RSA PRIVATE KEY-----' > "$SECRETS_DIR/github_app_private_key"

FUNCTIONS_FILE="$TMP_DIR/github-preflight-functions.sh"
cat > "$FUNCTIONS_FILE" <<'EOF_JSON_ENCODE'
json_encode() {
  node -e 'const fs = require("fs"); const input = fs.readFileSync(0, "utf8"); process.stdout.write(JSON.stringify(input));'
}
EOF_JSON_ENCODE
awk '
  /^parse_github_repo_url\(\)/ { emit=1 }
  /^validate_github_api_response\(\)/ { emit=0 }
  emit { print }
' "$PROJECT_ROOT/kaseki-agent.sh" |
  sed \
    -e "s#/results/github-health-check.log#$HEALTH_LOG#g" \
    -e "s#/run/secrets/github_app_id#$SECRETS_DIR/github_app_id#g" \
    -e "s#/run/secrets/github_app_client_id#$SECRETS_DIR/github_app_client_id#g" \
    -e "s#/run/secrets/github_app_private_key#$SECRETS_DIR/github_app_private_key#g" \
    -e "s#/results/github-app-private-key-metadata.json#$TMP_DIR/github-app-private-key-metadata.json#g" \
    -e "s#/usr/local/bin/github-app-token#$HELPER_PATH#g" \
    >> "$FUNCTIONS_FILE"
# shellcheck disable=SC1090
. "$FUNCTIONS_FILE"


HEALTH_SOURCE="$TMP_DIR/check-github-operations-health.sh"
awk '
  /^check_github_operations_health\(\)/ { emit=1 }
  /^validate_github_api_response\(\)/ { emit=0 }
  emit { print }
' "$PROJECT_ROOT/kaseki-agent.sh" > "$HEALTH_SOURCE"
ASKPASS_SOURCE="$TMP_DIR/github-askpass-helper.sh"
awk '
  /^create_github_askpass_helper\(\)/ { emit=1 }
  /^check_github_operations_health\(\)/ { emit=0 }
  emit { print }
' "$PROJECT_ROOT/kaseki-agent.sh" > "$ASKPASS_SOURCE"

if ! grep -Fq 'GitHub App token generation works for owner/repo' "$HEALTH_SOURCE" || \
   ! grep -Fq 'create_github_askpass_helper "$health_log"' "$HEALTH_SOURCE" || \
   ! grep -Fq '[health-check]' "$HEALTH_SOURCE"; then
  printf '✗ preflight health check does not create the askpass helper after token generation succeeds\n'
  cat "$HEALTH_SOURCE"
  exit 1
fi

TOKEN_SUCCESS_LINE="$(grep -nF 'GitHub App token generation works for owner/repo' "$HEALTH_SOURCE" | head -n 1 | cut -d: -f1)"
ASKPASS_CHECK_LINE="$(grep -nF 'create_github_askpass_helper "$health_log"' "$HEALTH_SOURCE" | head -n 1 | cut -d: -f1)"
if [ "$ASKPASS_CHECK_LINE" -le "$TOKEN_SUCCESS_LINE" ]; then
  printf '✗ preflight askpass helper check does not run after token generation succeeds\n'
  cat "$HEALTH_SOURCE"
  exit 1
fi

if ! grep -Fq 'Username for https://github.com' "$ASKPASS_SOURCE" || \
   ! grep -Fq 'x-access-token' "$ASKPASS_SOURCE" || \
   ! grep -Fq 'Password for https://github.com' "$ASKPASS_SOURCE" || \
   ! grep -Fq '[ -z "$password_smoke_output" ]' "$ASKPASS_SOURCE"; then
  printf '✗ askpass helper smoke check does not validate username and password prompt execution\n'
  cat "$ASKPASS_SOURCE"
  exit 1
fi

if ! grep -Fq 'GitHub askpass helper is not executable from %s' "$ASKPASS_SOURCE"; then
  printf '✗ askpass helper execution failure does not report the runtime directory\n'
  cat "$ASKPASS_SOURCE"
  exit 1
fi

# Test setup variables (SC2034: assigned for external use by sourced functions)
REPO_URL="https://github.com/acme/widgets"
KASEKI_SECRETS_DIR="$SECRETS_DIR"
KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=1

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

if grep -q 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' "$HEALTH_LOG"; then
  printf '✗ health check log leaked token-like stderr content\n'
  cat "$HEALTH_LOG"
  exit 1
fi

printf '✓ health check fails with sanitized structured helper error and no misleading pass\n'
