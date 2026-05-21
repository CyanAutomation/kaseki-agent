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

echo "PASS: checkout freshness probe cleanup works for normal and early-return paths"
