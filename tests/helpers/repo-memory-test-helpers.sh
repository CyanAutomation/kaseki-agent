#!/usr/bin/env bash
# shellcheck disable=SC2034

setup_repo_memory_fixture() {
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  TMP_DIR="$(mktemp -d)"
  export KASEKI_WORKSPACE_DIR="$TMP_DIR/workspace" KASEKI_RESULTS_DIR="$TMP_DIR/results"
  REPO_URL="https://example.com/acme/widgets.git" GIT_REF="main"
  KASEKI_REPO_MEMORY_MODE=summary KASEKI_REPO_MEMORY_TTL_DAYS=30 KASEKI_REPO_MEMORY_MAX_BYTES=4096
  KASEKI_REPO_MEMORY_ROOT="$TMP_DIR/repo-memory" KASEKI_DRY_RUN=0
  REPO_MEMORY_KEY="" REPO_MEMORY_DIR="" REPO_MEMORY_FILE="" REPO_MEMORY_STATUS="disabled"
  STATUS=0 PI_EXIT=0 SECRET_SCAN_EXIT=0 VALIDATION_EXIT=0 QUALITY_EXIT=0 KASEKI_TASK_MODE=patch
  emit_event() { :; }
  emit_error_event() { :; }
  # shellcheck source=../../scripts/lib/repo-memory.sh
  . "$ROOT_DIR/scripts/lib/repo-memory.sh"
  init_repo_memory_paths summary "$KASEKI_REPO_MEMORY_ROOT" "$REPO_URL" "$GIT_REF"
}

build_result_artifacts() {
  mkdir -p "$KASEKI_RESULTS_DIR"
  printf '%s\n' '# Kaseki Result: test' '- Status: passed' '- Secret scan: 0' '- Task Prompt: do not persist this' > "$KASEKI_RESULTS_DIR/result-summary.md"
  printf '%s\n' 'Useful architecture note.' 'OPENROUTER_API_KEY=sk-or-should-not-persist' > "$KASEKI_RESULTS_DIR/analysis.md"
  printf '%s\n' 'src/widget.ts' 'tests/widget.test.ts' > "$KASEKI_RESULTS_DIR/changed-files.txt"
  printf 'npm test\t0\t3\n' > "$KASEKI_RESULTS_DIR/validation-timings.tsv"
}
