#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/.agents/skills"

fail() {
  printf 'skills documentation test failed: %s\n' "$1" >&2
  exit 1
}

[ ! -e "$SKILLS_DIR/disaster-recovery" ] || fail "disaster-recovery skill is still present"

# Keep this test runnable in the minimal CI images, which provide POSIX grep
# but do not guarantee ripgrep is installed.
if grep -R -n -E 'disaster-recovery|DISASTER_RECOVERY' "$SKILLS_DIR" >/dev/null; then
  fail "removed disaster-recovery skill is still referenced"
fi

"$SKILLS_DIR/validate-cross-references.sh" >/dev/null || fail "skill cross-reference validation failed"

if grep -n -E 'vitest|Vitest' "$SKILLS_DIR/test-automation/SKILL.md" >/dev/null; then
  fail "test-automation still documents Vitest"
fi

if grep -R -n -E 'echo \$OPENROUTER_API_KEY|echo "\$OPENROUTER_API_KEY"' "$SKILLS_DIR" >/dev/null; then
  fail "a skill prints the API key"
fi

grep -q -E '^activation: explicit$' "$SKILLS_DIR/frontend-design/SKILL.md" || \
  fail "external frontend skill is not marked opt-in"

ci_skill="$SKILLS_DIR/ci-cd-integration/SKILL.md"
grep -q -E 'author_association' "$ci_skill" || fail "CI example lacks trusted-actor guidance"
grep -q -E '^permissions:' "$ci_skill" || fail "CI example lacks explicit permissions"
grep -q -E 'actions/checkout@[0-9a-f]{40}' "$ci_skill" || fail "CI example does not pin checkout"

if grep -n -E 'KASEKI_MAX_DIFF_BYTES=400000.*200 KB|default 1200s|default 200000' \
  "$SKILLS_DIR"/quality-gate-config/SKILL.md \
  "$SKILLS_DIR"/environment-configuration/SKILL.md \
  "$SKILLS_DIR"/workflow-diagnosis/SKILL.md >/dev/null; then
  fail "skills contain stale runtime defaults"
fi

npm --prefix "$ROOT_DIR" run check:environment-docs >/dev/null || fail "generated environment docs are stale"

help_output="$("$ROOT_DIR/run-kaseki.sh" --help)"
printf '%s\n' "$help_output" | grep -q -E 'KASEKI_AGENT_TIMEOUT_SECONDS.*10800' || fail "runner help has stale timeout default"
printf '%s\n' "$help_output" | grep -q -E 'KASEKI_MAX_DIFF_BYTES.*400000' || fail "runner help has stale diff default"

printf 'skills documentation tests passed\n'
