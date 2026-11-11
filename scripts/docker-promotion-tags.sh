#!/usr/bin/env bash

set -euo pipefail

EVENT_NAME="${1:?Usage: docker-promotion-tags.sh EVENT_NAME RELEASE_VERSION SHORT_SHA RECOVERY}"
RELEASE_VERSION="${2:-}"
SHORT_SHA="${3:-}"
RECOVERY="${4:?Usage: docker-promotion-tags.sh EVENT_NAME RELEASE_VERSION SHORT_SHA RECOVERY}"

[[ "$RECOVERY" == true || "$RECOVERY" == false ]] || {
  printf 'Recovery mode must be true or false\n' >&2
  exit 2
}

if [[ "$EVENT_NAME" == workflow_call ]]; then
  [[ -n "$RELEASE_VERSION" ]] || {
    printf 'Release version is required for workflow_call\n' >&2
    exit 2
  }
  [[ "$RELEASE_VERSION" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]] || {
    printf 'Invalid Docker release tag: %s\n' "$RELEASE_VERSION" >&2
    exit 2
  }
  if [[ "$RECOVERY" == true ]]; then
    printf '%s' "$RELEASE_VERSION"
  else
    printf 'latest,%s' "$RELEASE_VERSION"
  fi
  exit 0
fi

[[ "$RECOVERY" == false ]] || {
  printf 'Recovery mode is only valid for a workflow_call\n' >&2
  exit 2
}
[[ "$EVENT_NAME" == workflow_dispatch || "$EVENT_NAME" == schedule ]] || {
  printf 'Unsupported Docker publish event: %s\n' "$EVENT_NAME" >&2
  exit 2
}
[[ "$SHORT_SHA" =~ ^[0-9a-f]{12}$ ]] || {
  printf 'A 12-character commit SHA is required for non-release builds\n' >&2
  exit 2
}
printf 'latest,main-%s' "$SHORT_SHA"
