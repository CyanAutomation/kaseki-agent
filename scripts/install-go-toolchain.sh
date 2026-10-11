#!/usr/bin/env bash
set -euo pipefail

readonly GO_VERSION='1.27.2'

# Keep the version safe to interpolate into URLs, paths, and expected command
# output if its source becomes configurable in the future.
if [[ ! "$GO_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'Invalid Go version: %s (expected X.Y or X.Y.Z)\n' "$GO_VERSION" >&2
  exit 2
fi

go_archive_checksum() {
  case "$1" in
    amd64) printf '%s' 'ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5' ;;
    arm64) printf '%s' '94f3e30b8e374bc285e7dadc11e0865726b9bc6e85b841ccceaabc0214c6b7c8' ;;
    *)
      printf 'Unsupported target architecture: %s\n' "$1" >&2
      return 2
      ;;
  esac
}

action="${1:-install}"
target_arch="${2:-${TARGETARCH:-}}"

case "$action" in
  checksum)
    go_archive_checksum "$target_arch"
    ;;
  install)
    checksum="$(go_archive_checksum "$target_arch")"
    archive="go${GO_VERSION}.linux-${target_arch}.tar.gz"
    work_dir="$(mktemp -d)"
    trap 'rm -rf "$work_dir"' EXIT
    curl --fail --location --retry 3 --silent --show-error \
      "https://go.dev/dl/${archive}" -o "$work_dir/$archive"
    printf '%s  %s\n' "$checksum" "$work_dir/$archive" | sha256sum --check --status
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "$work_dir/$archive"
    version_output="$(/usr/local/go/bin/go version)"
    case "$version_output" in
      "go version go${GO_VERSION} linux/${target_arch}") ;;
      *)
        printf 'Unexpected Go version: %s\n' "$version_output" >&2
        exit 1
        ;;
    esac
    printf '%s\n' "$version_output"
    ;;
  *)
    printf 'Usage: %s [install|checksum] [amd64|arm64]\n' "$0" >&2
    exit 2
    ;;
esac
