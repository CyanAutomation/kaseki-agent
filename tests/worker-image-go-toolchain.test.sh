#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="$ROOT_DIR/scripts/install-go-toolchain.sh"
DOCKERFILE="$ROOT_DIR/Dockerfile"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[ -x "$INSTALLER" ] || fail 'pinned Go installer is missing or not executable'
grep -Fq 'if [[ ! "$GO_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then' "$INSTALLER" \
  || fail 'Go version is not validated before use'
[ "$("$INSTALLER" checksum amd64)" = 'ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5' ] \
  || fail 'Go amd64 archive checksum changed'
[ "$("$INSTALLER" checksum arm64)" = '94f3e30b8e374bc285e7dadc11e0865726b9bc6e85b841ccceaabc0214c6b7c8' ] \
  || fail 'Go arm64 archive checksum changed'

final_stage="$(awk '/^FROM base AS final$/{copy=1} copy{print}' "$DOCKERFILE")"
grep -Fq 'build-essential' <<< "$final_stage" || fail 'final worker image has no compiler for cgo validation'
grep -Fq 'install-go-toolchain install "$TARGETARCH"' <<< "$final_stage" || fail 'final worker image does not install Go for the target architecture'
grep -Fq "/usr/local/go/bin/go version | grep -F 'go1.27.2'" <<< "$final_stage" || fail 'final worker image does not verify the installed Go version'

printf '✓ final worker image contains the pinned Go toolchain for amd64 and arm64\n'
