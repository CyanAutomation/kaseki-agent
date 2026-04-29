#!/usr/bin/env bash
set -euo pipefail

mode="${1:-run}"

required_bins=(docker)
optional_bins=()
case "$mode" in
  run)
    optional_bins=(wget sshpass git node npm)
    ;;
  doctor)
    optional_bins=(wget sshpass git node npm)
    ;;
  *)
    printf 'Error: unknown preflight mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac

missing_required=()
missing_optional=()

for bin in "${required_bins[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    missing_required+=("$bin")
  fi
done

for bin in "${optional_bins[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    missing_optional+=("$bin")
  fi
done

if [ "${#missing_required[@]}" -gt 0 ]; then
  printf 'Error: missing required host dependencies: %s\n' "$(IFS=', '; echo "${missing_required[*]}")" >&2
  printf 'Install them, then re-run ./run-kaseki.sh.\n' >&2
  exit 1
fi

printf 'Preflight required dependencies: ok (%s)\n' "$(IFS=', '; echo "${required_bins[*]}")"
if [ "${#missing_optional[@]}" -eq 0 ]; then
  printf 'Preflight optional dependencies: ok (%s)\n' "$(IFS=', '; echo "${optional_bins[*]}")"
else
  printf 'Preflight optional dependencies: missing (%s)\n' "$(IFS=', '; echo "${missing_optional[*]}")"
fi
