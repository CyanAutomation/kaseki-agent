#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/kaseki-agent.sh"

fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

grep -Fq 'KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION="${KASEKI_DEPENDENCY_CACHE_SCHEMA_VERSION:-2}"' "$SCRIPT" || fail "cache schema version missing"
grep -Fq 'restored cache failed executable/schema validation; reinstalling' "$SCRIPT" || fail "restored cache integrity recovery missing"
invalid_line="$(grep -n 'restored cache failed executable/schema validation; reinstalling' "$SCRIPT" | head -1 | cut -d: -f1)"
validated_line="$(grep -n 'restored validated workspace cache; skipping redundant npm ls validation' "$SCRIPT" | head -1 | cut -d: -f1)"
[ "$validated_line" -gt "$invalid_line" ] || fail "validated-cache message must be confined to the successful validation branch"
grep -Fq 'git -C "${KASEKI_WORKSPACE_DIR}"/repo diff HEAD -- .' "$SCRIPT" || fail "changed-file collection does not include staged changes"
grep -Fq 'changed-files.json' "$SCRIPT" || fail "structured changed-file evidence artifact missing"
grep -Fq 'Validation command was not found (exit 127); repairing dependencies and retrying once.' "$SCRIPT" || fail "exit-127 validation retry missing"
grep -Fq 'if [ "$STATUS" -eq 0 ]; then' "$SCRIPT" || fail "terminal summary stale-metadata guard missing"

printf '✓ dependency cache recovery and summary contracts present\n'
