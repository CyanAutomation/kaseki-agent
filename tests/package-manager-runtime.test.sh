#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/package-manager-helpers.sh"
. "$ROOT_DIR/scripts/validation-helpers.sh"
. "$ROOT_DIR/scripts/dependency-cache-helpers.sh"
# Exercise the actual worker parser as well as the shared validation helpers.
eval "$(awk '/^npm_run_script_name\(\)/ { emit=1 } /^package_json_has_npm_script\(\)/ { emit=0 } emit { print }' "$ROOT_DIR/kaseki-agent.sh")"
[ "$(npm_run_script_name 'bun run type-check --flag')" = type-check ]
[ "$(npm_run_script_name 'npm run test-unit')" = test-unit ]
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/bin"
cat > "$tmp_dir/bin/bun" <<'BUN'
#!/usr/bin/env bash
if [ "$1" = --version ]; then printf '1.3.11\n'; else printf '%s\n' "$*" >> "$PM_CALLS"; fi
BUN
chmod +x "$tmp_dir/bin/bun"
export PATH="$tmp_dir/bin:$PATH" PM_CALLS="$tmp_dir/calls"
cd "$tmp_dir"
printf '%s\n' '{"packageManager":"bun@1.3.11","scripts":{"build":"tsc","test":"jest","lint:fix":"eslint --fix"}}' > package.json
printf '{}' > bun.lock
resolve_target_package_manager
[ "$KASEKI_PACKAGE_MANAGER" = bun ]
[ "$KASEKI_LOCKFILE" = bun.lock ]
install_target_dependencies
[ "$(cat "$PM_CALLS")" = 'install --frozen-lockfile --ignore-scripts' ]
[ "$(construct_default_validation_commands)" = 'bun run build;bun run test' ]
[ "$(ensure_build_before_test_validation 'bun run test')" = 'bun run build;bun run test' ]
[ "$(missing_npm_script_for_validation_command 'bun run absent')" = absent ]
if npm_run_script_name 'bun test'; then exit 1; fi
npm_key="$(KASEKI_PACKAGE_MANAGER=npm KASEKI_PACKAGE_MANAGER_VERSION=11.21.0 dependency_cache_key abc 24 flags linux x64 137)"
bun_key="$(dependency_cache_key abc 24 flags linux x64 137)"
[ "$npm_key" != "$bun_key" ]
[ "$bun_key" != "$(KASEKI_PACKAGE_MANAGER_VERSION=1.3.12 dependency_cache_key abc 24 flags linux x64 137)" ]
KASEKI_NPM_OMIT_DEV=1 install_target_dependencies
[ "$(tail -1 "$PM_CALLS")" = 'install --frozen-lockfile --production --ignore-scripts' ]
KASEKI_INSTALL_IGNORE_SCRIPTS=0 install_target_dependencies
[ "$(tail -1 "$PM_CALLS")" = 'install --frozen-lockfile' ]
# A declared version mismatch must stop before running an install.
printf '%s\n' '{"packageManager":"bun@0.0.1"}' > package.json
if resolve_target_package_manager 2> "$tmp_dir/version-error"; then exit 1; fi
grep -q 'requires bun@0.0.1' "$tmp_dir/version-error"
# Installer errors retain their exit status.
printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$tmp_dir/bin/bun"
install_exit=0
install_target_dependencies || install_exit=$?
[ "$install_exit" = 42 ]
printf 'npm/Bun runtime tests passed\n'
