#!/usr/bin/env bash
# Verify that an exact package version is publicly visible on npm.
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REGISTRY="https://registry.npmjs.org/"
METADATA_FILE="${KASEKI_NPM_VERIFY_METADATA_FILE:-/tmp/npm-publish-diagnostics/npm-view.json}"
DIAGNOSTIC_DIR="$(dirname "$METADATA_FILE")"
LAST_RESPONSE_FILE="$DIAGNOSTIC_DIR/npm-verify-last-response.json"
MAX_ELAPSED_SECONDS="${3:-300}"
BACKOFF_CAP_SECONDS="${KASEKI_NPM_VERIFY_BACKOFF_CAP_SECONDS:-32}"
JITTER_PERCENT="${KASEKI_NPM_VERIFY_JITTER_PERCENT:-20}"
SLEEP_COMMAND="${KASEKI_NPM_VERIFY_SLEEP_COMMAND:-sleep}"
NOW_COMMAND="${KASEKI_NPM_VERIFY_NOW_COMMAND:-date}"

usage() {
  printf 'Usage: %s <PACKAGE_NAME> <VERSION> [MAX_ELAPSED_SECONDS]\n' "$SCRIPT_NAME" >&2
}

validate_positive_seconds() {
  local name="$1" value="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]{0,4}$ ]] || (( 10#$value > 86400 )); then
    printf 'Error: %s must be an integer from 1 through 86400\n' "$name" >&2
    exit 2
  fi
}

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage
  exit 2
fi
PACKAGE_NAME="$1"
VERSION="$2"
validate_positive_seconds MAX_ELAPSED_SECONDS "$MAX_ELAPSED_SECONDS"
validate_positive_seconds KASEKI_NPM_VERIFY_BACKOFF_CAP_SECONDS "$BACKOFF_CAP_SECONDS"
if [[ ! "$JITTER_PERCENT" =~ ^([0-9]|[1-9][0-9])$ ]]; then
  printf 'Error: KASEKI_NPM_VERIFY_JITTER_PERCENT must be an integer from 0 through 99\n' >&2
  exit 2
fi
if [[ "$SLEEP_COMMAND" == */* ]]; then
  [[ -x "$SLEEP_COMMAND" ]] || { printf 'Error: sleep command is not executable: %s\n' "$SLEEP_COMMAND" >&2; exit 2; }
elif ! command -v "$SLEEP_COMMAND" >/dev/null 2>&1; then
  printf 'Error: sleep command not found on PATH: %s\n' "$SLEEP_COMMAND" >&2
  exit 2
fi
if [[ "$NOW_COMMAND" == */* ]]; then
  [[ -x "$NOW_COMMAND" ]] || { printf 'Error: clock command is not executable: %s\n' "$NOW_COMMAND" >&2; exit 2; }
elif ! command -v "$NOW_COMMAND" >/dev/null 2>&1; then
  printf 'Error: clock command not found on PATH: %s\n' "$NOW_COMMAND" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  printf 'Error: jq is required but not found on PATH\n' >&2
  exit 3
fi

now_seconds() {
  local value
  if [[ "$NOW_COMMAND" == date ]]; then
    value="$("$NOW_COMMAND" +%s)"
  else
    value="$("$NOW_COMMAND")"
  fi
  [[ "$value" =~ ^[0-9]{1,10}$ ]] || { printf 'Error: clock command returned a non-negative integer: %q\n' "$value" >&2; exit 2; }
  printf '%s' "$value"
}

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$DIAGNOSTIC_DIR"
printf 'registry=%s\nalways-auth=false\n' "$REGISTRY" >"$WORK_DIR/clean.npmrc"
: >"$WORK_DIR/clean-global.npmrc"
START_SECONDS="$(now_seconds)"
LAST_CLASSIFICATION="not-attempted"
LAST_EXIT=0
ATTEMPT=0

