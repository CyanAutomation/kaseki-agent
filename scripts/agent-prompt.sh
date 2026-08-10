#!/usr/bin/env bash
# Shared prompt rendering helpers for kaseki-agent.sh and tests.

build_completion_checklist() {
  local goal_artifact="${GOAL_SETTING_ARTIFACT:-${KASEKI_RESULTS_DIR}/goal-setting.json}"
  local critical_artifact="${KASEKI_RESULTS_DIR}/critical-change-expectations.json"

  TASK_PROMPT_VALUE="$TASK_PROMPT" \
  ALLOWLIST_VALUE="${KASEKI_CHANGED_FILES_ALLOWLIST:-}" \
  node - "$goal_artifact" "$SCOUTING_ARTIFACT" "$critical_artifact" <<'NODE'
const fs = require('fs');
const sources = [
  ['task', process.env.TASK_PROMPT_VALUE || ''],
  ['goal-setting', process.argv[2]],
  ['scouting', process.argv[3]],
  ['critical-change-expectations', process.argv[4]],
  ['allowlist', process.env.ALLOWLIST_VALUE || ''],
];
const usefulKey = /(objective|requirement|success|acceptance|critical|expectation|required|must|test|check|allowlist|file)/i;
const candidates = [];
function collect(value, source, key = '') {
  if (typeof value === 'string' && value.trim() && (source === 'task' || source === 'allowlist' || usefulKey.test(key))) {
    candidates.push({ source, requirement: value.replace(/\s+/g, ' ').trim().slice(0, 240) });
  } else if (Array.isArray(value) && usefulKey.test(key)) {
    value.forEach(item => collect(item, source, key));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => collect(child, source, childKey));
  }
}
for (const [source, input] of sources) {
  if (!input) continue;
  if (source === 'task') {
    input.split(/\n+|;\s+/).map(line => line.replace(/^\s*[-*\d.)]+\s*/, '')).filter(Boolean)
      .forEach(line => collect(line, source));
  }
  else if (source === 'allowlist') collect(`Only change allowlisted paths: ${input}`, source);
  else if (fs.existsSync(input)) {
    try { collect(JSON.parse(fs.readFileSync(input, 'utf8')), source); } catch { /* malformed artifacts are handled elsewhere */ }
  }
}
const seen = new Set();
const items = [];
for (const candidate of candidates) {
  const normalized = candidate.requirement.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const overlaps = [...seen].some(previous => previous === normalized || (
    Math.min(previous.length, normalized.length) >= 20 &&
    (previous.includes(normalized) || normalized.includes(previous))
  ));
  if (!normalized || overlaps) continue;
  seen.add(normalized);
  items.push({ id: `C${items.length + 1}`, ...candidate });
  if (items.length === 12) break;
}
process.stdout.write(JSON.stringify({ version: 1, items }));
NODE
}

build_agent_prompt() {
  local memory_section scouting_section retry_section hashline_edits_section summarization_section allowlist_section handoff_section caveman_instruction completion_checklist completion_contract
  
  # Get caveman instruction if enabled
  caveman_instruction="$(get_caveman_instruction)"
  
  memory_section="$(read_repo_memory_section)"
  scouting_section=""
  retry_section=""
  hashline_edits_section=""
  summarization_section=""
  allowlist_section=""
  handoff_section=""
  completion_checklist="$(build_completion_checklist)"
  completion_contract="Completion contract (apply before any other instructions):
1. Identify the minimum required change; inspect only enough evidence to locate it.
2. Implement it, then run only the focused checks assigned to the coding phase.
3. Stop immediately when the required diff and checks satisfy the checklist.
4. Do not restate established conclusions or explore optional improvements.

Completion checklist (machine-readable; deduplicated):
$completion_checklist

Completion marker: when every item is satisfied, output one line as KASEKI_COMPLETE={\"C1\":\"<diff/check evidence>\"}. Include every checklist id with terse evidence. After this marker, the controller rejects exploratory read/search commands; provide only the final terse summary."
  if [ -s "${KASEKI_RESULTS_DIR}/context-handoff.json" ]; then
    handoff_section="
Context checkpoint:
- A previous phase produced a compact handoff at ${KASEKI_RESULTS_DIR}/context-handoff.json.
- Read it first. Treat it as the compact replacement for prior conversation history; inspect raw artifacts only when its evidence is insufficient."
  fi
  if [ -n "${KASEKI_CHANGED_FILES_ALLOWLIST:-}" ]; then
    allowlist_section="
Write allowlist: ${KASEKI_CHANGED_FILES_ALLOWLIST}
- Change only matching repo-relative paths. Before creating a file, verify it matches.
- Need another path? Do not create it; explain why it is required in the final terse summary."
  fi
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
- Prefer hashline_edit for precise anchored edits; rely on its tool schema for syntax and use a normal write only if an anchor fails."
    if [ "${KASEKI_HASHLINE_DEBUG:-0}" = "1" ] || grep -Eq '"(failed|failure_count)"[[:space:]]*:[[:space:]]*[1-9]' "${KASEKI_RESULTS_DIR}/hashline-summary.json" 2>/dev/null; then
      hashline_edits_section="$hashline_edits_section
- Debugging: start_hash and end_hash are the first 8 SHA-256 characters of the boundary lines; context_lines disambiguates matches, replacement is the complete new content, and edits run sequentially."
    fi
  fi
  
  printf '%s\n\n' "$completion_contract"

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
    printf '%s' "$allowlist_section"
    printf '%s' "$handoff_section"
    return 0
  fi

  # Use compressed guardrails if caveman level >= 2
  local compressed_guardrails=""
  if [ "${KASEKI_CAVEMAN_LEVEL:-1}" -ge 2 ]; then
    compressed_guardrails="$(get_caveman_compressed_prompt guardrails 2>/dev/null || true)"
  fi

  if [ -n "$compressed_guardrails" ]; then
    # Compressed version (caveman level 2+)
    cat <<EOF
$compressed_guardrails

Task:
$TASK_PROMPT
$memory_section
$scouting_section
$retry_section
$hashline_edits_section
$summarization_section
$allowlist_section
$handoff_section
EOF
  else
    # Verbose version (caveman level 0-1)
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
- Keep tool calls small and atomic. Prefer several focused edits over one large edit, and ensure every tool argument is complete, valid JSON before invoking it.
- Avoid repeatedly reading or returning unchanged large files. Reuse prior findings and summarize long tool output to limit context growth.
- Do not print, inspect, or expose environment variables, secrets, credentials, API keys, or mounted secret files.

Task:
$TASK_PROMPT
$memory_section
$scouting_section
$retry_section
$hashline_edits_section
$summarization_section
$allowlist_section
$handoff_section
EOF
  fi
}
