#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

KASEKI_ROOT="$TMP_DIR/kaseki"
REPO_URL='https://example.com/repo"quoted"'
GIT_REF='feature/"quoted"/branch'
OPENROUTER_API_KEY_FILE="$TMP_DIR/missing-secret"

set +e
env \
  PATH="/usr/bin:/bin" \
  KASEKI_ROOT="$KASEKI_ROOT" \
  REPO_URL="$REPO_URL" \
  GIT_REF="$GIT_REF" \
  OPENROUTER_API_KEY_FILE="$OPENROUTER_API_KEY_FILE" \
  "$ROOT_DIR/run-kaseki.sh" >/dev/null 2>&1
status=$?
set -e

if [ "$status" -ne 2 ]; then
  echo "Expected run-kaseki.sh to exit 2 when API key is missing, got: $status" >&2
  exit 1
fi

result_dir="$(find "$KASEKI_ROOT/kaseki-results" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [ -z "${result_dir:-}" ]; then
  echo "No result directory was created under $KASEKI_ROOT/kaseki-results" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const hostStart = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expectedRepo = process.argv[3];
const expectedRef = process.argv[4];
if (hostStart.repo_url !== expectedRepo) throw new Error("host-start repo_url mismatch");
if (hostStart.git_ref !== expectedRef) throw new Error("host-start git_ref mismatch");
if (metadata.repo_url !== expectedRepo) throw new Error("metadata repo_url mismatch");
if (metadata.git_ref !== expectedRef) throw new Error("metadata git_ref mismatch");
' \
  "$result_dir/host-start.json" \
  "$result_dir/metadata.json" \
  "$REPO_URL" \
  "$GIT_REF"

for artifact in changed-files.txt validation-timings.tsv quality.log secret-scan.log git-push.log progress.log progress.jsonl cleanup.log; do
  if [ ! -f "$result_dir/$artifact" ]; then
    echo "Expected artifact missing: $artifact" >&2
    exit 1
  fi
done

if grep -q "node: command not found" "$result_dir/stderr.log"; then
  echo "run-kaseki.sh should not require node on the host" >&2
  exit 1
fi
