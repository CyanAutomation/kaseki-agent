#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

eval "$(awk '
  /^build_github_skip_reasons\(\) \{/ { capture=1; depth=0 }
  capture {
    print
    for (i = 1; i <= length($0); i++) {
      ch = substr($0, i, 1)
      if (ch == "{") depth++
      if (ch == "}") depth--
    }
    if (capture && depth == 0) exit
  }
' "$ROOT_DIR/kaseki-agent.sh")"

SCOUTING_ARTIFACT="$TMP_DIR/scouting.json"
printf '{}\n' > "$SCOUTING_ARTIFACT"
GITHUB_APP_ENABLED=1
PI_EXIT=0
VALIDATION_EXIT=0
QUALITY_EXIT=0
SECRET_SCAN_EXIT=0
GOAL_CHECK_EXIT=0
KASEKI_GOAL_CHECK=1
STATUS=0
DIFF_NONEMPTY=true
GOAL_CHECK_MET=false
GOAL_CHECK_OUTCOME=uncertain
GOAL_CHECK_EVALUATION_WARNING=goal_check_uncertain_review_required

build_github_skip_reasons
if [[ " ${GITHUB_SKIP_REASONS[*]} " == *" goal_check_failed "* ]]; then
  echo "FAIL: uncertain goal check blocked PR publication" >&2
  exit 1
fi

GOAL_CHECK_OUTCOME=unmet
build_github_skip_reasons
[[ " ${GITHUB_SKIP_REASONS[*]} " == *" goal_check_failed "* ]] || {
  echo "FAIL: confirmed unmet goal check did not block PR publication" >&2
  exit 1
}

GOAL_CHECK_OUTCOME=uncertain
GOAL_CHECK_EVALUATION_WARNING=goal_check_deterministic_fallback:jev_classifier_unavailable
build_github_skip_reasons
[[ " ${GITHUB_SKIP_REASONS[*]} " == *" goal_check_failed "* ]] || {
  echo "FAIL: unavailable evaluator fallback was incorrectly treated as reviewable uncertainty" >&2
  exit 1
}

GOAL_CHECK_OUTCOME=uncertain
GOAL_CHECK_EVALUATION_WARNING=goal_check_uncertain_review_required
GOAL_CHECK_EXIT=86
build_github_skip_reasons
[[ " ${GITHUB_SKIP_REASONS[*]} " == *" goal_check_failed "* ]] || {
  echo "FAIL: evaluator failure did not block PR publication" >&2
  exit 1
}

GOAL_CHECK_EXIT=0
VALIDATION_EXIT=1
build_github_skip_reasons
[[ " ${GITHUB_SKIP_REASONS[*]} " == *" validation_failed "* ]] || {
  echo "FAIL: validation failure stopped blocking PR publication" >&2
  exit 1
}

printf 'goal-check-publish-policy.test.sh PASS\n'
