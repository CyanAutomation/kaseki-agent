#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kaseki-validation-preflight.XXXXXX")"
cleanup() {
  local status=$?
  trap - EXIT
  PATH="$ORIGINAL_PATH" rm -rf -- "$TMP_DIR"
  exit "$status"
}
ORIGINAL_PATH="$PATH"
trap cleanup EXIT

. "$ROOT_DIR/scripts/validation-command-preflight.sh"
# shellcheck source=../scripts/validation-helpers.sh
. "$ROOT_DIR/scripts/validation-helpers.sh"

mkdir -p "$TMP_DIR/bin"
cat > "$TMP_DIR/bin/npm" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$TMP_DIR/bin/node" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$TMP_DIR/bin/npm" "$TMP_DIR/bin/node"
PATH="$TMP_DIR/bin"

quoted_command="node -e 'const [major] = process.versions.node.split(\".\").map(Number); if (!major) process.exit(1)' && npm run check"
PATH="$ORIGINAL_PATH" validation_split_commands "$quoted_command; npm test"
[ "${#VALIDATION_COMMANDS[@]}" -eq 2 ] && [ "${VALIDATION_COMMANDS[0]}" = "$quoted_command" ] && [ "${VALIDATION_COMMANDS[1]}" = "npm test" ] || {
  printf '✗ quote-aware command splitting changed a semicolon inside the Node expression\n' >&2
  exit 1
}

assert_missing() {
  local expected="$1" commands="$2" actual
  actual="$(validation_command_missing_executable "$commands")" || {
    printf '✗ expected missing executable %s for %s\n' "$expected" "$commands" >&2
    exit 1
  }
  [ "$actual" = "$expected" ] || {
    printf '✗ expected %s, got %s for %s\n' "$expected" "$actual" "$commands" >&2
    exit 1
  }
}

assert_available() {
  local commands="$1" actual
  if actual="$(validation_command_missing_executable "$commands")"; then
    printf '✗ expected commands to be available, found missing %s for %s\n' "$actual" "$commands" >&2
    exit 1
  fi
}

assert_missing go 'go test ./...'
assert_missing make 'npm test; make ci'
assert_missing go 'KASEKI_MODE=ci go test ./...'
assert_available 'npm run build'
assert_available "npm run 'test|build'"
assert_available "node -e 'const [major, minor] = process.versions.node.split(\".\").map(Number); if (major !== 24 || minor < 10) process.exit(1)' && npm run check"
assert_available 'none'
assert_available ''

# Direct project binaries should resolve after the repository dependencies are
# installed, even when the validation command is not wrapped in `npm run`.
LOCAL_BIN_REPO="$TMP_DIR/local-bin-repo"
LOCAL_BIN_PATH="$LOCAL_BIN_REPO/node_modules/.bin"
EMPTY_BIN_REPO="$TMP_DIR/empty-bin-repo"
PATH="$ORIGINAL_PATH" mkdir -p "$LOCAL_BIN_PATH" "$EMPTY_BIN_REPO"
LOCAL_BIN_PATH="$(cd "$LOCAL_BIN_PATH" && pwd -P)"
(
  cd "$EMPTY_BIN_REPO"
  assert_missing ./node_modules/.bin/tsc './node_modules/.bin/tsc --noEmit'
)
for tool in eslint tsc; do
  printf '#!/bin/sh\nexit 0\n' > "$LOCAL_BIN_PATH/$tool"
  PATH="$ORIGINAL_PATH" chmod +x "$LOCAL_BIN_PATH/$tool"
done
assert_missing eslint 'eslint .'
assert_missing tsc 'tsc -p tsconfig.api.json'

if validation_command_preflight 'tsc -p tsconfig.api.json' "$TMP_DIR/missing-tsc.log"; then
  printf '✗ missing tsc executable unexpectedly passed validation preflight\n' >&2
  exit 1
else
  preflight_status=$?
fi
[ "$preflight_status" -eq 127 ] || {
  printf '✗ expected missing tsc to produce exit 127, got %s\n' "$preflight_status" >&2
  exit 1
}
PATH="$ORIGINAL_PATH" grep -Fqx '[validation toolchain preflight] missing_executable=tsc' "$TMP_DIR/missing-tsc.log" || {
  printf '✗ missing tsc failure did not identify the executable\n' >&2
  exit 1
}

