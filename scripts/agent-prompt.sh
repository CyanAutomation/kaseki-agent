#!/usr/bin/env bash
# Shared prompt rendering helpers for kaseki-agent.sh and tests.

build_agent_prompt() {
  local memory_section scouting_section retry_section hashline_edits_section summarization_section caveman_instruction
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  memory_section="$(read_repo_memory_section)"
  scouting_section=""
  retry_section=""
  hashline_edits_section=""
  summarization_section=""
  if [ -s "$SCOUTING_ARTIFACT" ]; then
    scouting_section="
Scouting artifact:
- A preceding read-only Pi scouting run researched this task and wrote its JSON findings to $SCOUTING_ARTIFACT.
- Read that artifact before coding. Treat it as planning input, then verify important details against the current repository.
- The scouting artifact may include 'test_examples' with before/after code snippets. Use these as patterns when updating related tests.
- If you change parser logic, output format, naming conventions, serializers, or progress/event fields, read the scouting test_impact files and update the related tests and expectation strings so parser/output/naming behavior changes remain covered.
- When test_impact includes test_examples, follow those patterns to guide your assertion updates."
  fi
  # Read summarization annotation if available
  if [ -f "${KASEKI_RESULTS_DIR}"/summarization-annotation.txt ]; then
    summarization_section="
Summarization Analysis:
$(cat "${KASEKI_RESULTS_DIR}"/summarization-annotation.txt)"
  fi
  if [ -n "$GOAL_CHECK_RETRY_PROMPT" ]; then
    retry_section="
Goal-check retry guidance:
- A post-validation goal-check Pi evaluator found the previous coding attempt did not fully realize the scouting objective.
- Implement the missing core code change before adding or adjusting tests, refactoring, cleanup, or other secondary work.
- Address this feedback while preserving valid existing work:
$GOAL_CHECK_RETRY_PROMPT"
  fi
  if [ "$KASEKI_HASHLINE_EDITS" != "0" ]; then
    hashline_edits_section="
File editing with content-based anchors (hashline_edit):
- Use the hashline_edit tool to make precise file edits using content-based anchors instead of line numbers.
- This tool reduces retry friction when files change between coding attempts.

Hashline_edit syntax:
  file_path: Relative path to the file (e.g., 'src/parser.ts')
  anchor:
    start_hash: First 8 characters of SHA-256 hash of the first line to replace
    end_hash: First 8 characters of SHA-256 hash of the last line to replace
    context_lines: Number of surrounding lines to include for disambiguation (default: 3)
  replacement: New content (can span multiple lines)

Example: Replace lines 15-17 in src/parser.ts
  {
    \"file_path\": \"src/parser.ts\",
    \"anchor\": {
      \"start_hash\": \"7d8a4b32\",  // SHA-256 hash of line 15
      \"end_hash\": \"9c3e1f7a\",    // SHA-256 hash of line 17
      \"context_lines\": 3
    },
    \"replacement\": \"  // Updated implementation\\n  return result;\"
  }

When to use hashline_edit:
- Prefer hashline_edit for precise edits to specific code sections
- Use it to avoid stale line-number references between retries
- Multiple edits are processed sequentially; anchor failures don't block subsequent edits

Fallback behavior:
- If hashline_edit is not available or anchor matches are stale, edit operations are rejected (non-fatal)
- You can always use bash commands (write, sed, etc.) as a fallback
- The system prefers hashline_edit but gracefully degrades to bash-based editing"
  fi
  
  # Prepend caveman instruction if enabled
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi
  
  if [ "$KASEKI_AGENT_GUARDRAILS" != "1" ]; then
    printf '%s' "$TASK_PROMPT"
    printf '%s' "$memory_section"
    printf '%s' "$scouting_section"
    printf '%s' "$retry_section"
    printf '%s' "$hashline_edits_section"
    printf '%s' "$summarization_section"
    return 0
  fi

  # Print caveman instruction before guardrails prompt (if enabled)
  if [ -n "$caveman_instruction" ]; then
    printf '%s\n\n' "$caveman_instruction"
  fi

  cat <<EOF
You are editing inside a Kaseki-managed ephemeral workspace.

Operational guardrails:
- Do not run git add, git commit, git push, gh, hub, or create pull requests. Kaseki owns commit, push, and PR creation after validation passes.
- Do not run npm install, npm ci, yarn install, pnpm install, or package-manager commands that modify lockfiles. Kaseki owns dependency setup and validation.
- Critical change first: identify the primary required code change from the task prompt, scouting artifact, and goal-setting artifact before editing.
- Apply that primary required code change before adding tests, refactoring, cleanup, formatting-only edits, or other secondary work.
- Do not report success or finish until the required repository diff is present and contains the primary code change, not just tests or scaffolding.
- Keep edits limited to the requested source and test files. If a tool or command changes unrelated files, restore those unrelated files before finishing.
- Before finishing, fix minor formatting issues in files you edited, such as trailing whitespace and obvious lint/format inconsistencies, without broad unrelated rewrites.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.

Task:
$TASK_PROMPT
$memory_section
$scouting_section
$retry_section
$hashline_edits_section
$summarization_section
EOF
}
