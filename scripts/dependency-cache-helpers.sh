#!/usr/bin/env bash
# Helper functions for dependency-cache key construction. This file is intended
# to be sourced by kaseki-agent.sh and tests.

dependency_cache_flags_identity() {
  printf 'omit_dev=%s\nignore_scripts=%s\n' "${KASEKI_NPM_OMIT_DEV:-0}" "${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}"
}

dependency_cache_flags_hash() {
  dependency_cache_flags_identity | sha256sum | awk '{print $1}'
}

dependency_cache_key() {
  local lock_hash="$1"
  local node_major="$2"
  local flags_hash="$3"
  local node_platform="${4:-$(node -p 'process.platform' 2>/dev/null || uname -s)}"
  local node_arch="${5:-$(node -p 'process.arch' 2>/dev/null || uname -m)}"
  local node_abi="${6:-$(node -p 'process.versions.modules || "none"' 2>/dev/null || printf 'unknown')}"
  printf 'npm/%s/node-%s/platform-%s/arch-%s/abi-%s/flags-%s' \
    "$lock_hash" "$node_major" "$node_platform" "$node_arch" "$node_abi" "$flags_hash"
}

dependency_cache_write_restore_diagnostic() {
  local diagnostic_file="$1"
  local cache_source="$2"
  local reason="$3"
  local restore_method="$4"
  local npm_exit_code="$5"
  local npm_output="$6"
  local safe_output
  safe_output="$(printf '%s\n' "$npm_output" \
    | sed -E 's#(https?://)[^/@[:space:]]+@#\1[REDACTED]@#g' \
    | tail -20)"
  {
    printf 'timestamp=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'cache_source=%s\nreason=%s\nrestore_method=%s\nnpm_ls_exit_code=%s\n' \
      "$cache_source" "$reason" "$restore_method" "$npm_exit_code"
    printf 'node_version=%s\nnpm_version=%s\nnode_platform=%s\nnode_arch=%s\nnode_abi=%s\n' \
      "$(node --version 2>/dev/null || printf unknown)" \
      "$(npm --version 2>/dev/null || printf unknown)" \
      "$(node -p 'process.platform' 2>/dev/null || uname -s)" \
      "$(node -p 'process.arch' 2>/dev/null || uname -m)" \
      "$(node -p 'process.versions.modules || "none"' 2>/dev/null || printf unknown)"
    printf 'npm_ls_output_tail:\n%s\n---\n' "$safe_output"
  } >> "$diagnostic_file"
}

# Print the recovery selected after validating a restored cache. The return
# status only reports whether this helper itself ran successfully; callers must
# use the printed action ("reuse" or "reinstall") to distinguish outcomes.
# Keeping this decision pure makes the cache contract testable without running
# an agent and avoids overloading non-zero statuses with recovery state.
dependency_cache_recovery_action() {
  local schema_valid="$1"
  local executables_valid="$2"
  local dependency_graph_valid="${3:-0}"
  if [ "$schema_valid" -eq 0 ] && [ "$executables_valid" -eq 0 ] && [ "$dependency_graph_valid" -eq 0 ]; then
    printf 'reuse\n'
  else
    printf 'reinstall\n'
  fi
}

dependency_cache_schema_valid() {
  local marker="$1"
  local expected_version="$2"
  [ -r "$marker" ] && [ "$(cat "$marker")" = "$expected_version" ]
}
