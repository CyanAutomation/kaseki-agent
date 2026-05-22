#!/usr/bin/env bash
# shellcheck disable=SC2016
# tests/github-private-key-metadata.test.sh
# Verifies host-side GitHub App private key metadata is redacted and non-secret.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_BIN="$TMP_DIR/bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/git" <<'EOF_GIT'
#!/usr/bin/env bash
if [ "${1:-}" = "ls-remote" ]; then
  exit 0
fi
exec /usr/bin/git "$@"
EOF_GIT
chmod +x "$FAKE_BIN/git"

cat > "$FAKE_BIN/docker" <<'EOF_DOCKER'
#!/usr/bin/env bash
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  exit 0
fi
if [ "${1:-}" = "run" ]; then
  exit 0
fi
exit 0
EOF_DOCKER
chmod +x "$FAKE_BIN/docker"

PRIVATE_KEY_FILE="$TMP_DIR/private-key.pem"
printf '%s' '-----BEGIN RSA PRIVATE KEY----- HOST-SECRET-BODY-ghp_abcdefghijklmnopqrstuvwxyz1234567890 -----END RSA PRIVATE KEY-----' > "$PRIVATE_KEY_FILE"

KASEKI_ROOT="$TMP_DIR/kaseki"
OUTPUT_LOG="$TMP_DIR/run-output.log"

PATH="$FAKE_BIN:$PATH" \
KASEKI_ROOT="$KASEKI_ROOT" \
OPENROUTER_API_KEY="test-openrouter-key" \
REPO_URL="https://github.com/acme/widgets" \
GIT_REF="main" \
GITHUB_APP_ID="123456" \
GITHUB_APP_CLIENT_ID="Iv1.testclient" \
GITHUB_APP_PRIVATE_KEY_FILE="$PRIVATE_KEY_FILE" \
KASEKI_PUBLISH_MODE="branch" \
"$PROJECT_ROOT/run-kaseki.sh" >"$OUTPUT_LOG" 2>&1

RESULT_DIR="$KASEKI_ROOT/kaseki-results/kaseki-1"
METADATA_FILE="$RESULT_DIR/github-app-private-key-metadata.json"

if [ ! -f "$METADATA_FILE" ]; then
  printf '✗ expected private key metadata file missing: %s\n' "$METADATA_FILE"
  cat "$OUTPUT_LOG"
  exit 1
fi

if ! grep -q 'GitHub App private key metadata:' "$RESULT_DIR/progress.log"; then
  printf '✗ expected progress log to contain private key metadata\n'
  cat "$RESULT_DIR/progress.log"
  exit 1
fi

node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const input = fs.readFileSync(process.argv[2], "utf8");
const expectedMetadataInput = input.endsWith("\n") ? input : `${input}\n`;
const expectedHash = crypto.createHash("sha256").update(Buffer.from(expectedMetadataInput)).digest("hex");
if (metadata.byte_count !== Buffer.byteLength(expectedMetadataInput)) throw new Error(`byte_count mismatch: ${metadata.byte_count}`);
if (metadata.first_pem_header_line !== "-----BEGIN RSA PRIVATE KEY-----") throw new Error(`header mismatch: ${metadata.first_pem_header_line}`);
if (metadata.pem_footer_present !== true) throw new Error("footer flag mismatch");
if (metadata.sha256_fingerprint !== expectedHash) throw new Error("fingerprint mismatch");
' "$METADATA_FILE" "$PRIVATE_KEY_FILE"

if grep -q 'HOST-SECRET-BODY' "$METADATA_FILE" "$RESULT_DIR/progress.log" "$OUTPUT_LOG"; then
  printf '✗ private key body leaked into host diagnostics\n'
  cat "$METADATA_FILE"
  cat "$RESULT_DIR/progress.log"
  cat "$OUTPUT_LOG"
  exit 1
fi

if grep -q 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' "$METADATA_FILE" "$RESULT_DIR/progress.log" "$OUTPUT_LOG"; then
  printf '✗ token-like private key body content leaked into host diagnostics\n'
  cat "$METADATA_FILE"
  cat "$RESULT_DIR/progress.log"
  cat "$OUTPUT_LOG"
  exit 1
fi

printf '✓ host private key metadata is present and redacted\n'