elapsed_seconds() {
  local current
  current="$(now_seconds)"
  (( 10#$current >= 10#$START_SECONDS )) || { printf 'Error: clock moved backwards during verification\n' >&2; exit 2; }
  printf '%s' "$((10#$current - 10#$START_SECONDS))"
}

# Store a useful artifact without allowing credentials from npm diagnostics into it.
write_response() {
  local attempt="$1" classification="$2" exit_status="$3" stdout_file="$4" stderr_file="$5" elapsed
  local token="${NODE_AUTH_TOKEN:-}"
  elapsed="$(elapsed_seconds)"
  jq -n --arg registry "$REGISTRY" --arg package "$PACKAGE_NAME" --arg version "$VERSION" \
    --argjson attempt "$attempt" --argjson maxElapsedSeconds "$MAX_ELAPSED_SECONDS" \
    --argjson elapsedSeconds "$elapsed" --argjson exitStatus "$exit_status" \
    --arg classification "$classification" --rawfile stdout "$stdout_file" --rawfile stderr "$stderr_file" \
    --arg secret "$token" '
      def redact:
        gsub("npm_[A-Za-z0-9]{8,}"; "[REDACTED]")
        | gsub("((?i)_authToken)[[:space:]]*=[[:space:]]*[^[:space:]]+"; "_authToken=[REDACTED]")
        | gsub("https?://[^/@[:space:]]+@"; "https://[REDACTED]@")
        | if ($secret | length) > 0 then split($secret) | join("[REDACTED]") else . end;
      {registry: $registry, package: $package, requestedVersion: $version,
       attempt: $attempt, maxElapsedSeconds: $maxElapsedSeconds, elapsedSeconds: $elapsedSeconds,
       exitStatus: $exitStatus, classification: $classification,
       stdout: ($stdout | redact), stderr: ($stderr | redact)}' >"$LAST_RESPONSE_FILE"
}

classify_failure() {
  local output="$1"
  if grep -Eqi 'E401|ENEEDAUTH|EAUTH|authentication (required|failed)|incorrect or missing password' "$output"; then printf authentication
  elif grep -Eqi 'E403|forbidden|not authorized|permission denied' "$output"; then printf authorization
  elif grep -Eqi 'ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|FETCH_ERROR|[[:space:]]5[0-9][0-9][[:space:]]' "$output"; then printf network
  elif grep -Eqi 'E404|404 Not Found|version[^[:alnum:]]+(not found|does not exist)|No match found for version' "$output"; then printf version-not-found
  elif grep -Eqi 'ECONFIG|invalid config|configuration error|ERR_INVALID_URL' "$output"; then printf malformed-configuration
  else printf unexpected-registry-response
  fi
}

printf 'Verifying %s@%s via %s (anonymous read; deadline %ss).\n' "$PACKAGE_NAME" "$VERSION" "$REGISTRY" "$MAX_ELAPSED_SECONDS"

while :; do
  ATTEMPT=$((ATTEMPT + 1))
  ELAPSED="$(elapsed_seconds)"
  printf 'Attempt %s starting (elapsed %ss; deadline %ss).\n' "$ATTEMPT" "$ELAPSED" "$MAX_ELAPSED_SECONDS"
  STDOUT_FILE="$METADATA_FILE"
  STDERR_FILE="$WORK_DIR/stderr.$ATTEMPT"

  set +e
  (
    cd "$WORK_DIR"
    env -i PATH="$PATH" HOME="$WORK_DIR" \
      NPM_CONFIG_USERCONFIG="$WORK_DIR/clean.npmrc" \
      NPM_CONFIG_GLOBALCONFIG="$WORK_DIR/clean-global.npmrc" \
      npm view "${PACKAGE_NAME}@${VERSION}" --json --registry="$REGISTRY"
  ) >"$STDOUT_FILE" 2>"$STDERR_FILE"
  LAST_EXIT=$?
  set -e

  if (( LAST_EXIT == 0 )); then
    PUBLISHED_VERSION="$(jq -r '.version // empty' "$METADATA_FILE" 2>/dev/null || true)"
    if [[ "$PUBLISHED_VERSION" != "$VERSION" ]]; then LAST_CLASSIFICATION="version-mismatch"
    elif [[ -z "$(jq -r '.dist.tarball // empty' "$METADATA_FILE" 2>/dev/null || true)" ]]; then LAST_CLASSIFICATION="missing-tarball"
    elif [[ "$(jq -r '.dist.tarball' "$METADATA_FILE")" != https://registry.npmjs.org/* ]]; then LAST_CLASSIFICATION="unexpected-registry"
    else
      LAST_CLASSIFICATION="success"; write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
      printf 'Package publicly available after %s attempt(s) (elapsed %ss; deadline %ss).\n' "$ATTEMPT" "$(elapsed_seconds)" "$MAX_ELAPSED_SECONDS"
      exit 0
    fi
    write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
    printf 'Verification failed immediately: %s (attempt %s; elapsed %ss; deadline %ss).\n' "$LAST_CLASSIFICATION" "$ATTEMPT" "$(elapsed_seconds)" "$MAX_ELAPSED_SECONDS" >&2
    exit 1
  fi

  LAST_CLASSIFICATION="$(classify_failure "$STDERR_FILE")"
  write_response "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$METADATA_FILE" "$STDERR_FILE"
  case "$LAST_CLASSIFICATION" in
    version-not-found|network) ;;
    *)
      printf 'Verification failed immediately: %s (npm exit %s; registry %s; attempt %s; elapsed %ss; deadline %ss).\n' \
        "$LAST_CLASSIFICATION" "$LAST_EXIT" "$REGISTRY" "$ATTEMPT" "$(elapsed_seconds)" "$MAX_ELAPSED_SECONDS" >&2
      exit 1 ;;
  esac

  ELAPSED="$(elapsed_seconds)"
  REMAINING=$((10#$MAX_ELAPSED_SECONDS - 10#$ELAPSED))
  if (( REMAINING <= 0 )); then break; fi
  # 1, 2, 4, 8, 16, then capped waits. Jitter is applied only at the cap,
  # and only subtracts, so a configured cap is never exceeded.
  if (( ATTEMPT >= 31 )); then BASE_DELAY=$((10#$BACKOFF_CAP_SECONDS))
  else BASE_DELAY=$((1 << (ATTEMPT - 1))); fi
  if (( BASE_DELAY > 10#$BACKOFF_CAP_SECONDS )); then BASE_DELAY=$((10#$BACKOFF_CAP_SECONDS)); fi
  DELAY=$BASE_DELAY
  if (( BASE_DELAY == 10#$BACKOFF_CAP_SECONDS && 10#$JITTER_PERCENT > 0 )); then
    JITTER_RANGE=$((BASE_DELAY * 10#$JITTER_PERCENT / 100))
    if (( JITTER_RANGE > 0 )); then DELAY=$((BASE_DELAY - RANDOM % (JITTER_RANGE + 1))); fi
  fi
  if (( DELAY > REMAINING )); then DELAY=$REMAINING; fi
  printf 'Attempt %s result: transient %s (npm exit %s; elapsed %ss; deadline %ss). Next retry in %ss.\n' \
    "$ATTEMPT" "$LAST_CLASSIFICATION" "$LAST_EXIT" "$ELAPSED" "$MAX_ELAPSED_SECONDS" "$DELAY" >&2
  "$SLEEP_COMMAND" "$DELAY"
done

printf 'Verification failed: last error %s (npm exit %s; registry %s; attempts %s; elapsed %ss; deadline %ss).\n' \
  "$LAST_CLASSIFICATION" "$LAST_EXIT" "$REGISTRY" "$ATTEMPT" "$(elapsed_seconds)" "$MAX_ELAPSED_SECONDS" >&2
printf 'Diagnostics: metadata=%s sanitized-response=%s\n' "$METADATA_FILE" "$LAST_RESPONSE_FILE" >&2
exit 1
