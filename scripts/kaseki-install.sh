#!/usr/bin/env bash
set -euo pipefail

KASEKI_REPO_URL="${KASEKI_REPO_URL:-https://github.com/CyanAutomation/kaseki-agent.git}"
KASEKI_REF="${KASEKI_REF:-main}"
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"

if ! command -v git >/dev/null 2>&1; then
  printf 'Error: git is required to install kaseki-agent.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$KASEKI_CHECKOUT_DIR")"

if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
  git -C "$KASEKI_CHECKOUT_DIR" fetch --prune origin
else
  rm -rf "$KASEKI_CHECKOUT_DIR"
  git clone "$KASEKI_REPO_URL" "$KASEKI_CHECKOUT_DIR"
fi

git -C "$KASEKI_CHECKOUT_DIR" checkout "$KASEKI_REF"
git -C "$KASEKI_CHECKOUT_DIR" pull --ff-only origin "$KASEKI_REF" 2>/dev/null || true

KASEKI_LOG_DIR="$KASEKI_LOG_DIR" "$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" --json bootstrap
