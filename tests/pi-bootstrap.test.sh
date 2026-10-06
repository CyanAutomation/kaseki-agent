#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP="$ROOT_DIR/scripts/bootstrap-pi.sh"

help_output="$(bash "$BOOTSTRAP" --help)"
grep -q 'Debian 12/13 or 64-bit Raspberry Pi OS' <<< "$help_output"
grep -q 'KASEKI_SETUP_LLM_GATEWAY_URL' <<< "$help_output"

grep -q 'sha256sum -c' "$BOOTSTRAP"
grep -q 'docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin' "$BOOTSTRAP"
grep -q 'docker info' "$BOOTSTRAP"
grep -q 'df -Pk' "$BOOTSTRAP"
grep -q 'if ! command -v curl' "$BOOTSTRAP"
checksum_line="$(grep -n 'sha256sum -c' "$BOOTSTRAP" | cut -d: -f1)"
extract_line="$(grep -n 'tar -xzf' "$BOOTSTRAP" | cut -d: -f1)"
test "$checksum_line" -lt "$extract_line"
install_dir_check_line="$(grep -n '\[ ! -e "\$INSTALL_DIR" \]' "$BOOTSTRAP" | cut -d: -f1)"
docker_package_install_line="$(grep -n 'sudo apt-get update' "$BOOTSTRAP" | head -n 1 | cut -d: -f1)"
test "$install_dir_check_line" -lt "$docker_package_install_line"
if grep -Eq 'usermod .*docker|usermod -aG docker' "$BOOTSTRAP"; then
  echo 'bootstrap must not silently grant root-equivalent Docker group access' >&2
  exit 1
fi

grep -q 'kaseki-agent-source.tar.gz' "$ROOT_DIR/.github/workflows/release.yml"
grep -q 'sha256sum' "$ROOT_DIR/.github/workflows/release.yml"
grep -q 'gh release upload' "$ROOT_DIR/.github/workflows/release.yml"
grep -q 'bootstrap-pi.sh.sha256' "$ROOT_DIR/.github/workflows/release.yml"

remote_help="$(bash "$ROOT_DIR/scripts/pi-setup-remote.sh" --help)"
grep -q 'Usage:.*<ssh-target>' <<< "$remote_help"
grep -q 'does not accept API keys' <<< "$remote_help"
grep -q 'bootstrap-pi.sh.sha256' "$ROOT_DIR/scripts/pi-setup-remote.sh"
if grep -Eq 'OPENROUTER_API_KEY=sk-or|<remote-host> <api-key|API_KEY_SOURCE=' "$ROOT_DIR/scripts/pi-setup-remote.sh"; then
  echo 'remote setup must not accept or expose provider credentials as arguments' >&2
  exit 1
fi

echo 'Pi bootstrap contract tests passed'