# Npm scripts can hide a missing direct compiler in a nested `npm run check` chain.
SCRIPT_REPO="$TMP_DIR/script-repo"
PATH="$ORIGINAL_PATH" mkdir -p "$SCRIPT_REPO"
# Only Node is needed to expand npm scripts; keep runner-global tools like tsc out.
PREFLIGHT_BIN="$TMP_DIR/preflight-bin"
PATH="$ORIGINAL_PATH" mkdir -p "$PREFLIGHT_BIN"
PATH="$ORIGINAL_PATH" ln -s "$(PATH="$ORIGINAL_PATH" command -v node)" "$PREFLIGHT_BIN/node"
PATH="$ORIGINAL_PATH" ln -s "$(PATH="$ORIGINAL_PATH" command -v dirname)" "$PREFLIGHT_BIN/dirname"
PATH="$ORIGINAL_PATH" cat > "$SCRIPT_REPO/package.json" <<'JSON'
{"scripts":{"check":"npm run lint && npm run build","lint":"true","build":"tsc -p tsconfig.app.json"}}
JSON
PATH="$PREFLIGHT_BIN"
if validation_command_preflight 'npm run check' "$TMP_DIR/nested-tsc.log" "$SCRIPT_REPO"; then
  printf '✗ nested npm check unexpectedly passed without tsc\n' >&2
  exit 1
else
  preflight_status=$?
fi
[ "$preflight_status" -eq 127 ] || {
  printf '✗ expected nested missing tsc to produce exit 127, got %s\n' "$preflight_status" >&2
  exit 1
}
PATH="$ORIGINAL_PATH" grep -Fqx '[validation toolchain preflight] missing_executable=tsc' "$TMP_DIR/nested-tsc.log" || {
  printf '✗ nested npm check failure did not identify tsc\n' >&2
  exit 1
}
PATH="$ORIGINAL_PATH"

# Syntax preflight must reject an unmatched quote without executing the command list.
syntax_marker="$TMP_DIR/syntax-preflight-marker"
malformed_command="printf executed > '$syntax_marker'; node -e 'const [major] = process.versions.node.split(\".\").map(Number)"
if validation_command_preflight "$malformed_command" "$TMP_DIR/invalid-shell.log" "$SCRIPT_REPO"; then
  printf '✗ malformed shell command unexpectedly passed preflight\n' >&2
  exit 1
else
  preflight_status=$?
fi
[ "$preflight_status" -eq 2 ] || {
  printf '✗ expected malformed shell command to produce exit 2, got %s\n' "$preflight_status" >&2
  exit 1
}
[ ! -e "$syntax_marker" ] || {
  printf '✗ shell syntax preflight executed part of a malformed command\n' >&2
  exit 1
}
PATH="$ORIGINAL_PATH" grep -Fq '[validation command syntax preflight]' "$TMP_DIR/invalid-shell.log" || {
  printf '✗ malformed shell command did not receive a syntax diagnostic\n' >&2
  exit 1
}
PATH="$TMP_DIR/bin"

validation_prepend_repository_bins "$LOCAL_BIN_REPO"
assert_available 'eslint .'
assert_available 'tsc -p tsconfig.api.json'
validation_command_preflight 'eslint .;tsc -p tsconfig.api.json' "$TMP_DIR/pre-validation.log"
eslint .
tsc -p tsconfig.api.json
(
  cd "$LOCAL_BIN_REPO"
  assert_available './node_modules/.bin/tsc --noEmit'
)

validation_prepend_repository_bins "$LOCAL_BIN_REPO"
path_entry_count=0
IFS=: read -r -a path_entries <<< "$PATH"
for path_entry in "${path_entries[@]}"; do
  [ "$path_entry" = "$LOCAL_BIN_PATH" ] && path_entry_count=$((path_entry_count + 1))
done
[ "$path_entry_count" -eq 1 ] || {
  printf '✗ repository node_modules/.bin was added %s times to PATH\n' "$path_entry_count" >&2
  exit 1
}

dependency_setup_line="$(PATH="$ORIGINAL_PATH" grep -nF 'if ! run_step "prepare node dependencies" prepare_dependencies; then' "$ROOT_DIR/kaseki-agent.sh" | PATH="$ORIGINAL_PATH" cut -d: -f1)"
toolchain_preflight_line="$(PATH="$ORIGINAL_PATH" grep -nF 'validation_command_preflight \' "$ROOT_DIR/kaseki-agent.sh" | PATH="$ORIGINAL_PATH" cut -d: -f1)"
[ -n "$dependency_setup_line" ] && [ -n "$toolchain_preflight_line" ] && [ "$toolchain_preflight_line" -gt "$dependency_setup_line" ] || {
  printf '✗ validation tool preflight must run after project dependency preparation\n' >&2
  exit 1
}

printf '✓ validation command preflight identifies missing direct executables including tsc\n'
