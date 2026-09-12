#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

eval "$(awk '/^validation_timeout_for_command\(\)/ { emit=1 } emit { print } emit && /^}$/ { exit }' "$ROOT_DIR/kaseki-agent.sh")"

KASEKI_VALIDATION_TIMEOUT_SECONDS=300
KASEKI_BUILD_VALIDATION_TIMEOUT_SECONDS=900

[ "$(validation_timeout_for_command 'npm run build')" = '900' ] \
  || { echo 'build command did not receive the extended timeout' >&2; exit 1; }
[ "$(validation_timeout_for_command 'npm run test')" = '300' ] \
  || { echo 'test command did not retain the default timeout' >&2; exit 1; }

echo '✓ validation timeout policy distinguishes builds from ordinary checks'
