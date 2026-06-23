#!/usr/bin/env bash
# Helper functions for npm install flag construction. This file is intended
# to be sourced by kaseki-agent.sh and tests.

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
