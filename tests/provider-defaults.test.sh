#!/usr/bin/env bash
# Regression test: provider defaults stay on the safe OpenRouter path unless gateway is explicit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

assert_default_provider() {
  local script_path="$1"
  local script_name="$2"
  if ! grep -Fq 'KASEKI_PROVIDER="${KASEKI_PROVIDER:-openrouter}"' "$script_path"; then
    printf '✗ %s does not default KASEKI_PROVIDER to openrouter\n' "$script_name"
    exit 1
  fi
  if grep -Fq 'KASEKI_PROVIDER="${KASEKI_PROVIDER:-gateway}"' "$script_path"; then
    printf '✗ %s still defaults KASEKI_PROVIDER to gateway\n' "$script_name"
    exit 1
  fi
}

assert_default_provider "$PROJECT_ROOT/run-kaseki.sh" 'run-kaseki.sh'
assert_default_provider "$PROJECT_ROOT/kaseki-agent.sh" 'kaseki-agent.sh'

printf '✓ shell provider defaults are deterministic and safe\n'
