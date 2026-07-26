#!/usr/bin/env bash
# Sourceable GitHub preflight authentication helpers for kaseki-agent.sh.

parse_github_repo_url() {
  local repo_url repo_name
  repo_url="$1"
  # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
  GITHUB_REPO_OWNER=""
  # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
  GITHUB_REPO_NAME=""

  if [[ "$repo_url" =~ ^https?://github\.com/([^/]+)/([^/]+)(/|\.git)?$ ]]; then
    repo_name="${BASH_REMATCH[2]}"
    # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
    GITHUB_REPO_OWNER="${BASH_REMATCH[1]}"
    # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
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

  TOKEN_HELPER_STDOUT="$helper_stdout" \
    TOKEN_HELPER_STDERR="$helper_stderr" \
    TOKEN_HELPER_EXIT_CODE="$helper_exit_code" \
    TOKEN_HELPER_GITHUB_PAT="${KASEKI_GITHUB_PAT:-}" \
    TOKEN_HELPER_GITHUB_TOKEN="${KASEKI_GITHUB_TOKEN:-}" \
    node <<'NODE' 2>/dev/null || printf 'github-app-token helper exited with code %s	' "$helper_exit_code"
const stdout = process.env.TOKEN_HELPER_STDOUT || '';
const stderr = process.env.TOKEN_HELPER_STDERR || '';
const exitCode = process.env.TOKEN_HELPER_EXIT_CODE || 'unknown';
const configuredSecrets = [
  process.env.TOKEN_HELPER_GITHUB_PAT,
  process.env.TOKEN_HELPER_GITHUB_TOKEN,
].filter(Boolean);
const sanitize = (value) => {
  let sanitized = String(value || '');
  for (const secret of configuredSecrets) {
    sanitized = sanitized.split(secret).join('[redacted token]');
  }
  return sanitized
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:gh[opsru]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted jwt]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
};
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

constant_time_equals() {
  local expected="$1"
  local actual="$2"
  EXPECTED_VALUE="$expected" ACTUAL_VALUE="$actual" node <<'NODE'
const crypto = require('node:crypto');
const expected = Buffer.from(process.env.EXPECTED_VALUE || '', 'utf8');
const actual = Buffer.from(process.env.ACTUAL_VALUE || '', 'utf8');
if (expected.length !== actual.length) process.exit(1);
process.exit(crypto.timingSafeEqual(expected, actual) ? 0 : 1);
NODE
}

github_askpass_runtime_dir() {
  printf '%s\n' "${KASEKI_GITHUB_ASKPASS_DIR:-${KASEKI_RESULTS_DIR}}"
}

create_github_askpass_helper() {
  local log_file log_prefix askpass_dir askpass_file username_smoke_output password_smoke_output
  log_file="${1:-/dev/null}"
  log_prefix="${2:-[github-askpass]}"
  # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
  GITHUB_ASKPASS_FILE=""

  askpass_dir="$(github_askpass_runtime_dir)"
  if [ -z "$askpass_dir" ]; then
    printf '%s ERROR: GitHub credential helper directory is empty\n' "$log_prefix" | tee -a "$log_file" >&2
    return 8
  fi

  if ! mkdir -p "$askpass_dir"; then
    printf '%s ERROR: Failed to create GitHub credential helper directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    return 8
  fi

  askpass_file="$(mktemp "$askpass_dir/kaseki-github-askpass.XXXXXX")" || {
    printf '%s ERROR: Failed to create GitHub credential helper in executable runtime directory: %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
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
    return 8
  fi

  if ! chmod 0700 "$askpass_file"; then
    rm -f "$askpass_file"
    printf '%s ERROR: Failed to make GitHub credential helper executable: %s\n' "$log_prefix" "$askpass_file" | tee -a "$log_file" >&2
    return 8
  fi

  username_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Username for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    return 8
  }
  if ! constant_time_equals "x-access-token" "$username_smoke_output"; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned unexpected username response\n' "$log_prefix" | tee -a "$log_file" >&2
    return 8
  fi

  password_smoke_output="$(KASEKI_GITHUB_TOKEN='__kaseki_askpass_smoke_token__' "$askpass_file" 'Password for https://github.com' 2>/dev/null)" || {
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub askpass helper is not executable from %s\n' "$log_prefix" "$askpass_dir" | tee -a "$log_file" >&2
    return 8
  }
  if [ -z "$password_smoke_output" ]; then
    rm -f "$askpass_file"
    printf '%s ERROR: GitHub credential helper smoke check returned empty password response\n' "$log_prefix" | tee -a "$log_file" >&2
    return 8
  fi

  # shellcheck disable=SC2034 # Global output consumed by callers after sourcing this helper.
  GITHUB_ASKPASS_FILE="$askpass_file"
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
