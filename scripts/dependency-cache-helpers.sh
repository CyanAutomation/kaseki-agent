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
  printf 'npm/%s/node-%s/flags-%s' "$lock_hash" "$node_major" "$flags_hash"
}

# Return the recovery selected after validating a restored cache.  Keeping this
# decision pure makes the cache contract testable without running an agent.
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
