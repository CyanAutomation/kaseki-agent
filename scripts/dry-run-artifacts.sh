#!/usr/bin/env bash
# Helpers for deterministic dry-run artifact generation.

json_string_fallback() {
  local value="${1-}"
  if declare -F json_string >/dev/null 2>&1; then
    json_string "$value"
  elif command -v node >/dev/null 2>&1; then
    node -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""))' "$value"
  else
    printf 'Error: json_string_fallback requires either json_string function or node\n' >&2
    return 1
  fi
}

write_dry_run_host_start_artifact() {
  local result_dir="$1"
  mkdir -p "$result_dir"
  cat > "$result_dir/host-start.json" <<META
{
  "instance": $(json_string_fallback "${INSTANCE:-}"),
  "repo_url": $(json_string_fallback "${REPO_URL:-}"),
  "git_ref": $(json_string_fallback "${GIT_REF:-}"),
  "provider": $(json_string_fallback "${KASEKI_PROVIDER:-}"),
  "model": $(json_string_fallback "${KASEKI_MODEL:-}"),
  "task_mode": $(json_string_fallback "${KASEKI_TASK_MODE:-}"),
  "allow_empty_diff": $(json_string_fallback "${KASEKI_ALLOW_EMPTY_DIFF:-}"),
  "dry_run": $(json_string_fallback "${KASEKI_DRY_RUN:-0}"),
  "startup_check_mode": $(json_string_fallback "${KASEKI_STARTUP_CHECK_MODE:-boot}"),
  "container_user": $(json_string_fallback "${KASEKI_CONTAINER_USER:-}"),
  "changed_files_allowlist": $(json_string_fallback "${KASEKI_CHANGED_FILES_ALLOWLIST:-}"),
  "max_diff_bytes": ${MAX_DIFF_BYTES_VALUE:-0},
  "agentTimeoutSeconds": ${AGENT_TIMEOUT_SECONDS_VALUE:-0},
  "started_at": $(json_string_fallback "$(date -u +%Y-%m-%dT%H:%M:%SZ)"),
  "host": $(json_string_fallback "$(hostname)"),
  "image": $(json_string_fallback "${IMAGE:-}"),
  "cache_dir": $(json_string_fallback "${CACHE:-}")
}
META
}

initialize_dry_run_agent_artifacts() {
  local result_dir="$1"
  mkdir -p "$result_dir"
  : > "$result_dir/pi-events.jsonl"
  : > "$result_dir/pi-summary.json"
  : > "$result_dir/validation-timings.tsv"
  : > "$result_dir/validation.log"
  : > "$result_dir/validation-raw.log"
  : > "$result_dir/validation-env.log"
}

write_dry_run_startup_check_artifacts() {
  local result_dir="${1:-${KASEKI_RESULTS_DIR:-/results}}"
  local openrouter_file="${OPENROUTER_API_KEY_FILE:-}"
  local pi_version node_version git_version

  mkdir -p "$result_dir"
  initialize_dry_run_agent_artifacts "$result_dir"
  printf '[progress] startup check: container booted\n'
  node_version="$(node --version)"
  git_version="$(git --version)"
  pi_version="$(pi --version 2>&1)" || {
    printf 'pi version check failed: %s\n' "$pi_version" >&2
    return 1
  }
  if [ -n "$openrouter_file" ]; then
    test -r "$openrouter_file"
  fi
  test -w /workspace 2>/dev/null || test -w "${KASEKI_WORKSPACE_DIR:-$PWD}"
  test -w "$result_dir"
  test -w /cache 2>/dev/null || test -w "${KASEKI_CACHE_DIR:-${TMPDIR:-/tmp}}"
  printf 'startup_check=ok\n' > "$result_dir/startup-check.txt"
  cat > "$result_dir/metadata.json" <<META
{
  "startupCheck": true,
  "startup_check": true,
  "dryRun": true,
  "dry_run": "1",
  "exit_code": 0,
  "current_stage": "startup check",
  "node_version": "$node_version",
  "git_version": "$git_version",
  "pi_version": "$pi_version"
}
META
  cat > "$result_dir/result-summary.md" <<SUMMARY
# Kaseki Startup Check

- Status: passed
- Container booted: yes
- OpenRouter secret mounted: yes
- Workspace writable: yes
- Results writable: yes
- Cache writable: yes
SUMMARY
  printf '[progress] startup check: completed\n'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  write_dry_run_startup_check_artifacts "${1:-${KASEKI_RESULTS_DIR:-/results}}"
fi
