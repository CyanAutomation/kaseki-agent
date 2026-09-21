#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/bin"
cat > "$TEMP_DIR/bin/shellcheck" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SHELLCHECK_TEST_LOG"
EOF
chmod +x "$TEMP_DIR/bin/shellcheck"

export SHELLCHECK_TEST_LOG="$TEMP_DIR/invocations.log"
PATH="$TEMP_DIR/bin:$PATH" bash "$ROOT_DIR/scripts/run-shellcheck.sh"

grep -q -- 'run-kaseki.sh' "$SHELLCHECK_TEST_LOG"
if grep -q -- 'kaseki-agent.sh' "$SHELLCHECK_TEST_LOG"; then
  printf 'kaseki-agent.sh must not be passed to ShellCheck\n' >&2
  exit 1
fi

printf 'run-shellcheck wrapper contract: ok\n'
