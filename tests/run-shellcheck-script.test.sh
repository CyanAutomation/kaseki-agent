#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/bin"
cat > "$TEMP_DIR/bin/shellcheck" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Keep argument boundaries visible so the test cannot pass because one path is a
# substring of another argument.
printf '%s\n' '--- invocation ---' >> "$SHELLCHECK_TEST_LOG"
printf 'arg=%q\n' "$@" >> "$SHELLCHECK_TEST_LOG"
exit "${SHELLCHECK_TEST_EXIT_STATUS:-0}"
EOF
chmod +x "$TEMP_DIR/bin/shellcheck"

write_expected_invocation() {
  printf '%s\n' '--- invocation ---'
  printf 'arg=%q\n' "$@"
}

cd "$ROOT_DIR"
production_files=(
  run-kaseki.sh
  test-artifact-recovery.sh
)
production_files+=(scripts/*.sh)
production_files+=(scripts/lib/*.sh)

# Guard the expectation itself: an unmatched glob would otherwise be logged as
# a literal argument and could accidentally mirror the same bug in the wrapper.
for file in "${production_files[@]}"; do
  if [ ! -f "$file" ]; then
    printf 'expected production glob to expand to a file, got %q\n' "$file" >&2
    exit 1
  fi
done

test_files=()
while IFS= read -r -d '' file; do
  test_files+=("$file")
done < <(find test tests -type f \( -name '*.sh' -o -name '*.bash' -o -name '*.bats' \) -print0 | sort -z)

write_expected_invocation \
  -x -P . -P scripts -P scripts/lib "${production_files[@]}" \
  > "$TEMP_DIR/expected.log"
write_expected_invocation \
  -x -S warning -e SC1090,SC2034 "${test_files[@]}" \
  >> "$TEMP_DIR/expected.log"

export SHELLCHECK_TEST_LOG="$TEMP_DIR/invocations.log"
PATH="$TEMP_DIR/bin:$PATH" bash "$ROOT_DIR/scripts/run-shellcheck.sh"

# Exact comparison verifies the complete inclusion set, argument order, flags,
# and exclusion of every file outside the two documented file groups.
diff -u "$TEMP_DIR/expected.log" "$SHELLCHECK_TEST_LOG"

: > "$SHELLCHECK_TEST_LOG"
export SHELLCHECK_TEST_EXIT_STATUS=23
if PATH="$TEMP_DIR/bin:$PATH" bash "$ROOT_DIR/scripts/run-shellcheck.sh"; then
  printf 'run-shellcheck.sh unexpectedly succeeded when ShellCheck failed\n' >&2
  exit 1
else
  wrapper_status=$?
fi

if [ "$wrapper_status" -ne "$SHELLCHECK_TEST_EXIT_STATUS" ]; then
  printf 'expected ShellCheck status %s, got %s\n' \
    "$SHELLCHECK_TEST_EXIT_STATUS" "$wrapper_status" >&2
  exit 1
fi

# The first failing production invocation must stop the wrapper before it runs
# ShellCheck over tests.
write_expected_invocation \
  -x -P . -P scripts -P scripts/lib "${production_files[@]}" \
  > "$TEMP_DIR/expected-failure.log"
diff -u "$TEMP_DIR/expected-failure.log" "$SHELLCHECK_TEST_LOG"

printf 'run-shellcheck wrapper contract: ok\n'
