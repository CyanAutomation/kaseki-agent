#!/usr/bin/env bash
# Sourceable GitHub preflight authentication helpers for kaseki-agent.sh.

parse_github_repo_url() {
  local repo_url repo_name
  repo_url="$1"
  GITHUB_REPO_OWNER=""
  GITHUB_REPO_NAME=""

  if [[ "$repo_url" =~ ^https?://github\.com/([^/]+)/([^/]+)(/|\.git)?$ ]]; then
    repo_name="${BASH_REMATCH[2]}"
    GITHUB_REPO_OWNER="${BASH_REMATCH[1]}"
    GITHUB_REPO_NAME="${repo_name%.git}"
    return 0
  fi

  return 1
}

parse_github_app_token_helper_failure() {
  local helper_stdout helper_stderr helper_exit_code
  helper_stdout="$1"
  helper_stderr="$2"
  helper_exit_code="$3"

  TOKEN_HELPER_STDOUT="$helper_stdout" TOKEN_HELPER_STDERR="$helper_stderr" TOKEN_HELPER_EXIT_CODE="$helper_exit_code" node <<'NODE' 2>/dev/null || printf 'github-app-token helper exited with code %s	' "$helper_exit_code"
const stdout = process.env.TOKEN_HELPER_STDOUT || '';
const stderr = process.env.TOKEN_HELPER_STDERR || '';
const exitCode = process.env.TOKEN_HELPER_EXIT_CODE || 'unknown';
const sanitize = (value) => String(value || '')
  .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[redacted private key]')
  .replace(/\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted token]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted jwt]')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/ {2,}/g, ' ')
  .trim();
let error = '';
let status = '';
try {
  const structuredSource = stdout.trim().startsWith('{') ? stdout : stderr.trim().startsWith('{') ? stderr : '{}';
  const parsed = JSON.parse(structuredSource);
  error = parsed.error || parsed.message || '';
  const candidateStatus = parsed.status || parsed.statusCode || parsed.http_status || parsed.httpStatus || '';
  if (/^[1-5][0-9]{2}$/.test(String(candidateStatus))) status = String(candidateStatus);
} catch (_) {}
error = sanitize(error);
if (!error) error = sanitize(stderr);
if (!error) error = `github-app-token helper exited with code ${exitCode}`;
if (!status) {
  const match = error.match(/(?:HTTP(?: status)?|status(?: code)?)[^0-9]{0,12}([1-5][0-9]{2})/i);
  if (match) status = match[1];
}
process.stdout.write(`${error}\t${status}`);
NODE
}


github_private_key_metadata_json() {
  local key_file="$1"
  local byte_count first_pem_header_line pem_footer_present sha256_fingerprint
  byte_count="$(wc -c < "$key_file" | awk '{print $1}')"
  first_pem_header_line="$(grep -aoE -- '-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----' "$key_file" | sed -n '1p')"
  if grep -aoEq -- '-----END [A-Z0-9 ]*PRIVATE KEY-----' "$key_file"; then
    pem_footer_present="true"
  else
    pem_footer_present="false"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256_fingerprint="$(sha256sum "$key_file" | awk '{print $1}')"
  else
    sha256_fingerprint="$(shasum -a 256 "$key_file" | awk '{print $1}')"
  fi
  cat <<META
{
  "byte_count": $byte_count,
  "first_pem_header_line": $(printf '%s' "$first_pem_header_line" | json_encode),
  "pem_footer_present": $pem_footer_present,
  "sha256_fingerprint": $(printf '%s' "$sha256_fingerprint" | json_encode)
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


github_askpass_runtime_dir() {
  printf '%s\n' "${KASEKI_GITHUB_ASKPASS_DIR:-${KASEKI_RESULTS_DIR}}"
}

create_github_askpass_helper() {
  local log_file log_prefix askpass_dir askpass_file username_smoke_output password_smoke_output
  log_file="${1:-/dev/null}"
  log_prefix="${2:-[github-askpass]}"
  GITHUB_ASKPASS_FILE=""

  askpass_dir="$(github_askpass_runtime_dir)"
  if [ -z "$askpass_dir" ]; then
    printf '%s ERROR: GitHub credential helper directory is empty\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  if ! mkdir -p "$askpass_dir"; then
    printf '%s ERROR: Failed to create GitHub credential helper directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  askpass_file="$(mktemp "$askpass_dir/kaseki-github-askpass.XXXXXX")" || {
    printf '%s ERROR: Failed to create GitHub credential helper in executable runtime directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }

  if ! cat > "$askpass_file" <<'EOF_ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *) printf '%s\n' "$KASEKI_GITHUB_TOKEN" ;;
esac
EOF_ASKPASS
  then
    rm -f "$askpass_file"
    printf '%s ERROR: Failed to write GitHub credential helper: %s\n' "$log_prefix" "$askpass_file" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  if ! chmod 0700 "$askpass_file"; then
    rm -f "$askpass_file"
    printf '%s ERROR: Failed to make GitHub credential helper executable: %s\n' "$log_prefix" "$askpass_file" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  username_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Username for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }
  if [ "$username_smoke_output" != "x-access-token" ]; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned unexpected username response\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  password_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Password for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  }
  if [ -z "$password_smoke_output" ]; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned empty password response\n' "$log_prefix" | tee -a "$log_file" >&2
    GITHUB_PUSH_EXIT=8
    return 8
  fi

  GITHUB_ASKPASS_FILE="$askpass_file"
  return 0
}


check_github_operations_health() {
  # Preflight health check for github operations before pi agent runs
  # Tests: GitHub App secrets, git config, Node.js token generation capability
  local health_log="${KASEKI_HEALTH_LOG:-${KASEKI_RESULTS_DIR}/github-health-check.log}"
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
  local github_app_token_helper="${KASEKI_GITHUB_APP_TOKEN_HELPER:-/usr/local/bin/github-app-token}"
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
  # installation token for REPO_URL. Set KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=0
  # to skip this networked auth check; the later GitHub operations stage will
  # still attempt token generation and report any failure.
  if [ "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-1}" = "1" ]; then
    local owner repo app_id token_stdout_tmp token_stderr_tmp token_exit_code token_data token_stderr token_parse_result token_error
    if parse_github_repo_url "$REPO_URL"; then
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
      printf '[health-check] SKIP: Cannot parse GitHub repo URL for auth smoke test: %s\n' "$REPO_URL" | tee -a "$health_log"
    fi
  else
    printf '[health-check] SKIP: GitHub App auth smoke test disabled (KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK=%s)\n' "${KASEKI_GITHUB_PREFLIGHT_AUTH_CHECK:-}" | tee -a "$health_log"
  fi
  
  printf '[preflight] github operations health check PASSED\n' | tee -a "$health_log"
  return 0
}

# must match host preflight/API secret resolution contract.
# Resolves GitHub App secret paths with debug logging (when KASEKI_DEBUG_SECRETS=1)
resolve_github_secret_file() {
  local env_name="$1"
  local default_name="$2"
  local explicit_value="" canonical_path local_dev_path debug_mode
  
  debug_mode="${KASEKI_DEBUG_SECRETS:-0}"
  
  # Check if explicit path is set via environment variable
  explicit_value="${!env_name:-}"
  if [ -n "$explicit_value" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: Using explicit env var path: %s\n' "$env_name" "$explicit_value" >&2
    fi
    printf '%s' "$explicit_value"
    return 0
  fi
  
  # Try canonical path (root level for GitHub secrets due to Phase 2 fix)
  canonical_path="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/$default_name"
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: No explicit env var, checking canonical path: %s\n' "$env_name" "$canonical_path" >&2
  fi
  
  if [ -r "$canonical_path" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✓ Found at canonical path: %s\n' "$env_name" "$canonical_path" >&2
    fi
    printf '%s' "$canonical_path"
    return 0
  fi
  
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: ✗ Canonical path not found or not readable: %s\n' "$env_name" "$canonical_path" >&2
  fi
  
  # Try legacy path (backward compatibility with run-kaseki.sh mounts)
  local_legacy_path="/run/secrets/$default_name"
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: Checking legacy root path: %s\n' "$env_name" "$local_legacy_path" >&2
  fi
  if [ -r "$local_legacy_path" ]; then
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✓ Found at legacy path: %s\n' "$env_name" "$local_legacy_path" >&2
    fi
    printf '%s' "$local_legacy_path"
    return 0
  fi
  
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: ✗ Legacy path not found or not readable: %s\n' "$env_name" "$local_legacy_path" >&2
  fi
  
  # Try local dev fallback if allowed
  if [ "$KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK" = "1" ]; then
    local_dev_path="$HOME/.kaseki/secrets/$default_name"
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: Checking local dev fallback: %s\n' "$env_name" "$local_dev_path" >&2
    fi
    if [ -r "$local_dev_path" ]; then
      if [ "$debug_mode" = "1" ]; then
        printf '[debug-secrets] %s: ✓ Found at local dev fallback: %s\n' "$env_name" "$local_dev_path" >&2
      fi
      printf '%s' "$local_dev_path"
      return 0
    fi
    if [ "$debug_mode" = "1" ]; then
      printf '[debug-secrets] %s: ✗ Local dev fallback not found or not readable: %s\n' "$env_name" "$local_dev_path" >&2
    fi
  fi
  
  # Return canonical path even if not found (for error reporting in health check)
  if [ "$debug_mode" = "1" ]; then
    printf '[debug-secrets] %s: Returning canonical path (file may not exist): %s\n' "$env_name" "$canonical_path" >&2
  fi
  printf '%s' "$canonical_path"
}

