#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/tests/helpers/fake-docker.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

template_dir="$TMP_DIR/source-checkout"
fake_bin="$TMP_DIR/bin"
mkdir -p "$template_dir/scripts" "$fake_bin"
cp "$ROOT_DIR/run-kaseki.sh" "$template_dir/run-kaseki.sh"
cp "$ROOT_DIR/kaseki-agent.sh" "$template_dir/kaseki-agent.sh"
cp "$ROOT_DIR/scripts/kaseki-preflight.sh" "$template_dir/scripts/kaseki-preflight.sh"
cp "$ROOT_DIR/scripts/dry-run-artifacts.sh" "$template_dir/scripts/dry-run-artifacts.sh"
chmod +x "$template_dir/run-kaseki.sh" "$template_dir/kaseki-agent.sh" "$template_dir/scripts/kaseki-preflight.sh" "$template_dir/scripts/dry-run-artifacts.sh"

install_fake_docker_doctor_parity "$fake_bin"

set +e
output="$(
  cd "$template_dir" && env \
    PATH="$fake_bin:/usr/bin:/bin" \
    TEST_TEMPLATE_DIR="$template_dir" \
    KASEKI_ROOT="$TMP_DIR/root" \
    KASEKI_LOG_DIR="$TMP_DIR/logs" \
    OPENROUTER_API_KEY="test-key" \
    ./run-kaseki.sh --doctor 2>&1
)"
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf 'Expected doctor to fail for missing deployed template files\nOutput:\n%s\n' "$output" >&2
  exit 1
fi

# Contract: running --doctor from a source checkout or incomplete deployed
# template must fail with a clear image/template parity diagnostic and one
# actionable deployment remediation command. Keep these assertions focused on
# stable identifiers/key messages instead of Docker invocation details or every
# prose line.
assert_output_contains() {
  local expected="$1"
  if ! printf '%s\n' "$output" | grep -Fq "$expected"; then
    printf 'FAIL: Expected doctor output to contain: "%s"\n' "$expected" >&2
    printf 'ACTUAL OUTPUT:\n---\n%s\n---\n' "$output" >&2
    exit 1
  fi
}

assert_output_contains 'Image/template parity: missing host file lib/pi-event-filter.js'
assert_output_contains 'source checkout or incomplete template'
assert_output_contains 'sudo KASEKI_IMAGE_PULL_POLICY=missing ./scripts/deploy-pi-template.sh'
