#!/usr/bin/env bash
# Ensures GitHub preflight resolves default secret files from KASEKI_SECRETS_DIR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

HELPER_PATH="$TMP_DIR/github-app-token"
HEALTH_LOG="$TMP_DIR/github-health-check.log"
SECRETS_OK="$TMP_DIR/secrets-ok"
SECRETS_MISSING="$TMP_DIR/secrets-missing"
mkdir -p "$SECRETS_OK" "$SECRETS_MISSING"

cat > "$HELPER_PATH" <<'EOF_HELPER'
#!/usr/bin/env bash
if [ "$#" -eq 0 ]; then
  printf 'Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>\n' >&2
  exit 1
fi
printf '{"token":"ghs_test"}\n'
EOF_HELPER
chmod +x "$HELPER_PATH"

printf '123456\n' > "$SECRETS_OK/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_OK/github_app_client_id"
printf '%s\n' '-----BEGIN PRIVATE KEY----- test -----END PRIVATE KEY-----' > "$SECRETS_OK/github_app_private_key"

FUNCTIONS_FILE="$TMP_DIR/preflight-functions.sh"
awk '
  /^check_github_operations_health\(\)/ { emit=1 }
  /^validate_github_api_response\(\)/ { emit=0 }
  emit { print }
' "$PROJECT_ROOT/kaseki-agent.sh" |
  sed \
    -e "s#/results/github-health-check.log#$HEALTH_LOG#g" \
    -e "s#/usr/local/bin/github-app-token#$HELPER_PATH#g" \
    > "$FUNCTIONS_FILE"

# shellcheck disable=SC1090
. "$FUNCTIONS_FILE"

# Case 1: with only KASEKI_SECRETS_DIR defaults, preflight should pass.
export KASEKI_SECRETS_DIR="$SECRETS_OK"
export KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
export KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK=0
unset GITHUB_APP_ID_FILE GITHUB_APP_CLIENT_ID_FILE GITHUB_APP_PRIVATE_KEY_FILE
export REPO_URL=""

if ! check_github_operations_health >"$TMP_DIR/case1.stdout" 2>"$TMP_DIR/case1.stderr"; then
  printf '✗ health check failed when secrets were present in KASEKI_SECRETS_DIR\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -Fq '[health-check] ✓ GitHub App secrets are readable' "$HEALTH_LOG"; then
  printf '✗ health check did not report readable secrets from KASEKI_SECRETS_DIR\n'
  cat "$HEALTH_LOG"
  exit 1
fi

# Case 2: missing files should point to KASEKI_SECRETS_DIR path, not /agents/secrets.
KASEKI_SECRETS_DIR="$SECRETS_MISSING"
if check_github_operations_health >"$TMP_DIR/case2.stdout" 2>"$TMP_DIR/case2.stderr"; then
  printf '✗ health check unexpectedly passed with missing secrets\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -Fq "${SECRETS_MISSING}/github_app_id" "$HEALTH_LOG"; then
  printf '✗ missing secret error did not reference KASEKI_SECRETS_DIR path\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if grep -Fq '/agents/secrets/' "$HEALTH_LOG"; then
  printf '✗ missing secret error referenced /agents/secrets fallback\n'
  cat "$HEALTH_LOG"
  exit 1
fi

printf '✓ github preflight secret resolution honors KASEKI_SECRETS_DIR defaults\n'
