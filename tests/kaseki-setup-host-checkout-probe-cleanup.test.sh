#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT_DIR/scripts/kaseki-setup-host.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

assert_no_temp_dir_unbound_variable() {
  local label="$1"
  local output="$2"
  if printf '%s' "$output" | grep -q 'temp_dir: unbound variable'; then
    fail "unexpected temp_dir: unbound variable output on ${label}: $output"
  fi
  if printf '%s' "$output" | grep -qi 'unbound variable'; then
    fail "unexpected unbound variable output on ${label}: $output"
  fi
}

probe_source="$TMP_DIR/probe-source.sh"
{
  echo 'set -euo pipefail'
  awk '/^resolve_uid_to_name\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
  awk '/^resolve_gid_to_name\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
  awk '
    /^run_privilege_tools_parallel\(\)/ { in_func=1 }
    /^# Phase 4: Performance tracking helpers/ { in_func=0 }
    in_func { print }
  ' "$SCRIPT_UNDER_TEST"
  awk '/^run_checkout_freshness_probe\(\)/,/^}/' "$SCRIPT_UNDER_TEST"
} > "$probe_source"

checkout_dir="$TMP_DIR/repo"
mkdir -p "$checkout_dir"
git -C "$checkout_dir" init >/dev/null 2>&1
git -C "$checkout_dir" -c user.name='Kaseki Test' -c user.email='kaseki-test@example.com' commit --allow-empty -m 'initial' >/dev/null 2>&1

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
assert_no_temp_dir_unbound_variable "checkout success path" "$output"

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

assert_no_temp_dir_unbound_variable "checkout early return path" "$missing_output"


parallel_source="$TMP_DIR/parallel-source.sh"
{
  echo 'set -euo pipefail'
  awk '
    /^run_privilege_tools_parallel\(\)/ { in_func=1 }
    /^# Phase 4: Performance tracking helpers/ { in_func=0 }
    in_func { print }
  ' "$SCRIPT_UNDER_TEST"
} > "$parallel_source"

for required_parallel_token in run_privilege_tools_parallel cleanup_parallel success_marker; do
  if ! grep -q "$required_parallel_token" "$parallel_source"; then
    fail "parallel source fixture is missing distinctive token: $required_parallel_token"
  fi
done

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
elif [ "${1:-}" = "-g" ]; then
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
sleep "${KASEKI_FAKE_SETPRIV_DELAY:-0}"
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
printf 'fake sudo failure should be ignored on parallel success\n' >&2
if [ -n "${KASEKI_FAKE_SUDO_MARKER:-}" ]; then
  : >"$KASEKI_FAKE_SUDO_MARKER"
fi
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
KASEKI_FAKE_TEMP_DIR="$TMP_DIR/cleanup_parallel-success-temp"
export PATH KASEKI_PRIV_TOOL_TIMEOUT KASEKI_CONTAINER_UID KASEKI_CONTAINER_GID KASEKI_FAKE_TEMP_DIR
. "$parallel_source"
stderr_file="$TMP_DIR/parallel.stderr"
run_privilege_tools_parallel "$checkout_dir" "\$stderr_file" "" "" bash -c 'exit 0'
if [ -s "\$stderr_file" ]; then
  echo "parallel success leaked stderr from failing sudoers_audit fallback: \$(cat "\$stderr_file")" >&2
  exit 1
fi
if [ -d "\$KASEKI_FAKE_TEMP_DIR" ]; then
  echo "parallel temp dir still exists after success: \$KASEKI_FAKE_TEMP_DIR" >&2
  exit 1
fi
KASEKI_FAKE_TEMP_DIR="$TMP_DIR/cleanup_parallel-failure-temp"
run_privilege_tools_parallel "$checkout_dir" "\$stderr_file" "" "" bash -c 'exit 42' && {
  echo "parallel failure command unexpectedly succeeded" >&2
  exit 1
}
if ! grep -q 'fake sudo failure should be ignored on parallel success' "\$stderr_file"; then
  echo "parallel failure did not copy selected fallback stderr: \$(cat "\$stderr_file")" >&2
  exit 1
