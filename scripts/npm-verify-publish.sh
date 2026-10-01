#!/usr/bin/env bash
# Verify that an exact package version is publicly visible on npm.
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REGISTRY="https://registry.npmjs.org/"
METADATA_FILE="${KASEKI_NPM_VERIFY_METADATA_FILE:-/tmp/npm-publish-diagnostics/npm-view.json}"
DIAGNOSTIC_DIR="$(dirname "$METADATA_FILE")"
LAST_RESPONSE_FILE="$DIAGNOSTIC_DIR/npm-verify-last-response.json"
DELAYS=(1 2 4 8 16 32)

usage() {
  printf 'Usage: %s <PACKAGE_NAME> <VERSION> [MAX_ATTEMPTS]\n' "$SCRIPT_NAME" >&2
}

if [[ $# -lt 2 ]]; then
  usage
  exit 2
fi
PACKAGE_NAME="$1"
VERSION="$2"
MAX_ATTEMPTS="${3:-6}"

if [[ ! "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Error: MAX_ATTEMPTS must be a positive integer\n' >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  printf 'Error: jq is required but not found on PATH\n' >&2
  exit 3
fi
if (( MAX_ATTEMPTS > ${#DELAYS[@]} )); then
  MAX_ATTEMPTS=${#DELAYS[@]}
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$DIAGNOSTIC_DIR"
printf 'registry=%s\nalways-auth=false\n' "$REGISTRY" >"$WORK_DIR/clean.npmrc"
: >"$WORK_DIR/clean-global.npmrc"
START_SECONDS=$SECONDS
LAST_CLASSIFICATION="not-attempted"
LAST_EXIT=0

# Store a useful artifact without allowing credentials from npm diagnostics into it.
write_response() {
  local attempt="$1" classification="$2" exit_status="$3" stdout_file="$4" stderr_file="$5"
  local token="${NODE_AUTH_TOKEN:-}"
  jq -n --arg registry "$REGISTRY" --arg package "$PACKAGE_NAME" --arg version "$VERSION" \
    --argjson attempt "$attempt" --argjson maxAttempts "$MAX_ATTEMPTS" \
    --argjson elapsedSeconds "$((SECONDS - START_SECONDS))" --argjson exitStatus "$exit_status" \
    --arg classification "$classification" --rawfile stdout "$stdout_file" --rawfile stderr "$stderr_file" \
    --arg secret "$token" '
      def redact:
        gsub("npm_[A-Za-z0-9]{8,}"; "[REDACTED]")
        | gsub("((?i)_authToken)[[:space:]]*=[[:space:]]*[^[:space:]]+"; "_authToken=[REDACTED]")
        | gsub("https?://[^/@[:space:]]+@"; "https://[REDACTED]@")
        | if ($secret | length) > 0 then split($secret) | join("[REDACTED]") else . end;
      {registry: $registry, package: $package, requestedVersion: $version,
       attempt: $attempt, maxAttempts: $maxAttempts, elapsedSeconds: $elapsedSeconds,
       exitStatus: $exitStatus, classification: $classification,
       stdout: ($stdout | redact), stderr: ($stderr | redact)}' >"$LAST_RESPONSE_FILE"
}

classify_failure() {
  local output="$1"
  if grep -Eqi 'E401|ENEEDAUTH|EAUTH|authentication (required|failed)|incorrect or missing password' "$output"; then
    printf authentication
  elif grep -Eqi 'E403|forbidden|not authorized|permission denied' "$output"; then
    printf authorization
  elif grep -Eqi 'ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|FETCH_ERROR|[[:space:]]5[0-9][0-9][[:space:]]' "$output"; then
    printf network
  elif grep -Eqi 'E404|404 Not Found|version[^[:alnum:]]+(not found|does not exist)|No match found for version' "$output"; then
    printf version-not-found
  elif grep -Eqi 'ECONFIG|invalid config|configuration error|ERR_INVALID_URL' "$output"; then
    printf malformed-configuration
  else
    printf unexpected-registry-response
  fi
}

printf 'Verifying %s@%s via %s (anonymous read; %s attempts)\n' "$PACKAGE_NAME" "$VERSION" "$REGISTRY" "$MAX_ATTEMPTS"

for ((ATTEMPT=1; ATTEMPT<=MAX_ATTEMPTS; ATTEMPT++)); do
  if (( ATTEMPT > 1 )); then
    sleep "${DELAYS[ATTEMPT-2]}"
  fi
  # Keep the actual npm response at one stable, configurable path. This is
  # both the source parsed below and an uploadable CI diagnostic.
  STDOUT_FILE="$METADATA_FILE"
  STDERR_FILE="$WORK_DIR/stderr.$ATTEMPT"

  set +e
  (
    cd "$WORK_DIR"
    # Start with an empty environment so auth supplied through npm-specific
    # variables (not just NODE_AUTH_TOKEN) cannot turn this public check into
    # an authenticated lookup.
    env -i PATH="$PATH" HOME="$WORK_DIR" \
      NPM_CONFIG_USERCONFIG="$WORK_DIR/clean.npmrc" \
      NPM_CONFIG_GLOBALCONFIG="$WORK_DIR/clean-global.npmrc" \
      npm view "${PACKAGE_NAME}@${VERSION}" --json --registry="$REGISTRY"
  ) >"$STDOUT_FILE" 2>"$STDERR_FILE"
  LAST_EXIT=$?
  set -e

  if (( LAST_EXIT == 0 )); then
    PUBLISHED_VERSION="$(jq -r '.version // empty' "$METADATA_FILE" 2>/dev/null || true)"
    if [[ "$PUBLISHED_VERSION" != "$VERSION" ]]; then
      LAST_CLASSIFICATION="version-mismatch"
      write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
      printf 'Verification failed: registry returned version %q instead of %q.\n' "$PUBLISHED_VERSION" "$VERSION" >&2
      exit 1
    fi
    TARBALL_URL="$(jq -r '.dist.tarball // empty' "$METADATA_FILE" 2>/dev/null || true)"
    if [[ -z "$TARBALL_URL" ]]; then
      LAST_CLASSIFICATION="missing-tarball"
      write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
      printf 'Verification failed: response metadata at %s did not include dist.tarball. Sanitized response: %s\n' \
        "$METADATA_FILE" "$LAST_RESPONSE_FILE" >&2
      exit 1
    fi
    if [[ "$TARBALL_URL" != https://registry.npmjs.org/* ]]; then
      LAST_CLASSIFICATION="unexpected-registry"
      write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
      printf 'Verification failed: response referenced an unexpected registry.\n' >&2
      exit 1
    fi
    LAST_CLASSIFICATION="success"
    write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
    printf 'Package publicly available after %s attempt(s) in %ss.\n' "$ATTEMPT" "$((SECONDS - START_SECONDS))"
    exit 0
  fi

  LAST_CLASSIFICATION="$(classify_failure "$STDERR_FILE")"
  write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
  case "$LAST_CLASSIFICATION" in
    version-not-found|network)
      [[ "${KASEKI_VERIFY_DEBUG:-0}" == 1 ]] && printf 'Attempt %s/%s: transient %s (npm exit %s).\n' "$ATTEMPT" "$MAX_ATTEMPTS" "$LAST_CLASSIFICATION" "$LAST_EXIT" >&2
      ;;
    *)
      printf 'Verification failed immediately: %s (npm exit %s; registry %s; attempt %s; elapsed %ss).\n' \
        "$LAST_CLASSIFICATION" "$LAST_EXIT" "$REGISTRY" "$ATTEMPT" "$((SECONDS - START_SECONDS))" >&2
      exit 1
      ;;
  esac
done

printf 'Verification failed: last error %s (npm exit %s; registry %s; attempts %s; elapsed %ss).\n' \
  "$LAST_CLASSIFICATION" "$LAST_EXIT" "$REGISTRY" "$MAX_ATTEMPTS" "$((SECONDS - START_SECONDS))" >&2
printf 'Diagnostics: metadata=%s sanitized-response=%s\n' "$METADATA_FILE" "$LAST_RESPONSE_FILE" >&2
exit 1
