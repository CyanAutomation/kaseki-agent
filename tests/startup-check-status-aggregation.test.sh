#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Force check_kaseki_root to fail with blocking exit 2: mkdir -p cannot
# create a child directory beneath a regular file. The default subdirectory
# checks then return warning exit 3 beneath the same blocked root, and the
# missing bootstrap script also returns warning exit 3.
blocking_parent="$TMP_DIR/not-a-directory"
touch "$blocking_parent"
blocking_root="$blocking_parent/kaseki-root"

set +e
output="$({
  HOME="$TMP_DIR/home" \
  KASEKI_ROOT="$blocking_root" \
  KASEKI_SECRETS_DIR="$TMP_DIR/secrets" \
  OPENROUTER_API_KEY="test-key" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 \
    bash "$ROOT_DIR/scripts/startup-checks.sh" all
} 2>&1)"
status=$?
set -e

if [ "$status" -ne 2 ]; then
  printf 'Expected startup checks to exit 2 when a blocking error is followed by warnings, got %s.\nOutput:\n%s\n' "$status" "$output" >&2
  exit 1
fi

printf '%s\n' "$output" | grep -Fq 'does not exist and could not be created'
printf '%s\n' "$output" | grep -Fq 'Could not create'
printf '%s\n' "$output" | grep -Fq 'Bootstrap incomplete: run-kaseki.sh not yet present'
printf '%s\n' "$output" | grep -Fq 'Error detected; startup blocked'

printf '✓ Startup-check blocking status aggregation assertions passed.\n'

missing_gateway_url_tmp="$(mktemp -d)"
cleanup_missing_gateway_url() {
  rm -rf "$missing_gateway_url_tmp"
}
trap 'rm -rf "$TMP_DIR"; cleanup_missing_gateway_url' EXIT
mkdir -p "$missing_gateway_url_tmp/bin" "$missing_gateway_url_tmp/root" "$missing_gateway_url_tmp/template" "$missing_gateway_url_tmp/results" "$missing_gateway_url_tmp/runs"
cat > "$missing_gateway_url_tmp/bin/pi" <<'EOF_PI'
#!/usr/bin/env bash
echo "pi should not be called when LLM_GATEWAY_URL is missing" >&2
exit 99
EOF_PI
chmod +x "$missing_gateway_url_tmp/bin/pi"

set +e
missing_gateway_url_output="$({
  PATH="$missing_gateway_url_tmp/bin:$PATH" \
  HOME="$missing_gateway_url_tmp/home" \
  KASEKI_ROOT="$missing_gateway_url_tmp/root" \
  KASEKI_TEMPLATE_DIR="$missing_gateway_url_tmp/template" \
  KASEKI_RESULTS_DIR="$missing_gateway_url_tmp/results" \
  KASEKI_RUNS_DIR="$missing_gateway_url_tmp/runs" \
  KASEKI_SECRETS_DIR="$missing_gateway_url_tmp/secrets" \
  KASEKI_PROVIDER=gateway \
  OPENROUTER_API_KEY="test-openrouter-key" \
  GITHUB_APP_ENABLED=0 \
  KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 \
    bash "$ROOT_DIR/scripts/startup-checks.sh" all
} 2>&1)"
missing_gateway_url_status=$?
set -e

if [ "$missing_gateway_url_status" -ne 2 ]; then
  printf 'Expected missing LLM_GATEWAY_URL to exit 2, got %s.\nOutput:\n%s\n' "$missing_gateway_url_status" "$missing_gateway_url_output" >&2
  exit 1
fi

printf '%s\n' "$missing_gateway_url_output" | grep -Fq 'LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway'
if printf '%s\n' "$missing_gateway_url_output" | grep -Fq 'Pi provider gateway is not registered'; then
  printf 'Missing LLM_GATEWAY_URL should not report provider registration failure.\nOutput:\n%s\n' "$missing_gateway_url_output" >&2
  exit 1
fi
if printf '%s\n' "$missing_gateway_url_output" | grep -Fq 'worker image/Pi extension did not register gateway'; then
  printf 'Missing LLM_GATEWAY_URL should not print extension rebuild remediation.\nOutput:\n%s\n' "$missing_gateway_url_output" >&2
  exit 1
fi
if printf '%s\n' "$missing_gateway_url_output" | grep -Fq 'pi should not be called'; then
  printf 'Pi was called even though gateway URL validation failed.\nOutput:\n%s\n' "$missing_gateway_url_output" >&2
  exit 1
fi

printf '✓ Missing gateway URL skips provider capability assertions passed.\n'
