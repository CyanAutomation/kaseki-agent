#!/usr/bin/env bash
set -euo pipefail

# Fallow's audit defaults to the upstream merge base, but local clones may not
# have an upstream configured. Resolve an explicit, reproducible base instead.
if [[ -n "${FALLOW_AUDIT_BASE:-}" ]]; then
  base="$FALLOW_AUDIT_BASE"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  base=origin/main
elif git rev-parse --verify main >/dev/null 2>&1; then
  base=main
else
  base=HEAD~1
fi

coverage_args=()
if [[ -f coverage/coverage-final.json ]]; then
  coverage_args+=(--coverage coverage/coverage-final.json)
fi

if [[ "${CI:-}" == "true" ]]; then
  exec npx -y fallow audit \
    --base "$base" \
    --gate new-only \
    --production-health \
    --max-crap 30 \
    --fail-on-issues \
    --format human \
    --explain \
    "${coverage_args[@]}"
fi

# Local clones may not permit Fallow's temporary comparison worktree. Keep
# local use useful and advisory while CI performs the blocking new-only audit.
exec npx -y fallow health \
  --changed-since "$base" \
  --production \
  --max-crap 30 \
  --min-severity critical \
  --report-only \
  --format human \
  --explain \
  "${coverage_args[@]}"
