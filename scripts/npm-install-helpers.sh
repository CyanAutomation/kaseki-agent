#!/usr/bin/env bash
# Helper functions for npm install flag construction. This file is intended
# to be sourced by kaseki-agent.sh and tests.

# Install command contract: callers pass these flags directly to
# `npm ci --prefer-offline "${install_flags[@]}"`. KASEKI_NPM_OMIT_DEV=1
# adds --omit=dev (default off); KASEKI_INSTALL_IGNORE_SCRIPTS=1 adds
# --ignore-scripts (default on). Empty values use the same defaults as unset.
append_npm_install_flags() {
  local -n flags_ref="$1"
  flags_ref=()
  if [ "${KASEKI_NPM_OMIT_DEV:-0}" = "1" ]; then
    flags_ref+=("--omit=dev")
  fi
  if [ "${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}" = "1" ]; then
    flags_ref+=("--ignore-scripts")
  fi
}

render_npm_install_flags() {
  if [ "$#" -eq 0 ]; then
    printf 'none'
    return 0
  fi

  local rendered=""
  local flag
  for flag in "$@"; do
    if [ -n "$rendered" ]; then
      rendered+=" "
    fi
    rendered+="$(printf '%q' "$flag")"
  done
  printf '%s' "$rendered"
}

# Validation command-not-found failures can be dependency-cache damage.  The
# caller gets exactly one dependency repair attempt when a lockfile is present.
validation_dependency_recovery_action() {
  local validation_exit="$1"
  local lockfile_present="$2"
  local retry_count="${3:-0}"
  if [ "$validation_exit" -eq 127 ] && [ "$lockfile_present" -eq 1 ] && [ "$retry_count" -lt 1 ]; then
    printf 'reinstall_and_retry\n'
  else
    printf 'finish\n'
  fi
}
