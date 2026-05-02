#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "Expected file missing: $file" >&2
    exit 1
  fi
}

require_artifacts() {
  local result_dir="$1"
  shift
  for artifact in "$@"; do
    require_file "$result_dir/$artifact"
  done
}

KASEKI_ROOT="$TMP_DIR/kaseki"
REPO_URL='https://example.com/repo"quoted"'
GIT_REF='feature/"quoted"/branch'
OPENROUTER_API_KEY_FILE="$TMP_DIR/missing-secret"
DOCKER_BIN="$(command -v docker || true)"
if [ -z "$DOCKER_BIN" ]; then
  echo "Skipping run-kaseki-json.test.sh because docker is not available" >&2
  exit 0
fi
TEST_PATH="$(dirname "$DOCKER_BIN"):/usr/bin:/bin"

set +e
env \
  PATH="$TEST_PATH" \
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

if [ ! -d "$KASEKI_ROOT/kaseki-results/kaseki-1" ]; then
  echo "Expected first auto run to create $KASEKI_ROOT/kaseki-results/kaseki-1" >&2
  exit 1
fi
result_dir="$KASEKI_ROOT/kaseki-results/kaseki-1"

require_artifacts "$result_dir" host-start.json metadata.json

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

require_artifacts "$result_dir" changed-files.txt validation-timings.tsv stage-timings.tsv dependency-cache.log quality.log secret-scan.log git-push.log progress.log progress.jsonl cleanup.log

if ! grep -q "missing OPENROUTER_API_KEY" "$result_dir/stage-timings.tsv"; then
  echo "Expected missing-key failure to be recorded in stage-timings.tsv" >&2
  exit 1
fi

set +e
env \
  PATH="$TEST_PATH" \
  KASEKI_ROOT="$KASEKI_ROOT" \
  REPO_URL="$REPO_URL" \
  GIT_REF="$GIT_REF" \
  OPENROUTER_API_KEY_FILE="$OPENROUTER_API_KEY_FILE" \
  "$ROOT_DIR/run-kaseki.sh" >/tmp/kaseki-json-rerun.out 2>/tmp/kaseki-json-rerun.err
rerun_status=$?
set -e

if [ "$rerun_status" -ne 2 ]; then
  echo "Expected second auto run to skip existing result and fail with missing key at kaseki-2, got: $rerun_status" >&2
  exit 1
fi

if [ ! -d "$KASEKI_ROOT/kaseki-results/kaseki-2" ]; then
  echo "Expected second auto run to create kaseki-2 instead of overwriting kaseki-1" >&2
  exit 1
fi

if grep -q "node: command not found" "$result_dir/stderr.log"; then
  echo "run-kaseki.sh should not require node on the host" >&2
  exit 1
fi
