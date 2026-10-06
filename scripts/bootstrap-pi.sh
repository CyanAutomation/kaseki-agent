#!/usr/bin/env bash
# Install/check Docker, then fetch and verify a matching Kaseki release bundle.
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap-pi.sh [--help]

Bootstrap a clean Debian 12/13 or 64-bit Raspberry Pi OS host. The script
installs Docker Engine and Compose from Docker's official Debian repository
when needed, checks available disk space, verifies the release source bundle
with its published SHA-256 checksum, and runs the guided Kaseki setup.

Run as your normal login user (the script invokes sudo only for Docker's
system packages). The default install directory is ~/kaseki-agent. To pass a
known gateway endpoint without putting credentials in shell history, set
KASEKI_SETUP_LLM_GATEWAY_URL; setup prompts for the gateway key or reads it
from ~/secrets/llm_gateway_api_key. Setup never sends an inference request.

Docker group membership is not changed: access to the Docker socket is
effectively root access, so use sudo when the setup script needs it.
EOF
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  '') ;;
  *) printf 'Bootstrap error: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
esac

fail() {
  printf 'Bootstrap error: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '%s\n' "$*"
}

OS_ID=''
OS_CODENAME=''
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_CODENAME="${VERSION_CODENAME:-}"
fi
case "$OS_ID" in
  debian|raspbian) ;;
  *) fail "Unsupported operating system '$OS_ID'. Use Debian 12/13 or 64-bit Raspberry Pi OS." ;;
esac
case "$OS_CODENAME" in
  bookworm|trixie) ;;
  *) fail "Unsupported Debian release '$OS_CODENAME'. Use Debian 12 (bookworm) or Debian 13 (trixie)." ;;
esac
ARCH="$(dpkg --print-architecture 2>/dev/null || true)"
case "$ARCH" in
  arm64|amd64) ;;
  *) fail "Unsupported CPU architecture '$ARCH'. Use a 64-bit arm64 or amd64 host." ;;
esac

INSTALL_DIR="${KASEKI_INSTALL_DIR:-${HOME}/kaseki-agent}"
[ ! -e "$INSTALL_DIR" ] || fail "$INSTALL_DIR already exists. Use its scripts/setup-pi.sh, or set KASEKI_INSTALL_DIR to a new directory."

MIN_FREE_KB="${KASEKI_BOOTSTRAP_MIN_FREE_KB:-2097152}"
[[ "$MIN_FREE_KB" =~ ^[0-9]+$ ]] || fail 'KASEKI_BOOTSTRAP_MIN_FREE_KB must be a non-negative integer.'
FREE_KB="$(df -Pk "${HOME:-/tmp}" | awk 'END {print $4}')"
log "Available disk space: $((FREE_KB / 1024)) MiB (minimum: $((MIN_FREE_KB / 1024)) MiB)."
(( FREE_KB >= MIN_FREE_KB )) || fail 'At least 2 GiB of free space is recommended for the image and run data. Free space and retry.'

DOCKER_COMMAND=(docker)
docker_ready() {
  command -v docker >/dev/null 2>&1 || return 1
  if docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMMAND=(docker)
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1 && sudo docker compose version >/dev/null 2>&1; then
    DOCKER_COMMAND=(sudo docker)
    return 0
  fi
  return 1
}

if docker_ready; then
  log 'Docker Engine and Compose are already available.'
else
  command -v sudo >/dev/null 2>&1 || fail 'Docker is missing or unavailable and sudo is required to install Docker Engine.'
  log 'Installing Docker Engine and Compose from Docker’s official Debian package repository...'
  sudo -v
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian %s stable\n' \
    "$ARCH" "$OS_CODENAME" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable --now docker
  fi
fi

docker_ready || fail 'Docker Engine and Compose are not responding. Check sudo systemctl status docker.'
"${DOCKER_COMMAND[@]}" info >/dev/null 2>&1

if ! command -v curl >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 || fail 'curl is required to fetch Kaseki release assets; install curl and retry.'
  log 'Installing curl to download the Kaseki release bundle...'
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
fi

DOWNLOAD_BASE="${KASEKI_BOOTSTRAP_DOWNLOAD_BASE:-https://github.com/CyanAutomation/kaseki-agent/releases/latest/download}"
ARCHIVE_NAME='kaseki-agent-source.tar.gz'
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-bootstrap.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

log 'Downloading the matching Kaseki release bundle and checksum...'
curl -fsSL "$DOWNLOAD_BASE/$ARCHIVE_NAME" -o "$WORK_DIR/$ARCHIVE_NAME"
curl -fsSL "$DOWNLOAD_BASE/$ARCHIVE_NAME.sha256" -o "$WORK_DIR/$ARCHIVE_NAME.sha256"
(cd "$WORK_DIR" && sha256sum -c "$ARCHIVE_NAME.sha256") || fail 'The release bundle checksum did not match; nothing was extracted.'

mkdir -p "$INSTALL_DIR"
tar -xzf "$WORK_DIR/$ARCHIVE_NAME" -C "$INSTALL_DIR"
log "Kaseki source installed at $INSTALL_DIR."
(
  cd "$INSTALL_DIR"
  bash scripts/setup-pi.sh
)
