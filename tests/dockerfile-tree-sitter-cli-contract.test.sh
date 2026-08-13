#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT_DIR/Dockerfile"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

phase="$(sed -n '/# Phase 3b:/,/# Phase 3c:/p' "$DOCKERFILE" | sed '$d')"

grep -Fq 'npm install -g --no-audit tree-sitter-cli@0.25.10' <<<"$phase" \
  || fail 'Phase 3b must install the repository-supported tree-sitter-cli version'
! grep -Eq 'npm install .*tree-sitter-cli([[:space:]\\]|$)' <<<"$phase" \
  || fail 'Phase 3b must not contain an unversioned tree-sitter-cli install'

grep -Fq 'max_attempts=3' <<<"$phase" \
  || fail 'Phase 3b must define a bounded retry limit'
grep -Fq 'while [ "$attempt" -le "$max_attempts" ]' <<<"$phase" \
  || fail 'Phase 3b retries must be bounded by the configured limit'
grep -Fq 'if [ "$attempt" -eq "$max_attempts" ]' <<<"$phase" \
  || fail 'Phase 3b must fail after the final attempt'
grep -Fq 'sleep "$attempt"' <<<"$phase" \
  || fail 'Phase 3b retries must include a small backoff'

cleanup_count="$(grep -Fc 'rm -rf "$(npm root -g)/tree-sitter-cli" "$(npm prefix -g)/bin/tree-sitter"' <<<"$phase")"
[[ "$cleanup_count" -ge 2 ]] \
  || fail 'Phase 3b must clean incomplete package and executable artifacts before retrying'

install_line="$(grep -nF 'npm install -g --no-audit tree-sitter-cli@0.25.10' <<<"$phase" | cut -d: -f1)"
validation_line="$(grep -nF '&& tree-sitter --version' <<<"$phase" | cut -d: -f1)"
[[ -n "$validation_line" && "$validation_line" -eq $((install_line + 1)) ]] \
  || fail 'Phase 3b must immediately validate tree-sitter in the installation layer'

printf '✓ Dockerfile tree-sitter-cli installation contract assertions passed.\n'
