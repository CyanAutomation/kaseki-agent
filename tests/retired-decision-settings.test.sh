#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER="$ROOT_DIR/scripts/lib/reject-retired-decision-settings.sh"

if bash -c 'source "$1"; reject_retired_decision_settings' _ "$HELPER" >/dev/null 2>&1; then
  :
else
  echo 'Retired decision settings helper rejected an empty environment.' >&2
  exit 1
fi

for setting in \
  KASEKI_JEV_WORKFLOW \
  KASEKI_DECISION_MODEL \
  KASEKI_DECISION_API_KEY_FILE \
  KASEKI_CLASSIFICATION_MODEL \
  KASEKI_JEV_API_KEY_FILE \
  KASEKI_JEV_TASK_TYPE \
  KASEKI_JEV_VALIDATION_FOCUS; do
  if env "$setting=" bash -c 'source "$1"; reject_retired_decision_settings' _ "$HELPER" >/dev/null 2>&1; then
    printf 'Retired setting %s was accepted.\n' "$setting" >&2
    exit 1
  else
    status=$?
    if [ "$status" -ne 2 ]; then
      printf 'Retired setting %s returned unexpected status %s.\n' "$setting" "$status" >&2
      exit 1
    fi
  fi
done

echo '✓ Retired decision settings are rejected consistently'
