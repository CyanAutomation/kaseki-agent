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

# These selectors were reviewed together. This test owns the reproducibility
# contract; scripts/verify-docker-npm-pin.mjs separately proves they exist and
# support the image's Node version against registry metadata.
assert_exact_line 'ARG NPM_VERSION=11.19.1'
assert_exact_line 'RUN npm install -g --no-audit @earendil-works/pi-coding-agent@0.85.0 @earendil-works/pi-server@0.85.0 undici@8.10.2'

if grep -Eq 'npm install -g[^#]*@earendil-works/pi-coding-agent@0\.84\.(4|5)([[:space:]]|$)' "$dockerfile"; then
  echo 'Dockerfile must not install Pi 0.84.4 (vulnerable tree) or unpublished Pi 0.84.5.' >&2
  exit 1
fi

if grep -Eq 'npm install -g[^#]*[[:space:]]undici([[:space:]\\]|$)' "$dockerfile"; then
  echo 'Dockerfile must not install an unversioned top-level undici.' >&2
  exit 1
fi

if grep -Eq 'npm install -g[^#]*[[:space:]]@earendil-works/pi-server([[:space:]\\]|$)' "$dockerfile"; then
  echo 'Dockerfile must not install an unversioned @earendil-works/pi-server.' >&2
  exit 1
fi

printf 'Docker dependency selectors are exact and match the reviewed versions.\n'
