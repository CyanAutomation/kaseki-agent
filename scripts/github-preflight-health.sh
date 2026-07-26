#!/usr/bin/env bash
# Sourceable GitHub operations preflight health check.
#
# check_github_operations_health accepts, in order:
#   1. github-app-token helper path
#   2. secrets directory
#   3. results directory
#   4. health-log path
# Callers may omit arguments and instead set KASEKI_GITHUB_APP_TOKEN_HELPER,
# KASEKI_SECRETS_DIR, KASEKI_RESULTS_DIR, and KASEKI_HEALTH_LOG respectively.
# REPO_URL and KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK configure the optional live
# authentication probe.

_GITHUB_PREFLIGHT_HEALTH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KASEKI_GITHUB_PREFLIGHT_AUTH_HELPER="${KASEKI_GITHUB_PREFLIGHT_AUTH_HELPER:-${_GITHUB_PREFLIGHT_HEALTH_DIR}/github-preflight-auth.sh}"
# shellcheck source=github-preflight-auth.sh
. "$KASEKI_GITHUB_PREFLIGHT_AUTH_HELPER"
unset _GITHUB_PREFLIGHT_HEALTH_DIR

github_private_key_metadata_json() {
  local key_file="$1"
  local byte_count first_pem_header_line pem_header_present pem_footer_present sha256_fingerprint sha256_output
  byte_count="$(wc -c < "$key_file" | awk '{print $1}')"
  first_pem_header_line="$(grep -aoEm1 -- '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' "$key_file" || true)"
  if [ -n "$first_pem_header_line" ]; then
    pem_header_present="true"
  else
    pem_header_present="false"
  fi
  if grep -aoEq -- '-----END [A-Z0-9 ]*PRIVATE KEY-----' "$key_file"; then
    pem_footer_present="true"
  else
    pem_footer_present="false"
  fi
  if sha256_output="$(sha256sum "$key_file" 2>/dev/null)"; then
    sha256_fingerprint="${sha256_output%%[[:space:]]*}"
    [ -n "$sha256_fingerprint" ] || sha256_fingerprint="unavailable"
  else
    sha256_fingerprint="unavailable"
  fi
  cat <<META
{
  "byte_count": $byte_count,
  "first_pem_header_line": "$first_pem_header_line",
  "pem_header_present": $pem_header_present,
  "pem_footer_present": $pem_footer_present,
  "sha256_fingerprint": "$sha256_fingerprint"
}
META
}

log_github_private_key_metadata() {
  local key_file="$1"
  local health_log="$2"
  local metadata_file="${KASEKI_RESULTS_DIR}/github-app-private-key-metadata.json"
  github_private_key_metadata_json "$key_file" > "$metadata_file"
  printf '[health-check] GitHub App private key metadata: %s\n' "$(tr -d '\n' < "$metadata_file")" | tee -a "$health_log"
}


