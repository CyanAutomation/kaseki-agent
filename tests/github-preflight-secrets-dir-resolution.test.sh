#!/usr/bin/env bash
# Ensures GitHub preflight accepts public IDs from the environment and retains
# compatibility with legacy ID files under KASEKI_SECRETS_DIR.

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

# shellcheck source=../scripts/github-preflight-health.sh
. "$PROJECT_ROOT/scripts/github-preflight-health.sh"

export KASEKI_SECRETS_DIR="$SECRETS_OK"
export KASEKI_RESULTS_DIR="$TMP_DIR"
export KASEKI_GITHUB_APP_TOKEN_HELPER="$HELPER_PATH"
export KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
export KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK=0
unset GITHUB_APP_ID_FILE GITHUB_APP_CLIENT_ID_FILE GITHUB_APP_PRIVATE_KEY_FILE
export REPO_URL=""

# Case 1: IDs from the environment and only the private key as a file.
export GITHUB_APP_ID=123456
export GITHUB_APP_CLIENT_ID=Iv1.testclient
rm "$SECRETS_OK/github_app_id" "$SECRETS_OK/github_app_client_id"
if ! check_github_operations_health "$HELPER_PATH" "$SECRETS_OK" "$TMP_DIR" "$HEALTH_LOG" >"$TMP_DIR/case1.stdout" 2>"$TMP_DIR/case1.stderr"; then
  printf '✗ health check failed with GitHub IDs from the environment\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -Fq '[health-check] ✓ GitHub App configuration and private key are readable' "$HEALTH_LOG"; then
  printf '✗ health check did not report readable GitHub configuration and private key\n'
  cat "$HEALTH_LOG"
  exit 1
fi

# Case 2: legacy ID files should remain usable when environment values are absent.
unset GITHUB_APP_ID GITHUB_APP_CLIENT_ID
printf '123456\n' > "$SECRETS_OK/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_OK/github_app_client_id"
if ! check_github_operations_health "$HELPER_PATH" "$SECRETS_OK" "$TMP_DIR" "$HEALTH_LOG" >"$TMP_DIR/case2.stdout" 2>"$TMP_DIR/case2.stderr"; then
  printf '✗ health check failed with legacy ID files in KASEKI_SECRETS_DIR\n'
  cat "$HEALTH_LOG"
  exit 1
fi

# Case 3: missing IDs should point to KASEKI_SECRETS_DIR path, not /agents/secrets.
export KASEKI_SECRETS_DIR="$SECRETS_MISSING"
if check_github_operations_health "$HELPER_PATH" "$SECRETS_MISSING" "$TMP_DIR" "$HEALTH_LOG" >"$TMP_DIR/case3.stdout" 2>"$TMP_DIR/case3.stderr"; then
  printf '✗ health check unexpectedly passed with missing IDs and key\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -Fq "${SECRETS_MISSING}/github_app_id" "$HEALTH_LOG"; then
  printf '✗ missing ID error did not reference KASEKI_SECRETS_DIR path\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if grep -Fq '/agents/secrets/' "$HEALTH_LOG"; then
  printf '✗ missing ID error referenced /agents/secrets fallback\n'
  cat "$HEALTH_LOG"
  exit 1
fi

printf '✓ github preflight accepts configured IDs and retains legacy file fallback\n'
