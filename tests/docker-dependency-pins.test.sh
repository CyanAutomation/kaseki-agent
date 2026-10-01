#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dockerfile="$repo_root/Dockerfile"

assert_exact_line() {
  local expected="$1"
  if ! grep -Fqx "$expected" "$dockerfile"; then
    printf 'Dockerfile dependency contract missing exact line: %s\n' "$expected" >&2
    exit 1
  fi
}

# These versions were reviewed together. Keep each selector exact so a rebuild
# cannot silently introduce a different dependency tree.
assert_exact_line 'ARG NPM_VERSION=11.19.1'
assert_exact_line 'RUN npm install -g --no-audit @earendil-works/pi-coding-agent@0.84.5 undici@8.10.2'

if grep -Eq 'npm install -g[^#]*@earendil-works/pi-coding-agent@0\.84\.4([[:space:]]|$)' "$dockerfile"; then
  echo 'Dockerfile must not install Pi 0.84.4, which nests undici 7.29.0.' >&2
  exit 1
fi

if grep -Eq 'npm install -g[^#]*[[:space:]]undici([[:space:]\\]|$)' "$dockerfile"; then
  echo 'Dockerfile must not install an unversioned top-level undici.' >&2
  exit 1
fi

printf 'Docker dependency pins are exact and match the reviewed versions.\n'