check_github_operations_health() {
  # Preflight health check for github operations before pi agent runs
  # Tests: GitHub App secrets, git config, Node.js token generation capability
  local github_app_token_helper="${1:-${KASEKI_GITHUB_APP_TOKEN_HELPER:-/usr/local/bin/github-app-token}}"
  local secrets_dir="${2:-${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}}"
  local results_dir="${3:-${KASEKI_RESULTS_DIR:-/results}}"
  local health_log="${4:-${KASEKI_HEALTH_LOG:-${results_dir}/github-health-check.log}}"
  # Make path inputs available to shared secret and askpass helpers for this call.
  local KASEKI_SECRETS_DIR="$secrets_dir"
  local KASEKI_RESULTS_DIR="$results_dir"
  # shellcheck disable=SC2153
  local repo_url="${REPO_URL:-}"
  github_preflight_fail() {
    local classification="$1"
    local remediation="$2"
    shift 2
    local message="$1"
    shift || true
    local message_arg
    for message_arg in "$@"; do
      message="${message/\%s/$message_arg}"
    done
    printf '[health-check] ERROR: %s\n' "$message" | tee -a "$health_log" >&2
    printf '[health-check] CLASSIFICATION: %s\n' "$classification" | tee -a "$health_log" >&2
    printf '[health-check] REMEDIATION: %s\n' "$remediation" | tee -a "$health_log" >&2
    return 1
  }
  : > "$health_log"
  
  printf '[preflight] github operations health check started\n' | tee -a "$health_log"
  
  # must match host preflight/API secret resolution contract.
  local github_app_id_file github_app_client_id_file github_app_private_key_file
  github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"
  github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"
  github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"
  
  if ! [ -r "$github_app_id_file" ]; then
    github_preflight_fail "missing_github_app_id" "Provide a readable GitHub App ID secret via GITHUB_APP_ID_FILE or KASEKI_SECRETS_DIR/github_app_id." "Cannot read GitHub App ID from %s" "$github_app_id_file"
    return $?
  fi
  if ! [ -r "$github_app_client_id_file" ]; then
    github_preflight_fail "missing_github_app_client_id" "Provide a readable GitHub App client ID secret via GITHUB_APP_CLIENT_ID_FILE or KASEKI_SECRETS_DIR/github_app_client_id." "Cannot read GitHub App client ID from %s" "$github_app_client_id_file"
    return $?
  fi
  if ! [ -r "$github_app_private_key_file" ]; then
    github_preflight_fail "missing_github_app_private_key" "Provide a readable GitHub App private key secret via GITHUB_APP_PRIVATE_KEY_FILE or KASEKI_SECRETS_DIR/github_app_private_key." "Cannot read GitHub App private key from %s" "$github_app_private_key_file"
    return $?
  fi
  log_github_private_key_metadata "$github_app_private_key_file" "$health_log"
  printf '[health-check] ✓ GitHub App secrets are readable\n' | tee -a "$health_log"
  
  # Check 2: Verify git is available
  if ! git --version >/dev/null 2>&1; then
    github_preflight_fail "missing_git" "Install git in the runtime image or ensure git is available on PATH before starting Kaseki." "git command is not available"
    return $?
  fi
  printf '[health-check] ✓ git is available\n' | tee -a "$health_log"
  
  # Check 3: Test Node.js github-app-token helper file exists and is executable
  if ! [ -x "$github_app_token_helper" ]; then
    github_preflight_fail "missing_github_app_token_helper" "Install or build the github-app-token helper and set KASEKI_GITHUB_APP_TOKEN_HELPER if it lives outside /usr/local/bin." "github-app-token helper not found at %s" "$github_app_token_helper"
    return $?
  fi
  printf '[health-check] ✓ github-app-token helper file exists and is executable\n' | tee -a "$health_log"
  
  # Check 4: Test Node.js is available
  if ! command -v node >/dev/null 2>&1; then
    github_preflight_fail "missing_node" "Install Node.js in the runtime image or ensure node is available on PATH before starting Kaseki." "Node.js is not available"
    return $?
  fi
  printf '[health-check] ✓ Node.js is available\n' | tee -a "$health_log"
  
  # Check 5: Test Node.js JSON parsing
  local test_output
  test_output=$(printf '{"test":"value"}' | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.test);" 2>&1) || {
    github_preflight_fail "node_json_parse_failed" "Verify the Node.js runtime is healthy and can execute inline scripts." "Node.js JSON parsing failed: %s" "$test_output"
    return $?
  }
  if [ "$test_output" != "value" ]; then
    github_preflight_fail "node_json_parse_unexpected_output" "Verify the Node.js runtime is healthy and not shadowed by a wrapper on PATH." "Node.js JSON parsing returned unexpected output: %s" "$test_output"
    return $?
  fi
  printf '[health-check] ✓ Node.js JSON parsing works\n' | tee -a "$health_log"
  
  # Check 6: Test github-app-token helper can start and resolve runtime imports
  local helper_probe_stdout_tmp helper_probe_stderr_tmp helper_probe_exit_code helper_probe_stdout helper_probe_stderr helper_probe_parse_result helper_probe_error
  helper_probe_stdout_tmp="$(mktemp /tmp/github-health-helper-probe-stdout.XXXXXX)" || {
    github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create helper load probe stdout temp file"
    return $?
  }
  helper_probe_stderr_tmp="$(mktemp /tmp/github-health-helper-probe-stderr.XXXXXX)" || {
    github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create helper load probe stderr temp file"
    local preflight_status=$?
    rm -f "$helper_probe_stdout_tmp"
    return $preflight_status
  }

  "$github_app_token_helper" >"$helper_probe_stdout_tmp" 2>"$helper_probe_stderr_tmp"
  helper_probe_exit_code=$?
  helper_probe_stdout="$(cat "$helper_probe_stdout_tmp" 2>/dev/null || true)"
  helper_probe_stderr="$(cat "$helper_probe_stderr_tmp" 2>/dev/null || true)"
  rm -f "$helper_probe_stdout_tmp" "$helper_probe_stderr_tmp"

  if [ "$helper_probe_exit_code" -eq 0 ] || ! printf '%s\n%s' "$helper_probe_stdout" "$helper_probe_stderr" | grep -qi 'usage:.*github-app-token'; then
    helper_probe_parse_result="$(parse_github_app_token_helper_failure "$helper_probe_stdout" "$helper_probe_stderr" "$helper_probe_exit_code")"
    helper_probe_error="${helper_probe_parse_result%%$'\t'*}"
    if printf '%s\n%s' "$helper_probe_stdout" "$helper_probe_stderr" | grep -Eq 'github-app-private-key(\.js)?'; then
      helper_probe_error='missing dependency github-app-private-key.js'
    fi
    github_preflight_fail "github_app_token_helper_load_failed" "Rebuild the runtime image or install the missing github-app-token helper dependencies." "github-app-token helper failed to load: %s" "$helper_probe_error"
    return $?
  fi
  printf '[health-check] ✓ github-app-token helper can start and resolve imports\n' | tee -a "$health_log"

  # Check 7: Test curl is available
  if ! command -v curl >/dev/null 2>&1; then
    github_preflight_fail "missing_curl" "Install curl in the runtime image or ensure curl is available on PATH before starting Kaseki." "curl is not available"
    return $?
  fi
  printf '[health-check] ✓ curl is available\n' | tee -a "$health_log"

  # Check 8: Optional live GitHub App auth smoke test. Enabled by default
  # (KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=1) so startup does not report a full
  # GitHub preflight pass when credentials are readable but cannot mint an
  # installation token for repo_url. Set KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
  # to skip this networked auth check; the later GitHub operations stage will
  # still attempt token generation and report any failure.
  if [ "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-1}" = "1" ]; then
    local owner repo app_id token_stdout_tmp token_stderr_tmp token_exit_code token_data token_stderr token_parse_result token_error
    if parse_github_repo_url "$repo_url"; then
      owner="$GITHUB_REPO_OWNER"
      repo="$GITHUB_REPO_NAME"
      app_id="$(cat "$github_app_id_file" 2>/dev/null)" || app_id=""
      if [ -z "$app_id" ]; then
        github_preflight_fail "missing_github_app_id" "Ensure the GitHub App ID secret is readable and non-empty before enabling the auth smoke test." "Cannot read GitHub App ID for auth smoke test"
        return $?
      fi

      token_stdout_tmp="$(mktemp /tmp/github-health-token-stdout.XXXXXX)" || {
        github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create token stdout temp file"
        return $?
      }
      token_stderr_tmp="$(mktemp /tmp/github-health-token-stderr.XXXXXX)" || {
        github_preflight_fail "tempfile_creation_failed" "Ensure /tmp is writable inside the runtime container." "Failed to create token stderr temp file"
        local preflight_status=$?
        rm -f "$token_stdout_tmp"
        return $preflight_status
      }

      "$github_app_token_helper" "$app_id" "$github_app_private_key_file" "$owner" "$repo" >"$token_stdout_tmp" 2>"$token_stderr_tmp"
      token_exit_code=$?
      token_data="$(cat "$token_stdout_tmp" 2>/dev/null || true)"
      token_stderr="$(cat "$token_stderr_tmp" 2>/dev/null || true)"
      rm -f "$token_stdout_tmp" "$token_stderr_tmp"

      if [ "$token_exit_code" -ne 0 ]; then
        token_parse_result="$(parse_github_app_token_helper_failure "$token_data" "$token_stderr" "$token_exit_code")"
        token_error="${token_parse_result%%$'\t'*}"
        github_preflight_fail "github_app_token_generation_failed" "Verify the GitHub App is installed on REPO_URL and the app ID/private key pair are valid." "GitHub App token generation failed for owner/repo: %s" "$token_error"
        return $?
      fi

      local github_token
      github_token="$(TOKEN_HELPER_STDOUT="$token_data" node <<'NODE' 2>/dev/null
