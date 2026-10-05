#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
awk '
  /^RUN / { has_cache = 0 }
  /--mount=type=cache,target=\/root\/\.npm/ { has_cache = 1 }
  /npm ci/ {
    if (!has_cache) {
      print "npm ci layer is missing the BuildKit npm cache mount: " $0 > "/dev/stderr"
      exit 1
    }
    count++
  }
  END {
    if (count != 3) {
      print "expected 3 cached npm ci layers, found " count > "/dev/stderr"
      exit 1
    }
  }
' "$ROOT_DIR/Dockerfile"

echo 'Dockerfile npm cache contract passed'
