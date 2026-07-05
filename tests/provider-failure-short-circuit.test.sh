#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$REPO_ROOT/kaseki-agent.sh"

line_of() {
  grep -nF "$1" "$SCRIPT" | tail -n 1 | cut -d: -f1
}

guard_line="$(line_of 'if [ "$PI_EXIT" -eq 88 ] && [ "$STATUS" -ne 0 ]; then')"
validation_line="$(line_of "printf '\\n==> validation environment\\n'")"
evaluation_line="$(line_of 'run_run_evaluation')"

[ -n "$guard_line" ]
[ "$guard_line" -lt "$validation_line" ]
[ "$guard_line" -lt "$evaluation_line" ]
grep -Fq 'skipping downstream validation, evaluation, and GitHub operations' "$SCRIPT"
printf 'PASS: provider failure short-circuits downstream phases\n'
