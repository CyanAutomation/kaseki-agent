#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  local message="$1"
  local output="${2:-}"

  printf '%s\n' "$message" >&2
  if [ -n "$output" ]; then
    printf 'Output:\n%s\n' "$output" >&2
  fi
  exit 1
}

assert_exit_code() {
  local actual="$1"
  local expected="$2"
  local case_name="$3"
  local output="$4"

  if [ "$actual" -ne "$expected" ]; then
    fail "Expected $case_name to exit $expected, got $actual." "$output"
  fi
}

assert_required_diagnostics() {
  local output="$1"
  shift

  local diagnostic
  for diagnostic in "$@"; do
    if ! printf '%s\n' "$output" | grep -Fq "$diagnostic"; then
      fail "Expected diagnostic not found: $diagnostic" "$output"
    fi
  done
}

assert_forbidden_diagnostics() {
  local output="$1"
  shift

  local diagnostic
  for diagnostic in "$@"; do
    if printf '%s\n' "$output" | grep -Fq "$diagnostic"; then
      fail "Forbidden diagnostic was present: $diagnostic" "$output"
    fi
  done
}

assert_fake_pi_not_invoked() {
  local invocation_file="$1"
  local output="$2"

  if [ -e "$invocation_file" ]; then
    fail "Fake pi executable was invoked unexpectedly." "$output"
  fi
}

run_startup_checks_all() {
  set +e
  output="$({
    env "$@" bash "$ROOT_DIR/scripts/startup-checks.sh" all
  } 2>&1)"
  status=$?
  set -e
}

test_blocking_root_creation_failure_remains_exit_2_even_when_warning_checks_also_fail() {
  local case_tmp="$TMP_DIR/blocking-root"
  mkdir -p "$case_tmp"

  # Force check_kaseki_root to fail with blocking exit 2: mkdir -p cannot
  # create a child directory beneath a regular file. The default subdirectory
  # checks then return warning exit 3 beneath the same blocked root, and the
  # missing bootstrap script also returns warning exit 3.
  local blocking_parent="$case_tmp/not-a-directory"
  touch "$blocking_parent"
  local blocking_root="$blocking_parent/kaseki-root"

  local output status
  run_startup_checks_all \
    HOME="$case_tmp/home" \
    KASEKI_ROOT="$blocking_root" \
    KASEKI_SECRETS_DIR="$case_tmp/secrets" \
    OPENROUTER_API_KEY="test-key" \
    GITHUB_APP_ENABLED=0 \
    KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0

  assert_exit_code "$status" 2 \
    "blocking root creation failure with later warning checks" "$output"
  assert_required_diagnostics "$output" \
    "does not exist and could not be created" \
    "Could not create" \
    "Bootstrap incomplete: run-kaseki.sh not yet present"
}

test_missing_llm_gateway_url_stops_before_provider_capability_checks_and_does_not_call_pi() {
  local case_tmp="$TMP_DIR/missing-gateway-url"
  local pi_invocation_file="$case_tmp/pi-invoked"
  mkdir -p "$case_tmp/bin" "$case_tmp/root" "$case_tmp/template" "$case_tmp/results" "$case_tmp/runs"

  cat > "$case_tmp/bin/pi" <<EOF_PI
#!/usr/bin/env bash
printf '%s\n' "\$*" > "$pi_invocation_file"
echo "pi should not be called when LLM_GATEWAY_URL is missing" >&2
exit 99
EOF_PI
  chmod +x "$case_tmp/bin/pi"

  local output status
  run_startup_checks_all \
    PATH="$case_tmp/bin:$PATH" \
    HOME="$case_tmp/home" \
    KASEKI_ROOT="$case_tmp/root" \
    KASEKI_TEMPLATE_DIR="$case_tmp/template" \
    KASEKI_RESULTS_DIR="$case_tmp/results" \
    KASEKI_RUNS_DIR="$case_tmp/runs" \
    KASEKI_SECRETS_DIR="$case_tmp/secrets" \
    KASEKI_PROVIDER=gateway \
    OPENROUTER_API_KEY="test-openrouter-key" \
    GITHUB_APP_ENABLED=0 \
    KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0

  assert_exit_code "$status" 2 "missing LLM_GATEWAY_URL" "$output"
  assert_required_diagnostics "$output" \
    "LLM_GATEWAY_URL is required for KASEKI_PROVIDER=gateway"
  assert_forbidden_diagnostics "$output" \
    "Checking Pi provider registration for gateway" \
    "Skipping Pi provider registration check because gateway configuration is incomplete" \
    "Pi provider gateway is not registered" \
    "worker image/Pi extension did not register gateway" \
    "pi should not be called"
  assert_fake_pi_not_invoked "$pi_invocation_file" "$output"

  if [ -e "$case_tmp/results/provider-capability.json" ]; then
    fail "Provider capability artifact should not be written when LLM_GATEWAY_URL validation fails before capability checks." "$output"
  fi
}

test_worker_preflight_blocks_when_a_scouting_template_is_missing() {
  local case_tmp="$TMP_DIR/missing-scouting-template"
  local helper_root="$case_tmp/helpers" template_root="$case_tmp/templates/scouting"
  local agent_bin="$case_tmp/kaseki-agent"
  mkdir -p "$helper_root/lib" "$template_root" "$case_tmp/results" "$case_tmp/secrets"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$agent_bin"
  chmod +x "$agent_bin"

  local helper
  for helper in agent-prompt.sh allowlist-helper.sh restore-disallowed-changes.sh inspect-mode-defaults.sh dependency-cache-helpers.sh auto-lint-cleanup-classification.sh scouting-allowlist.js; do
    : > "$helper_root/$helper"
  done
  for helper in json.sh json-events.sh provider-retry.sh; do
    : > "$helper_root/lib/$helper"
  done
  # Deliberately omit compact.txt while keeping the other required templates.
  for template in base.txt detailed-test-impact.txt minimal-test-impact.txt common.txt; do
    : > "$template_root/$template"
  done

  local output status
  set +e
  output="$(env \
    HOME="$case_tmp/home" \
    KASEKI_AGENT_BIN="$agent_bin" \
    KASEKI_AGENT_HELPER_ROOT="$helper_root" \
    KASEKI_SCOUTING_TEMPLATE_ROOT="$template_root" \
    KASEKI_RESULTS_DIR="$case_tmp/results" \
    KASEKI_SECRETS_DIR="$case_tmp/secrets" \
    KASEKI_PROVIDER=unsupported \
    GITHUB_APP_ENABLED=0 \
    KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 \
    bash "$ROOT_DIR/scripts/startup-checks.sh" worker 2>&1)"
  status=$?
  set -e

  assert_exit_code "$status" 2 "worker preflight with missing scouting template" "$output"
  assert_required_diagnostics "$output" \
    "Packaged agent helper or scouting template files are missing or unreadable" \
    "$template_root/compact.txt"
}

test_blocking_root_creation_failure_remains_exit_2_even_when_warning_checks_also_fail
printf '✓ blocking root creation failure remains exit code 2 even when warning checks also fail\n'

test_missing_llm_gateway_url_stops_before_provider_capability_checks_and_does_not_call_pi
printf '✓ missing LLM_GATEWAY_URL stops before provider capability checks and does not call pi\n'

test_worker_preflight_blocks_when_a_scouting_template_is_missing
printf '✓ worker preflight blocks missing scouting templates\n'
