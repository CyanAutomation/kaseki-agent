#!/usr/bin/env bash
# Run the checksum-verified Pi bootstrap over SSH without transmitting keys.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/pi-setup-remote.sh <ssh-target>

Example:
  scripts/pi-setup-remote.sh pi@192.168.88.200

The target needs SSH access and a supported Debian 12/13 or 64-bit Raspberry
Pi OS install. The remote bootstrap verifies its release checksum, installs
Docker if needed, then prompts on the remote terminal for gateway settings.
This script does not accept API keys or passwords as arguments.
EOF
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
esac

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 2
fi
command -v ssh >/dev/null 2>&1 || { printf 'SSH client is required.\n' >&2; exit 1; }
REMOTE_HOST="$1"

printf 'Starting checksum-verified Kaseki setup on %s.\n' "$REMOTE_HOST"
printf 'The gateway key is entered on the remote terminal and is not sent as an SSH argument.\n'
ssh -t "$REMOTE_HOST" 'set -eu
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-bootstrap.XXXXXX")"
  trap '\''rm -rf "$work_dir"'\'' EXIT
  if ! command -v curl >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
  fi
  base="https://github.com/CyanAutomation/kaseki-agent/releases/latest/download"
  curl -fsSL "$base/bootstrap-pi.sh" -o "$work_dir/bootstrap-pi.sh"
  curl -fsSL "$base/bootstrap-pi.sh.sha256" -o "$work_dir/bootstrap-pi.sh.sha256"
  (cd "$work_dir" && sha256sum -c bootstrap-pi.sh.sha256)
  bash "$work_dir/bootstrap-pi.sh"
'
