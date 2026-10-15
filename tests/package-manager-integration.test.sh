#!/usr/bin/env bash
# Exercise the worker's real clone/install/cache/validation path without an LLM.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/test/helpers/validation-contract-helpers.sh"
. "$ROOT_DIR/scripts/npm-install-helpers.sh"
command -v bun >/dev/null || { printf 'Bun is required for this integration test.\n' >&2; exit 127; }
eval "$(awk '/^choose_baseline_log_dir\(\)/ { emit=1 } /^run_baseline_validation\(\)/ { if (emit) exit } emit { print }' "$ROOT_DIR/kaseki-agent.sh")"
emit_progress() { :; }
emit_error_event() { :; }

managers=(npm bun)
if [ "$#" -gt 0 ]; then managers=("$@"); fi
for manager in "${managers[@]}"; do
  context=""
  new_test_context context
  repo="$context/source"
  create_controlled_repo "$repo"
  cp "$ROOT_DIR/tests/fixtures/package-managers/$manager/"* "$repo/"
  if [ "$manager" = bun ]; then rm "$repo/package-lock.json"; fi
  git -C "$repo" add -A
  git -C "$repo" -c user.email=kaseki-test@example.invalid -c user.name=Test commit -qm "$manager fixture"
  lockfile=package-lock.json
  if [ "$manager" = bun ]; then lockfile=bun.lock; fi
  before="$(sha256sum "$repo/$lockfile" | cut -d ' ' -f 1)"

  for attempt in fresh restored repaired; do
    if [ "$attempt" = repaired ]; then
      find "$context/dependency-cache" -type d -name is-number -prune -exec rm -rf '{}' +
    fi
    run_kaseki_agent_for_validation "$context" "$repo" auto "$context/$attempt.log" \
      KASEKI_VALIDATION_COMMANDS=auto || { tail -80 "$context/$attempt.log"; fail "$manager $attempt worker"; }
    assert_file_contains "$context/results/pre-validation-timings.tsv" "$manager run build" "$manager build command"
    assert_file_contains "$context/results/pre-validation-timings.tsv" "$manager run test" "$manager test script"
    assert_file_contains "$context/results/pre-validation.log" 'package manager fixture passed' "$manager dependency resolution"
    [ ! -e "$context/workspace/repo/install-script-ran" ] || fail 'install scripts ran despite default ignore policy'
    [ "$(sha256sum "$context/workspace/repo/$lockfile" | cut -d ' ' -f 1)" = "$before" ] || fail 'install mutated lockfile'
    if [ "$attempt" = restored ]; then
      assert_file_contains "$context/$attempt.log" 'restoring node_modules from workspace cache' "$manager cache restore"
    fi
  done

  KASEKI_WORKSPACE_BASELINE_DIR="$context/baseline"
  KASEKI_WORKSPACE_DIR="$context/workspace"
  KASEKI_RESULTS_DIR="$context/results"
  KASEKI_LOG_DIR="$context/logs"
  REPO_URL="$repo"
  BASELINE_RESOLVED_REF=main
  BASELINE_COMMIT_SHA="$(git -C "$repo" rev-parse HEAD)"
  export KASEKI_WORKSPACE_BASELINE_DIR KASEKI_LOG_DIR REPO_URL BASELINE_RESOLVED_REF BASELINE_COMMIT_SHA
  # Baseline setup must detect its own manager despite the caller's context.
  KASEKI_PACKAGE_MANAGER=npm
  if [ "$manager" = npm ]; then KASEKI_PACKAGE_MANAGER=bun; fi
  (checkout_baseline_repo)
  (cd "$context/baseline" && node verify.cjs)
  [ ! -e "$context/baseline/install-script-ran" ] || fail 'baseline ran install script'
  [ "$(sha256sum "$context/baseline/$lockfile" | cut -d ' ' -f 1)" = "$before" ] || fail 'baseline mutated lockfile'
  unset KASEKI_PACKAGE_MANAGER

  mkdir -p "$repo/packages/child"
  printf '%s\n' '{"name":"fixture-child","version":"1.0.0","dependencies":{"is-number":"7.0.0"}}' > "$repo/packages/child/package.json"
  node - "$repo/package.json" "$manager" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.workspaces = ['packages/*'];
pkg.dependencies['fixture-child'] = process.argv[3] === 'bun' ? 'workspace:*' : '*';
fs.writeFileSync(file, JSON.stringify(pkg));
NODE
  (cd "$repo" && if [ "$manager" = bun ]; then bun install --lockfile-only --ignore-scripts; else npm install --package-lock-only --ignore-scripts --no-audit; fi)
  printf "if (!require('fixture-child/package.json').dependencies['is-number']) throw new Error('Workspace dependency missing');\n" >> "$repo/verify.cjs"
  git -C "$repo" add -A
  git -C "$repo" -c user.email=kaseki-test@example.invalid -c user.name=Test commit -qm 'workspace fixture'
  run_kaseki_agent_for_validation "$context" "$repo" auto "$context/workspace.log" KASEKI_VALIDATION_COMMANDS=auto || { tail -80 "$context/workspace.log"; fail "$manager workspace worker"; }
  [ -e "$context/workspace/repo/node_modules/fixture-child/package.json" ] || fail "$manager workspace link missing"
  assert_file_contains "$context/results/dependency-cache.log" 'package-store-install' "$manager workspace store installation"
  pass "$manager installs, restores, repairs, prepares baseline, validates scripts, and installs workspaces"
done

legacy_context=""
new_test_context legacy_context
cp "$ROOT_DIR/tests/fixtures/package-managers/bun/package.json" "$ROOT_DIR/tests/fixtures/package-managers/bun/verify.cjs" "$legacy_context/"
cp "$ROOT_DIR/tests/fixtures/package-managers/legacy-bun.lockb" "$legacy_context/bun.lockb"
(
  cd "$legacy_context"
  resolve_target_package_manager
  [ "$KASEKI_PACKAGE_MANAGER" = bun ] && [ "$KASEKI_LOCKFILE" = bun.lockb ]
  install_target_dependencies
  node verify.cjs
  [ ! -f bun.lock ] && [ ! -f install-script-ran ]
  cmp -s bun.lockb "$ROOT_DIR/tests/fixtures/package-managers/legacy-bun.lockb"
)
pass 'legacy Bun binary lockfile installs without migration or lockfile changes'
