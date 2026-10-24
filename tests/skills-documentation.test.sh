#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/.agents/skills"

fail() {
  printf 'skills documentation test failed: %s\n' "$1" >&2
  exit 1
}

check_skill_tree_integrity() {
  [ ! -e "$SKILLS_DIR/disaster-recovery" ] || \
    fail "skill-tree integrity: removed disaster-recovery skill directory is still present"

  "$SKILLS_DIR/validate-cross-references.sh" >/dev/null || \
    fail "skill-tree integrity: skill cross-reference and forbidden-string validation failed"
}

check_skill_index_integrity() {
  local actual total internal external skill_name
  actual="$(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -type f -name SKILL.md | wc -l | tr -d '[:space:]')"
  total="$(awk -F'|' '/\*\*Total Skills\*\*/ {gsub(/[[:space:]*]/, "", $3); print $3}' "$SKILLS_DIR/README.md")"
  internal="$(awk -F'|' '/\*\*Internal Skills\*\*/ {gsub(/[[:space:]*]/, "", $3); print $3}' "$SKILLS_DIR/README.md")"
  external="$(awk -F'|' '/\*\*External Skills\*\*/ {gsub(/[[:space:]*]/, "", $3); match($3, /[0-9]+/); print substr($3, RSTART, RLENGTH)}' "$SKILLS_DIR/README.md")"

  [ "$total" = "$actual" ] || fail "skill index: total says $total but found $actual SKILL.md files"
  [ "$total" -eq "$((internal + external))" ] || \
    fail "skill index: internal ($internal) + external ($external) does not equal total ($total)"

  while IFS= read -r skill_file; do
    skill_name="$(basename "$(dirname "$skill_file")")"
    grep -Fq "[$skill_name]($skill_name/SKILL.md)" "$SKILLS_DIR/README.md" || \
      fail "skill index: $skill_name is missing from README.md"
  done < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -type f -name SKILL.md | sort)
}

check_progressive_disclosure() {
  local skill_file skill_name line_count
  while IFS= read -r skill_file; do
    skill_name="$(basename "$(dirname "$skill_file")")"
    [ "$skill_name" = "fallow" ] && continue
    line_count="$(wc -l < "$skill_file" | tr -d '[:space:]')"
    [ "$line_count" -le 180 ] || \
      fail "progressive disclosure: $skill_name SKILL.md is $line_count lines; move detailed reference into docs or linked material"
  done < <(find "$SKILLS_DIR" -mindepth 2 -maxdepth 2 -type f -name SKILL.md | sort)
}

check_repository_instructions_consolidation() {
  [ -f "$ROOT_DIR/AGENTS.md" ] || fail "repository guidance: AGENTS.md is missing"
  [ ! -e "$ROOT_DIR/CLAUDE.md" ] || fail "repository guidance: CLAUDE.md should be consolidated into AGENTS.md"
  grep -q 'AGENTS\.md' "$ROOT_DIR/Dockerfile" || fail "repository guidance: Dockerfile does not include AGENTS.md"
  grep -q '^!AGENTS\.md$' "$ROOT_DIR/.dockerignore" || fail "repository guidance: Docker build context excludes AGENTS.md"

  if grep -q 'CLAUDE\.md' \
    "$ROOT_DIR/Dockerfile" "$ROOT_DIR/.dockerignore" \
    "$ROOT_DIR/scripts/kaseki-maturity-score.sh" \
    "$ROOT_DIR/docs/INDEX.md" "$ROOT_DIR/docs/STYLE.md" \
    "$ROOT_DIR/docs/QUALITY_GATES.md" "$ROOT_DIR/docs/AUTH_SETUP.md" \
    "$ROOT_DIR/docs/internal/MARKDOWN_INVENTORY.md"; then
    fail "repository guidance: active references still use CLAUDE.md"
  fi
}

check_skill_examples_match_current_project() {
  local cache_skill="$SKILLS_DIR/dependency-cache-optimization/SKILL.md"
  local test_skill="$SKILLS_DIR/test-automation/SKILL.md"
  local performance_skill="$SKILLS_DIR/performance-tuning/SKILL.md"
  local environment_skill="$SKILLS_DIR/environment-configuration/SKILL.md"
  local frontend_skill="$SKILLS_DIR/frontend-design/SKILL.md"

  if grep -q -E 'kaseki-cli(\.js)?|docker system prune --all' "$cache_skill"; then
    fail "dependency-cache skill: contains obsolete CLI or broad image-prune command"
  fi
  if grep -q -E 'node-version:.*22|actions/(checkout|setup-node)@v3' "$test_skill"; then
    fail "test-automation skill: CI example does not match the current Node 24 workflow"
  fi
  grep -q 'Node.js 24 or later' "$test_skill" || \
    fail "test-automation skill: missing the current Node.js requirement"
  if grep -q -E 'openrouter/free|\$0\.00 per run|Longer timeout = faster' "$performance_skill"; then
    fail "performance skill: contains unsupported model, pricing, or timeout claims"
  fi
  if grep -q 'OPENROUTER_API_KEY=sk-or-' "$environment_skill"; then
    fail "environment skill: presents an inline OpenRouter key as setup guidance"
  fi
  if grep -q -E '`(references|assets|scripts)/' "$frontend_skill"; then
    fail "frontend-design skill: refers to bundled files that are not present"
  fi
}

check_documentation_security_requirements() {
  grep -q -E '^activation: explicit$' "$SKILLS_DIR/frontend-design/SKILL.md" || \
    fail "documentation security: external frontend skill is not marked opt-in"

  local ci_skill="$SKILLS_DIR/ci-cd-integration/SKILL.md"
  grep -q -E 'author_association' "$ci_skill" || \
    fail "documentation security: CI example lacks trusted-actor guidance"
  grep -q -E '^permissions:' "$ci_skill" || \
    fail "documentation security: CI example lacks explicit permissions"
  grep -q -E 'actions/checkout@[0-9a-f]{40}' "$ci_skill" || \
    fail "documentation security: CI example does not pin checkout to a full commit SHA"
}

check_generated_environment_document_parity() {
  npm --prefix "$ROOT_DIR" run check:environment-docs >/dev/null || \
    fail "generated environment-document parity: generated environment docs are stale"
}

check_cli_default_parity() {
  local help_output
  if ! help_output="$("$ROOT_DIR/run-kaseki.sh" --help)"; then
    fail "CLI default parity: run-kaseki.sh --help failed"
  fi

  printf '%s\n' "$help_output" | grep -q -E 'KASEKI_AGENT_TIMEOUT_SECONDS.*10800' || \
    fail "CLI default parity: runner help does not show timeout default 10800"
  printf '%s\n' "$help_output" | grep -q -E 'KASEKI_MAX_DIFF_BYTES.*400000' || \
    fail "CLI default parity: runner help does not show diff default 400000"
}

check_skill_tree_integrity
check_skill_index_integrity
check_progressive_disclosure
check_repository_instructions_consolidation
check_skill_examples_match_current_project
check_documentation_security_requirements
check_generated_environment_document_parity
check_cli_default_parity

printf 'skills documentation tests passed\n'
