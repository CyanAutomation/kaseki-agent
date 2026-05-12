#!/usr/bin/env bash
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
printf '{"error":"HTTP 404: installation not found for supplied repository","status":404}\n'
printf 'debug token ghp_abcdefghijklmnopqrstuvwxyz1234567890 should be redacted\n' >&2
exit 1
EOF_HELPER
chmod +x "$HELPER_PATH"
printf '123456\n' > "$SECRETS_DIR/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_DIR/github_app_client_id"
printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'test-key' '-----END PRIVATE KEY-----' > "$SECRETS_DIR/github_app_private_key"

FUNCTIONS_FILE="$TMP_DIR/github-preflight-functions.sh"
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
    -e "s#/usr/local/bin/github-app-token#$HELPER_PATH#g" \
    > "$FUNCTIONS_FILE"
# shellcheck disable=SC1090
. "$FUNCTIONS_FILE"

REPO_URL="https://github.com/acme/widgets"
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
