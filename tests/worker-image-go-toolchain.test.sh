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
[ "$("$INSTALLER" checksum amd64)" = '63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445' ] \
  || fail 'Go amd64 archive checksum changed'
[ "$("$INSTALLER" checksum arm64)" = '3450b45a3f9ee8568792736a5c5e70a1f2e9b36c35a8f74958c03e51d7d92bec' ] \
  || fail 'Go arm64 archive checksum changed'

final_stage="$(awk '/^FROM base AS final$/{copy=1} copy{print}' "$DOCKERFILE")"
grep -Fq 'build-essential' <<< "$final_stage" || fail 'final worker image has no compiler for cgo validation'
grep -Fq 'install-go-toolchain install "$TARGETARCH"' <<< "$final_stage" || fail 'final worker image does not install Go for the target architecture'
grep -Fq "/usr/local/go/bin/go version | grep -F 'go1.27.1'" <<< "$final_stage" || fail 'final worker image does not verify the installed Go version'

printf '✓ final worker image contains the pinned Go toolchain for amd64 and arm64\n'
