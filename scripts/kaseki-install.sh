#!/usr/bin/env bash
set -euo pipefail

KASEKI_REPO_URL="${KASEKI_REPO_URL:-https://github.com/CyanAutomation/kaseki-agent.git}"
KASEKI_REF="${KASEKI_REF:-main}"
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
KASEKI_CHECKOUT_DIR="${KASEKI_CHECKOUT_DIR:-$KASEKI_ROOT/kaseki-agent}"
KASEKI_LOG_DIR="${KASEKI_LOG_DIR:-/var/log/kaseki}"
KASEKI_CONTROLLER_MODE="${KASEKI_CONTROLLER_MODE:-0}"
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="${KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING:-1}"
KASEKI_IMAGE_PULL_POLICY="${KASEKI_IMAGE_PULL_POLICY:-always}"
KASEKI_REPLACE_STALE="${KASEKI_REPLACE_STALE:-0}"

if [ "$KASEKI_CONTROLLER_MODE" = "1" ]; then
  KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="0"
  KASEKI_IMAGE_PULL_POLICY="always"
fi

if ! command -v git >/dev/null 2>&1; then
  printf 'Error: git is required to install kaseki-agent.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$KASEKI_CHECKOUT_DIR")"

if [ -d "$KASEKI_CHECKOUT_DIR/.git" ]; then
  if [ -n "$(git -C "$KASEKI_CHECKOUT_DIR" status --porcelain)" ]; then
    if [ "$KASEKI_REPLACE_STALE" = "1" ]; then
      git -C "$KASEKI_CHECKOUT_DIR" reset --hard HEAD
      git -C "$KASEKI_CHECKOUT_DIR" clean -fdx
    else
      printf 'Error: dirty kaseki-agent checkout at %s. Set KASEKI_REPLACE_STALE=1 to reset stale local files.\n' "$KASEKI_CHECKOUT_DIR" >&2
      exit 3
    fi
  fi
  git -C "$KASEKI_CHECKOUT_DIR" fetch --prune origin
else
  rm -rf "$KASEKI_CHECKOUT_DIR"
  git clone "$KASEKI_REPO_URL" "$KASEKI_CHECKOUT_DIR"
fi

git -C "$KASEKI_CHECKOUT_DIR" checkout "$KASEKI_REF"
git -C "$KASEKI_CHECKOUT_DIR" pull --ff-only origin "$KASEKI_REF" 2>/dev/null || true

KASEKI_LOG_DIR="$KASEKI_LOG_DIR" \
KASEKI_CONTROLLER_MODE="$KASEKI_CONTROLLER_MODE" \
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING="$KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING" \
KASEKI_IMAGE_PULL_POLICY="$KASEKI_IMAGE_PULL_POLICY" \
KASEKI_REPLACE_STALE="$KASEKI_REPLACE_STALE" \
"$KASEKI_CHECKOUT_DIR/scripts/kaseki-activate.sh" --json bootstrap
