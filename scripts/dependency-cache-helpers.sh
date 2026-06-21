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
