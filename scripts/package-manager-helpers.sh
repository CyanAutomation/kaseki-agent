#!/usr/bin/env bash
# Shared package-manager operations. Resolution always runs in the checkout root.
KASEKI_PACKAGE_MANAGER_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

provision_declared_npm() {
  local requested_version="$1" bootstrap_npm npm_cli resolved_version
  bootstrap_npm="$(command -v npm)" || {
    printf 'Package manager: npm is unavailable; cannot provision npm@%s.\n' "$requested_version" >&2
    return 127
  }

  # Use npm's isolated exec cache rather than replacing the image's bundled
  # npm. The exact packageManager version is verified before any repository
  # install or validation command is run.
  npm_cli="$("$bootstrap_npm" exec --yes --ignore-scripts --no-audit --no-fund --no-update-notifier \
    --package="npm@$requested_version" -- sh -c 'command -v npm' 2>/dev/null)" || {
    printf 'Package manager: could not provision required npm@%s from the configured npm registry.\n' "$requested_version" >&2
    return 1
  }
  if [[ "$npm_cli" != /* ]] || [ ! -x "$npm_cli" ]; then
    printf 'Package manager: npm exec did not return an executable for required npm@%s.\n' "$requested_version" >&2
    return 1
  fi

  PATH="$(dirname "$npm_cli"):$PATH"
  export PATH
  hash -r
  resolved_version="$("$npm_cli" --version 2>/dev/null)" || return 1
  if [ "$resolved_version" != "$requested_version" ]; then
    printf 'Package manager: requested npm@%s but npm exec resolved npm@%s.\n' "$requested_version" "$resolved_version" >&2
    return 1
  fi
  printf 'Package manager: using repository-pinned npm@%s from the npm exec cache.\n' "$requested_version" >&2
}

resolve_target_package_manager() {
  local selection requested_version
  selection="$(node "$KASEKI_PACKAGE_MANAGER_HELPER_DIR/package-manager.cjs" resolve "${1:-$PWD}")" || return 1
  IFS=$'\t' read -r KASEKI_PACKAGE_MANAGER KASEKI_LOCKFILE requested_version KASEKI_PACKAGE_WORKSPACES KASEKI_PACKAGE_TREE_CACHE <<< "$selection"
  if ! command -v "$KASEKI_PACKAGE_MANAGER" >/dev/null 2>&1; then
    printf 'Package manager: %s is unavailable; install it in the worker image.\n' "$KASEKI_PACKAGE_MANAGER" >&2
    return 127
  fi
  KASEKI_PACKAGE_MANAGER_VERSION="$("$KASEKI_PACKAGE_MANAGER" --version)" || return 1
  if [[ ! "$KASEKI_PACKAGE_MANAGER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    printf 'Package manager: could not determine %s version.\n' "$KASEKI_PACKAGE_MANAGER" >&2
    return 1
  fi
  if [ "$requested_version" != '-' ] && [ "$requested_version" != "$KASEKI_PACKAGE_MANAGER_VERSION" ]; then
    if [ "$KASEKI_PACKAGE_MANAGER" = npm ]; then
      provision_declared_npm "$requested_version" || return $?
      KASEKI_PACKAGE_MANAGER_VERSION="$(npm --version 2>/dev/null)" || return 1
    else
      printf 'Package manager: repository requires %s@%s but worker provides %s; use a worker image with the required version.\n' "$KASEKI_PACKAGE_MANAGER" "$requested_version" "$KASEKI_PACKAGE_MANAGER_VERSION" >&2
      return 1
    fi
  fi
  export KASEKI_PACKAGE_MANAGER KASEKI_PACKAGE_MANAGER_VERSION KASEKI_LOCKFILE KASEKI_PACKAGE_WORKSPACES KASEKI_PACKAGE_TREE_CACHE
}

target_package_manager() {
  if [ -n "${KASEKI_PACKAGE_MANAGER:-}" ]; then
    printf '%s' "$KASEKI_PACKAGE_MANAGER"
  elif [ -f package.json ]; then
    local selection
    selection="$(node "$KASEKI_PACKAGE_MANAGER_HELPER_DIR/package-manager.cjs" preview)" || return 1
    printf '%s' "${selection%%$'\t'*}"
  else
    printf npm
  fi
}

package_manager_install_flags() {
  local -n pm_flags="$1"
  pm_flags=()
  if [ "${KASEKI_NPM_OMIT_DEV:-0}" = 1 ]; then
    if [ "${KASEKI_PACKAGE_MANAGER:-npm}" = bun ]; then pm_flags+=(--production); else pm_flags+=(--omit=dev); fi
  fi
  if [ "${KASEKI_INSTALL_IGNORE_SCRIPTS:-1}" = 1 ]; then pm_flags+=(--ignore-scripts); fi
}

install_target_dependencies() {
  local -a pm_install_flags=()
  package_manager_install_flags pm_install_flags
  if [ "${KASEKI_PACKAGE_MANAGER:-npm}" = bun ]; then
    if bun install --frozen-lockfile "${pm_install_flags[@]}"; then
      # Bun need not create node_modules for a dependency-free repository.
      mkdir -p node_modules
    else
      return $?
    fi
  else
    npm ci --prefer-offline "${pm_install_flags[@]}"
  fi
}

validate_target_dependency_graph() {
  if [ "${KASEKI_PACKAGE_MANAGER:-npm}" = bun ]; then
    # Reconcile a copied tree with the frozen lockfile. Bun's `pm ls` only
    # describes the lockfile and does not establish installed-tree integrity.
    KASEKI_INSTALL_IGNORE_SCRIPTS=1 install_target_dependencies
  else
    npm ls --depth=0
  fi
}

target_dependency_input_hash() {
  node "$KASEKI_PACKAGE_MANAGER_HELPER_DIR/package-manager.cjs" hash
}
