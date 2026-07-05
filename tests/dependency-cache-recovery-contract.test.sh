#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/kaseki-agent.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

grep -Fq 'KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION="${KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION:-2}"' "$SCRIPT" || fail "cache schema version missing"
grep -Fq 'restored cache failed executable/schema validation; reinstalling' "$SCRIPT" || fail "restored cache integrity recovery missing"
grep -Fq 'Validation command was not found (exit 127); repairing dependencies and retrying once.' "$SCRIPT" || fail "exit-127 validation retry missing"
grep -Fq 'if [ "$STATUS" -eq 0 ]; then' "$SCRIPT" || fail "terminal summary stale-metadata guard missing"

printf '✓ dependency cache recovery and summary contracts present\n'
