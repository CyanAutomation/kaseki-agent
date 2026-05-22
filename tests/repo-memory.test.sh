#!/usr/bin/env bash
# shellcheck disable=SC2034
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load only repository-memory and prompt helpers from kaseki-agent.sh.
eval "$(awk '
  /^compute_repo_memory_key\(\)/ { emit=1 }
  /^run_github_operations\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/kaseki-agent.sh")"

emit_event() { :; }
emit_error_event() { :; }

# All variables below are used by sourced functions or in subshells
REPO_URL="https://example.com/acme/widgets.git"
GIT_REF="main"
TASK_PROMPT="Fix the widget parser."
KASEKI_AGENT_GUARDRAILS=1
KASEKI_REPO_MEMORY_MODE=summary
KASEKI_REPO_MEMORY_TTL_DAYS=30
KASEKI_REPO_MEMORY_MAX_BYTES=4096
KASEKI_REPO_MEMORY_ROOT="$TMP_DIR/repo-memory"
KASEKI_RESULTS_DIR="$TMP_DIR/results"
KASEKI_DRY_RUN=0
REPO_MEMORY_KEY=""
REPO_MEMORY_DIR=""
REPO_MEMORY_FILE=""
REPO_MEMORY_STATUS="disabled"

init_repo_memory_paths
trap 'rm -rf "$TMP_DIR" "$REPO_MEMORY_DIR"' EXIT
rm -rf "$REPO_MEMORY_DIR"
mkdir -p "$REPO_MEMORY_DIR"
cat > "$REPO_MEMORY_FILE" <<'MEMORY'
# Repository Memory Summary

- Repo URL: https://example.com/acme/widgets.git
- Default ref: main
- Commit SHA: abc123
- Updated at: 2026-05-06T00:00:00Z

## Changed files
- src/widget.ts
MEMORY

prompt="$(build_agent_prompt)"
if ! grep -q 'Prior repository context (opt-in cache' <<< "$prompt"; then
  printf 'Expected build_agent_prompt to append labeled repository memory.\n' >&2
  exit 1
fi
if ! grep -q 'Commit SHA: abc123' <<< "$prompt"; then
  printf 'Expected appended memory to include cached metadata.\n' >&2
  exit 1
fi

touch -d '45 days ago' "$REPO_MEMORY_FILE"
expired_prompt="$(build_agent_prompt)"
if grep -q 'Commit SHA: abc123' <<< "$expired_prompt"; then
  printf 'Expected expired repository memory to be omitted.\n' >&2
  exit 1
fi

mkdir -p "$KASEKI_RESULTS_DIR"
cat > "$KASEKI_RESULTS_DIR/result-summary.md" <<'SUMMARY'
# Kaseki Result: test
- Status: passed
- Secret scan: 0
- Task Prompt: do not persist this
SUMMARY
cat > "$KASEKI_RESULTS_DIR/analysis.md" <<'ANALYSIS'
Useful architecture note.
OPENROUTER_API_KEY=sk-or-should-not-persist
ANALYSIS
cat > "$KASEKI_RESULTS_DIR/changed-files.txt" <<'FILES'
src/widget.ts
tests/widget.test.ts
FILES
cat > "$KASEKI_RESULTS_DIR/validation-timings.tsv" <<'TIMINGS'
npm test	0	3
TIMINGS

STATUS=0
PI_EXIT=0
SECRET_SCAN_EXIT=0
KASEKI_TASK_MODE="patch"
START_ISO="2026-05-06T12:00:00Z"
VALIDATION_EXIT=0
QUALITY_EXIT=0
write_repo_memory_summary

if grep -Eiq 'OPENROUTER|sk-or|Task Prompt|do not persist' "$REPO_MEMORY_FILE"; then
  printf 'Expected repository memory writer to filter prompts and secrets.\n' >&2
  exit 1
fi
if ! grep -q 'Useful architecture note' "$REPO_MEMORY_FILE"; then
  printf 'Expected sanitized analysis note to be retained.\n' >&2
  exit 1
fi
if ! grep -q 'npm test: exit 0, 3s' "$REPO_MEMORY_FILE"; then
  printf 'Expected validation outcome to be summarized.\n' >&2
  exit 1
fi
