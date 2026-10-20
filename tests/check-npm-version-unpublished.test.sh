#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat >"$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
stub_root="$(cd "$(dirname "$0")/.." && pwd)"
printf '%s\n' "$*" >>"$stub_root/args"
case "${STUB_NPM_MODE:?}" in
  unpublished) printf '["1.2.2","1.2.4"]\n' ;;
  published) printf '["1.2.2","1.2.3","1.2.4"]\n' ;;
  package_not_found) printf '{"error":{"code":"E404","summary":"Not Found"}}\n'; exit 1 ;;
  auth_error) echo 'npm error code E401' >&2; exit 1 ;;
  network_error) echo 'npm error code ECONNRESET' >&2; exit 1 ;;
  malformed) printf 'not-json\n' ;;
  wrong_shape) printf '{"versions":[]}\n' ;;
  *) echo "unexpected stub mode" >&2; exit 2 ;;
esac
EOF
chmod +x "$TMP/bin/npm"

fail() { echo "FAIL: $*" >&2; exit 1; }
run_case() {
  local mode="$1"
  set +e
  PATH="$TMP/bin:$PATH" STUB_NPM_MODE="$mode" \
    "$ROOT/scripts/check-npm-version-unpublished.sh" @example/package 1.2.3 \
    >"$TMP/$mode.out" 2>"$TMP/$mode.err"
  STATUS=$?
  set -e
}

run_case unpublished
[[ $STATUS == 0 ]] || fail 'unpublished version should pass'
grep -q 'Confirmed @example/package@1.2.3 is unpublished' "$TMP/unpublished.out" \
  || fail 'unpublished confirmation missing'
grep -q '^view @example/package versions --json --registry=https://registry.npmjs.org/$' "$TMP/args" \
  || fail 'registry query must request the package version list'

run_case package_not_found
[[ $STATUS == 0 ]] || fail 'an unpublished package (E404) should allow its first version to publish'
grep -q 'Confirmed @example/package@1.2.3 is unpublished' "$TMP/package_not_found.out" \
  || fail 'package-not-found confirmation missing'

run_case published
[[ $STATUS == 1 ]] || fail 'published version should fail'
grep -q 'already exists' "$TMP/published.err" || fail 'published version diagnostic missing'

for mode in auth_error network_error malformed wrong_shape; do
  run_case "$mode"
  [[ $STATUS != 0 ]] || fail "$mode must fail closed"
done
grep -q 'E401' "$TMP/auth_error.err" || fail 'authentication error detail was hidden'
grep -q 'ECONNRESET' "$TMP/network_error.err" || fail 'network error detail was hidden'
grep -q 'npm registry returned invalid JSON' "$TMP/malformed.err" || fail 'malformed registry response was treated as unpublished'
grep -q 'expected to be a JSON array' "$TMP/wrong_shape.err" || fail 'unexpected registry response shape was accepted'

echo 'npm unpublished-version preflight tests passed'