const data = process.env.TOKEN_HELPER_STDOUT || '';
try {
  const parsed = JSON.parse(data);
  process.stdout.write(parsed.token || '');
} catch (_) {}
NODE
)"
      if [ -z "$github_token" ]; then
        github_preflight_fail "github_app_token_generation_failed" "Verify the github-app-token helper returns JSON containing a non-empty token field." "GitHub authentication failed: Unable to obtain installation token"
        return $?
      fi

      printf '[health-check] ✓ GitHub App token generation works for owner/repo\n' | tee -a "$health_log"

      # After token generation succeeds, exercise the same askpass helper path used by git push.
      local askpass_file
      if ! create_github_askpass_helper "$health_log" '[health-check]'; then
        return 1
      fi
      askpass_file="$GITHUB_ASKPASS_FILE"
      rm -f "$askpass_file"
      printf '[health-check] ✓ GitHub askpass helper returned expected username and non-empty password responses from: %s\n' "$(github_askpass_runtime_dir)" | tee -a "$health_log"
    else
      printf '[health-check] SKIP: Cannot parse GitHub repo URL for auth smoke test: %s\n' "$repo_url" | tee -a "$health_log"
    fi
  else
    printf '[health-check] SKIP: GitHub App auth smoke test disabled (KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=%s)\n' "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-}" | tee -a "$health_log"
  fi
  
  printf '[preflight] github operations health check PASSED\n' | tee -a "$health_log"
  return 0
}
