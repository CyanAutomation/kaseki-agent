#!/usr/bin/env bash
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
    -e "s#/agents/secrets/github_app_id#$SECRETS_DIR/github_app_id#g" \
    -e "s#/agents/secrets/github_app_client_id#$SECRETS_DIR/github_app_client_id#g" \
    -e "s#/agents/secrets/github_app_private_key#$SECRETS_DIR/github_app_private_key#g" \
    -e "s#/run/secrets/github_app_id#$SECRETS_DIR/github_app_id#g" \
    -e "s#/run/secrets/github_app_client_id#$SECRETS_DIR/github_app_client_id#g" \
    -e "s#/run/secrets/github_app_private_key#$SECRETS_DIR/github_app_private_key#g" \
    -e "s#/results/github-app-private-key-metadata.json#$TMP_DIR/github-app-private-key-metadata.json#g" \
    -e "s#/usr/local/bin/github-app-token#$HELPER_PATH#g" \
    >> "$FUNCTIONS_FILE"
# shellcheck disable=SC1090
. "$FUNCTIONS_FILE"

# shellcheck disable=SC2034 # These variables are used by sourced functions
REPO_URL="https://github.com/acme/widgets"
KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
KASEKI_SECRETS_DIR="$SECRETS_DIR"
export KASEKI_SECRETS_DIR

if check_github_operations_health >"$TMP_DIR/stdout.log" 2>"$TMP_DIR/stderr.log"; then
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
