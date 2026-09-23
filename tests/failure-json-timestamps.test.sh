#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-failure-json.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

function_source="$(awk '
  /^write_failure_json\(\)/ { emit=1 }
  emit && /<<FAILURE/ { heredoc=1 }
  emit { print }
  emit && heredoc && /^FAILURE$/ { heredoc=0; next }
  emit && !heredoc && /^}$/ { exit }
' "$ROOT_DIR/kaseki-agent.sh")"
eval "$function_source"

# Initialize the extracted function's globals so the complete failure artifact
# can be serialized without sourcing the worker's startup side effects.
while IFS= read -r variable; do
  [ -n "$variable" ] || continue
  printf -v "$variable" '%s' 0
done < <(printf '%s\n' "$function_source" | grep -oE '\$[A-Z][A-Z0-9_]+' | tr -d '$' | sort -u)

json_encode() {
  node -e 'let value=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => process.stdout.write(JSON.stringify(value)));'
}
extract_failure_diagnostic_reason() { printf 'fixture failure'; }
metadata_env_fingerprints_json() { printf '{}'; }
github_skip_reasons_json() { printf '[]'; }
consolidate_phase_file() { printf '[]'; }

KASEKI_RESULTS_DIR="$TMP_DIR/results"
mkdir -p "$KASEKI_RESULTS_DIR"
: > "$KASEKI_RESULTS_DIR/stderr.log"
INSTANCE_NAME='failure timestamp fixture'
START_ISO='2026-09-23T19:20:54Z'
FAILED_COMMAND='goal check'

write_failure_json 8
node - "$KASEKI_RESULTS_DIR/failure.json" <<'NODE'
const fs = require('node:fs');
const failure = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (failure.started_at !== '2026-09-23T19:20:54Z') throw new Error('failure.json omitted original run start timestamp');
if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(failure.ended_at)) throw new Error('failure.json omitted a durable end timestamp');
if (failure.failed_command !== 'goal check' || failure.exit_code !== 8) throw new Error('failure.json lost the root failure classification');
NODE

printf '✓ failure.json preserves original run timestamps and root failure classification.\n'
