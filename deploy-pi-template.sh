#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${KASEKI_TEMPLATE_DIR:-/agents/kaseki-template}"
IMAGE="${KASEKI_IMAGE:-docker.io/cyanautomation/kaseki-agent:0.1.0}"

if [ "${1:-}" = "--help" ]; then
  cat <<HELP
Usage: KASEKI_TEMPLATE_DIR=/agents/kaseki-template $0

Deploys the current Kaseki runner files into /agents/kaseki-template.
Preserves existing run, result, cache, and secret directories.
HELP
  exit 0
fi

mkdir -p "$TARGET_DIR"

install_file() {
  local mode="$1"
  local source="$2"
  local target="$TARGET_DIR/$source"
  mkdir -p "$(dirname "$target")"
  install -m "$mode" "$SOURCE_DIR/$source" "$target"
}

install_file 0755 run-kaseki.sh
install_file 0755 cleanup-kaseki.sh
install_file 0755 kaseki-agent.sh
install_file 0755 deploy-pi-template.sh
install_file 0755 github-app-token.js
install_file 0755 kaseki-cli.js
install_file 0755 kaseki-report.js
install_file 0755 pi-event-filter.js
install_file 0755 pi-progress-stream.js
install_file 0644 kaseki-cli-lib.js
install_file 0644 Dockerfile
install_file 0644 .dockerignore
install_file 0644 README.md
install_file 0644 CLAUDE.md
install_file 0644 package.json
install_file 0644 package-lock.json
install_file 0644 docker/workspace-cache/package.json
install_file 0644 docker/workspace-cache/package-lock.json
install_file 0644 docs/CLI.md
install_file 0644 docs/repo-maturity.md

if command -v docker >/dev/null 2>&1; then
  printf 'Docker image configured for doctor: %s\n' "$IMAGE"
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'Docker image: present\n'
  else
    printf 'Docker image: missing locally (%s)\n' "$IMAGE" >&2
  fi
fi

printf 'Deployed Kaseki template to %s\n' "$TARGET_DIR"
