#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/npm" <<'NPM_STUB'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != view ]]; then
  echo "unexpected npm command: $*" >&2
  exit 2
fi

if [[ "${3:-}" == versions && "${4:-}" == --json ]]; then
  if [[ "${FAKE_NPM_VERSIONS_ERROR:-false}" == true ]]; then
    printf '{"error":{"code":"%s"}}\n' "${FAKE_NPM_ERROR_CODE:-E404}"
    exit 1
  fi
  printf '%s\n' "${FAKE_NPM_VERSIONS:-[]}"
  exit 0
fi

if [[ "${3:-}" == dist.integrity && "${4:-}" == --json ]]; then
  printf '"%s"\n' "${FAKE_NPM_INTEGRITY:-}"
  exit 0
fi

echo "unexpected npm view request: $*" >&2
exit 2
NPM_STUB
chmod +x "$tmp_dir/bin/npm"

tarball="$tmp_dir/package.tgz"
printf 'verified release package bytes\n' > "$tarball"
local_integrity="$(node - "$tarball" <<'NODE'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const bytes = fs.readFileSync(process.argv[2]);
process.stdout.write(`sha512-${createHash('sha512').update(bytes).digest('base64')}`);
NODE
)"

check_state() {
  PATH="$tmp_dir/bin:$PATH" \
    FAKE_NPM_VERSIONS="${FAKE_NPM_VERSIONS:-[]}" \
    FAKE_NPM_INTEGRITY="${FAKE_NPM_INTEGRITY:-}" \
    FAKE_NPM_VERSIONS_ERROR="${FAKE_NPM_VERSIONS_ERROR:-false}" \
    FAKE_NPM_ERROR_CODE="${FAKE_NPM_ERROR_CODE:-E404}" \
    "$ROOT_DIR/scripts/check-npm-publication-state.sh" \
      @example/package 1.2.3 "$tarball" "${1:-false}"
}

unpublished_output="$(FAKE_NPM_VERSIONS='[]' check_state false)"
[[ "$unpublished_output" == *'publish=true'* ]] || {
  echo 'an unpublished release version must be eligible for npm publication' >&2
  exit 1
}

existing_output="$(FAKE_NPM_VERSIONS='["1.2.3"]' FAKE_NPM_INTEGRITY="$local_integrity" check_state true)"
[[ "$existing_output" == *'publish=false'* ]] || {
  echo 'a matching already-published tarball must be treated as recovered' >&2
  exit 1
}

if FAKE_NPM_VERSIONS='["1.2.3"]' FAKE_NPM_INTEGRITY="$local_integrity" check_state false >/dev/null 2>&1; then
  echo 'normal release publication must reject an existing version' >&2
  exit 1
fi

if FAKE_NPM_VERSIONS='["1.2.3"]' FAKE_NPM_INTEGRITY='sha512-different' check_state true >/dev/null 2>&1; then
  echo 'recovery must reject an existing package with a different integrity' >&2
  exit 1
fi

if FAKE_NPM_VERSIONS_ERROR=true FAKE_NPM_ERROR_CODE=E503 check_state true >/dev/null 2>&1; then
  echo 'recovery must reject registry errors instead of assuming an unpublished version' >&2
  exit 1
fi

echo 'npm publication state tests passed'
