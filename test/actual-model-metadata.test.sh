#!/usr/bin/env bash
set -euo pipefail

TEST_NAME="actual-model-metadata.test"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$REPO_ROOT/scripts/resolve-actual-model.js"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

if node "$HELPER" >"$TMP_ROOT/actual-model-missing-args.out" 2>"$TMP_ROOT/actual-model-missing-args.err"; then
  echo "[$TEST_NAME/missing-args] expected helper to fail without arguments" >&2
  exit 1
fi
grep -q 'Usage: resolve-actual-model.js <summaryPath> <eventsPath>' "$TMP_ROOT/actual-model-missing-args.err"

echo "[$TEST_NAME] PASS"
