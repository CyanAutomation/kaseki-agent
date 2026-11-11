#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$ROOT_DIR/scripts/docker-promotion-tags.sh"

[[ "$("$script" workflow_call 1.158.0 '' false)" == 'latest,1.158.0' ]] || {
  echo 'normal release Docker publication must promote latest and its version tag' >&2
  exit 1
}

[[ "$("$script" workflow_call 1.158.0 '' true)" == '1.158.0' ]] || {
  echo 'recovery Docker publication must republish only the requested version tag' >&2
  exit 1
}

[[ "$("$script" workflow_dispatch '' abcdef123456 false)" == 'latest,main-abcdef123456' ]] || {
  echo 'manual non-release Docker publication must retain latest and its main-specific tag' >&2
  exit 1
}

if "$script" workflow_call '' '' true >/dev/null 2>&1; then
  echo 'release Docker publication must require a version' >&2
  exit 1
fi

if "$script" workflow_dispatch '' abcdef123456 true >/dev/null 2>&1; then
  echo 'recovery mode must not be accepted for non-release Docker publications' >&2
  exit 1
fi

echo 'Docker promotion tag tests passed'
