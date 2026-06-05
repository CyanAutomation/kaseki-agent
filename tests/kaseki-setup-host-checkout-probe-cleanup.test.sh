#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT_DIR/scripts/kaseki-setup-host.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

probe_source="$TMP_DIR/probe-source.sh"
{
  echo 'set -euo pipefail'
  awk '/^resolve_uid_to_name\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
  awk '/^resolve_gid_to_name\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
  awk '/^run_checkout_freshness_probe\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
} > "$probe_source"

checkout_dir="$TMP_DIR/repo"
mkdir -p "$checkout_dir"
git -C "$checkout_dir" init >/dev/null 2>&1

test_runner="$TMP_DIR/run-probe.sh"
cat > "$test_runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
KASEKI_CONTAINER_UID="$(id -u)"
KASEKI_CONTAINER_GID="$(id -g)"
. "$probe_source"
run_checkout_freshness_probe "$checkout_dir" >/dev/null
exit 0
RUNNER
chmod +x "$test_runner"

if ! output="$("$test_runner" 2>&1)"; then
  fail "probe runner failed: $output"
fi
if printf '%s' "$output" | grep -qi 'unbound variable'; then
  fail "unexpected unbound variable output: $output"
fi

missing_checkout="$TMP_DIR/does-not-exist"
missing_runner="$TMP_DIR/run-probe-missing.sh"
cat > "$missing_runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
KASEKI_CONTAINER_UID="$(id -u)"
KASEKI_CONTAINER_GID="$(id -g)"
. "$probe_source"
run_checkout_freshness_probe "$missing_checkout" >/dev/null
exit 0
RUNNER
chmod +x "$missing_runner"

before_tmp_count="$(find /tmp -maxdepth 1 -name 'tmp.*' | wc -l)"
if ! missing_output="$("$missing_runner" 2>&1)"; then
  fail "missing checkout probe runner failed: $missing_output"
fi
after_tmp_count="$(find /tmp -maxdepth 1 -name 'tmp.*' | wc -l)"
if [ "$before_tmp_count" -ne "$after_tmp_count" ]; then
  fail "temporary file count changed on early return path: before=$before_tmp_count after=$after_tmp_count"
fi

if printf '%s' "$missing_output" | grep -qi 'unbound variable'; then
  fail "unexpected unbound variable output on early return path: $missing_output"
fi


parallel_source="$TMP_DIR/parallel-source.sh"
{
  echo 'set -euo pipefail'
  awk '
    /^run_privilege_tools_parallel\(\)/ { in_func=1 }
    /^# Phase 4: Performance tracking helpers/ { in_func=0 }
    in_func { print }
  ' "$SCRIPT_UNDER_TEST"
} > "$parallel_source"

fake_bin="$TMP_DIR/fake-bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/mktemp" <<'FAKE_MKTEMP'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-d" ]; then
  rm -rf "$KASEKI_FAKE_TEMP_DIR"
  mkdir -p "$KASEKI_FAKE_TEMP_DIR"
  printf '%s\n' "$KASEKI_FAKE_TEMP_DIR"
  exit 0
fi
exec /usr/bin/mktemp "$@"
FAKE_MKTEMP
cat > "$fake_bin/id" <<'FAKE_ID'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-u" ]; then
  printf '0\n'
  exit 0
fi
exec /usr/bin/id "$@"
FAKE_ID
cat > "$fake_bin/timeout" <<'FAKE_TIMEOUT'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
FAKE_TIMEOUT
cat > "$fake_bin/setpriv" <<'FAKE_SETPRIV'
#!/usr/bin/env bash
set -euo pipefail
while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      exec "$@"
      ;;
    --reuid|--regid)
      shift 2
      ;;
    --clear-groups)
      shift
      ;;
    *)
      shift
      ;;
  esac
done
exit 127
FAKE_SETPRIV
cat > "$fake_bin/sudo" <<'FAKE_SUDO'
#!/usr/bin/env bash
set -euo pipefail
exit 1
FAKE_SUDO
chmod +x "$fake_bin"/*

parallel_runner="$TMP_DIR/run-parallel.sh"
cat > "$parallel_runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
PATH="$fake_bin:/usr/bin:/bin"
KASEKI_PRIV_TOOL_TIMEOUT=2
KASEKI_CONTAINER_UID="$(id -u)"
KASEKI_CONTAINER_GID="$(id -g)"
KASEKI_FAKE_TEMP_DIR="$TMP_DIR/parallel-temp"
export PATH KASEKI_PRIV_TOOL_TIMEOUT KASEKI_CONTAINER_UID KASEKI_CONTAINER_GID KASEKI_FAKE_TEMP_DIR
. "$parallel_source"
stderr_file="$TMP_DIR/parallel.stderr"
run_privilege_tools_parallel "$checkout_dir" "\$stderr_file" "" "" bash -c 'exit 0'
if [ -d "\$KASEKI_FAKE_TEMP_DIR" ]; then
  echo "parallel temp dir still exists after success: \$KASEKI_FAKE_TEMP_DIR" >&2
  exit 1
fi
run_privilege_tools_parallel "$checkout_dir" "\$stderr_file" "" "" bash -c 'exit 42' && {
  echo "parallel failure command unexpectedly succeeded" >&2
  exit 1
}
if [ -d "\$KASEKI_FAKE_TEMP_DIR" ]; then
  echo "parallel temp dir still exists after failure: \$KASEKI_FAKE_TEMP_DIR" >&2
  exit 1
fi
exit 0
RUNNER
chmod +x "$parallel_runner"
if ! parallel_output="$("$parallel_runner" 2>&1)"; then
  fail "parallel privilege runner failed: $parallel_output"
fi
if printf '%s' "$parallel_output" | grep -qi 'unbound variable'; then
  fail "unexpected unbound variable output on parallel path: $parallel_output"
fi

echo "PASS: checkout freshness probe and parallel privilege cleanup work"
