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
  help_output="$("$ROOT_DIR/run-kaseki.sh" --help)" || \
    fail "CLI default parity: run-kaseki.sh --help failed"

  printf '%s\n' "$help_output" | grep -q -E 'KASEKI_AGENT_TIMEOUT_SECONDS.*10800' || \
    fail "CLI default parity: runner help does not show timeout default 10800"
  printf '%s\n' "$help_output" | grep -q -E 'KASEKI_MAX_DIFF_BYTES.*400000' || \
    fail "CLI default parity: runner help does not show diff default 400000"
}

check_skill_tree_integrity
check_documentation_security_requirements
check_generated_environment_document_parity
check_cli_default_parity

printf 'skills documentation tests passed\n'
