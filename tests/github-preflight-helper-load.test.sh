#!/usr/bin/env bash
# shellcheck disable=SC2034
# tests/github-preflight-helper-load.test.sh
# Verifies GitHub preflight distinguishes helper file presence from runtime import loading.

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
#!/usr/bin/env node
import './github-app-private-key.js';

console.error('Usage: node github-app-token.js <app-id> <private-key-file> <owner> <repo>');
process.exit(1);
EOF_HELPER
chmod +x "$HELPER_PATH"
printf '123456\n' > "$SECRETS_DIR/github_app_id"
printf 'Iv1.testclient\n' > "$SECRETS_DIR/github_app_client_id"
printf '%s' '-----BEGIN RSA PRIVATE KEY----- SUPER-SECRET-PRIVATE-KEY-BODY -----END RSA PRIVATE KEY-----' > "$SECRETS_DIR/github_app_private_key"

# Source the stable module entry point; all runtime files remain under TMP_DIR.
# shellcheck source=../scripts/github-preflight-health.sh
. "$PROJECT_ROOT/scripts/github-preflight-health.sh"

# These variables are used by sourced functions
REPO_URL="https://github.com/acme/widgets"
KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
KASEKI_RESULTS_DIR="$TMP_DIR"
KASEKI_HEALTH_LOG="$HEALTH_LOG"
KASEKI_SECRETS_DIR="$SECRETS_DIR"
export KASEKI_RESULTS_DIR KASEKI_HEALTH_LOG KASEKI_SECRETS_DIR

if check_github_operations_health "$HELPER_PATH" "$SECRETS_DIR" "$TMP_DIR" "$HEALTH_LOG" >"$TMP_DIR/stdout.log" 2>"$TMP_DIR/stderr.log"; then
  printf '✗ health check unexpectedly passed when github-app-token could not resolve imports\n'
  exit 1
fi

if ! grep -q 'github-app-token helper failed to load: missing dependency github-app-private-key.js' "$HEALTH_LOG"; then
  printf '✗ health check log did not include helper load/dependency failure\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if ! grep -q 'github-app-token helper file exists and is executable' "$HEALTH_LOG"; then
  printf '✗ health check log did not separately confirm helper file presence\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if grep -q 'github operations health check PASSED' "$HEALTH_LOG"; then
  printf '✗ health check reported PASSED after the helper load failure\n'
  cat "$HEALTH_LOG"
  exit 1
fi

if grep -q 'SUPER-SECRET-PRIVATE-KEY-BODY' "$HEALTH_LOG"; then
  printf '✗ health check log leaked private key body content\n'
  cat "$HEALTH_LOG"
  exit 1
fi

printf '✓ health check fails when github-app-token cannot resolve runtime imports\n'