fi
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
assert_no_temp_dir_unbound_variable "run_privilege_tools_parallel cleanup_parallel path" "$parallel_output"
checkout_parallel_runner="$TMP_DIR/run-checkout-parallel.sh"
cat > "$checkout_parallel_runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
PATH="$fake_bin:/usr/bin:/bin"
KASEKI_PRIV_TOOL_TIMEOUT=2
KASEKI_CONTAINER_UID=12345
KASEKI_CONTAINER_GID=23456
KASEKI_FAKE_TEMP_DIR="$TMP_DIR/checkout-cleanup_parallel-temp"
KASEKI_FAKE_SETPRIV_DELAY=0.2
KASEKI_FAKE_SUDO_MARKER="$TMP_DIR/fake-sudo-called"
export PATH KASEKI_PRIV_TOOL_TIMEOUT KASEKI_CONTAINER_UID KASEKI_CONTAINER_GID KASEKI_FAKE_TEMP_DIR KASEKI_FAKE_SETPRIV_DELAY KASEKI_FAKE_SUDO_MARKER
. "$probe_source"
probe_payload="\$(run_checkout_freshness_probe "$checkout_dir")"
case "\$probe_payload" in
  ok\|*) ;;
  *)
    echo "checkout freshness probe did not return ok after setpriv success: \$probe_payload" >&2
    exit 1
    ;;
esac
if [ ! -f "\$KASEKI_FAKE_SUDO_MARKER" ]; then
  echo "fake sudo fallback did not run during parallel probe regression" >&2
  exit 1
fi
if printf '%s' "\$probe_payload" | grep -q 'fake sudo failure'; then
  echo "checkout freshness probe leaked fallback stderr despite success: \$probe_payload" >&2
  exit 1
fi
exit 0
RUNNER
chmod +x "$checkout_parallel_runner"
if ! checkout_parallel_output="$("$checkout_parallel_runner" 2>&1)"; then
  fail "checkout parallel privilege regression failed: $checkout_parallel_output"
fi
assert_no_temp_dir_unbound_variable "root-simulated checkout parallel path" "$checkout_parallel_output"


audit_fake_bin="$TMP_DIR/audit-fake-bin"
mkdir -p "$audit_fake_bin"
cat > "$audit_fake_bin/id" <<'FAKE_ID'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-u" ]; then
  printf '0\n'
  exit 0
elif [ "${1:-}" = "-g" ]; then
  printf '0\n'
  exit 0
fi
exec /usr/bin/id "$@"
FAKE_ID
cat > "$audit_fake_bin/timeout" <<'FAKE_TIMEOUT'
#!/usr/bin/env bash
set -euo pipefail
shift
exec "$@"
FAKE_TIMEOUT
cat > "$audit_fake_bin/setpriv" <<'FAKE_SETPRIV'
#!/usr/bin/env bash
set -euo pipefail
exit 1
FAKE_SETPRIV
cat > "$audit_fake_bin/sudo" <<'FAKE_SUDO'
#!/usr/bin/env bash
set -euo pipefail
printf 'sudo: error initializing audit plugin sudoers_audit\n' >&2
exit 1
FAKE_SUDO
chmod +x "$audit_fake_bin"/*

audit_runner="$TMP_DIR/run-audit-plugin-probe.sh"
cat > "$audit_runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
PATH="$audit_fake_bin:/usr/bin:/bin"
KASEKI_PRIV_TOOL_TIMEOUT=2
KASEKI_CONTAINER_UID=12345
KASEKI_CONTAINER_GID=23456
export PATH KASEKI_PRIV_TOOL_TIMEOUT KASEKI_CONTAINER_UID KASEKI_CONTAINER_GID
. "$probe_source"
probe_payload="\$(run_checkout_freshness_probe "$checkout_dir")"
IFS='|' read -r probe_status probe_detail probe_remediation <<< "\$probe_payload"
if [ "\$probe_status" != "failed" ]; then
  echo "audit plugin probe unexpectedly returned non-failed status: \$probe_payload" >&2
  exit 1
fi
if ! printf '%s' "\$probe_detail" | grep -qi 'host privilege-tool configuration'; then
  echo "audit plugin probe detail did not identify host privilege-tool configuration: \$probe_payload" >&2
  exit 1
fi
if ! printf '%s' "\$probe_remediation" | grep -Eqi 'privilege-tool configuration.*sudo|sudo.*audit.*sudoers_audit'; then
  echo "audit plugin probe remediation did not point to privilege-tool/sudo configuration: \$probe_payload" >&2
  exit 1
fi
if printf '%s' "\$probe_remediation" | grep -qi 'Fix ownership/permissions'; then
  echo "audit plugin probe remediation incorrectly pointed to checkout ownership: \$probe_payload" >&2
  exit 1
fi
exit 0
RUNNER
chmod +x "$audit_runner"
if ! audit_output="$("$audit_runner" 2>&1)"; then
  fail "audit plugin privilege classification regression failed: $audit_output"
fi
assert_no_temp_dir_unbound_variable "sudoers_audit classification path" "$audit_output"

echo "PASS: checkout freshness probe and parallel privilege cleanup work"
