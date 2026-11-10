#!/usr/bin/env bash
# Secure wrapper for checksum-verified remote Pi setup.
# Credentials are entered on the remote host and are never accepted as arguments.
set -euo pipefail

if [ -f "${KASEKI_APP_ROOT:-/app}/scripts/pi-setup-remote.sh" ]; then
  REMOTE_SETUP="${KASEKI_APP_ROOT:-/app}/scripts/pi-setup-remote.sh"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  REMOTE_SETUP="$SCRIPT_DIR/pi-setup-remote.sh"
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  exec "$REMOTE_SETUP" --help
fi

if [ "$#" -ne 1 ]; then
  cat >&2 <<'EOF'
Usage: kaseki-agent setup-remote <ssh-target>

Example:
  kaseki-agent setup-remote pi@192.168.88.201

The remote bootstrap prompts for the LLM Gateway credential on the target.
Senku decision credentials are optional and must be installed on the target
through its interactive setup script.
EOF
  exit 2
fi

exec "$REMOTE_SETUP" "$1"
