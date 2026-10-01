#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"

cat >"$TMP/bin/sleep" <<'EOF'
#!/usr/bin/env bash
stub_root="$(cd "$(dirname "$0")/.." && pwd)"
printf '%s\n' "$1" >>"$stub_root/state/delays"
clock="$(cat "$stub_root/state/clock")"
printf '%s' "$((clock + $1))" >"$stub_root/state/clock"
EOF
cat >"$TMP/bin/now" <<'EOF'
#!/usr/bin/env bash
stub_root="$(cd "$(dirname "$0")/.." && pwd)"
cat "$stub_root/state/clock"
EOF
cat >"$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -u
stub_root="$(cd "$(dirname "$0")/.." && pwd)"
STUB_STATE="$stub_root/state"
STUB_MODE="$(cat "$stub_root/mode")"
count_file="$STUB_STATE/count"
count=0; [[ -f "$count_file" ]] && count="$(cat "$count_file")"
count=$((count + 1)); printf '%s' "$count" >"$count_file"
printf '%s\n' "$*" >>"${STUB_STATE}/args"
printf '%s\n' "${NODE_AUTH_TOKEN-unset}" >>"${STUB_STATE}/tokens"
case "$STUB_MODE" in
  eventual) [[ $count -lt 2 ]] && { echo 'npm error E404 version not found' >&2; exit 1; }; echo '{"version":"1.2.3","dist":{"tarball":"https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz"}}' ;;
  e404) echo 'npm error E404 version not found' >&2; exit 1 ;;
  e401) echo 'npm error E401 invalid token npm_SUPERSECRET99' >&2; exit 1 ;;
  e403) echo 'npm error E403 forbidden' >&2; exit 1 ;;
  network) echo 'npm error ECONNRESET npm_SUPERSECRET99' >&2; exit 1 ;;
  mismatch) echo '{"version":"9.9.9"}' ;;
  missing_tarball) echo '{"version":"1.2.3"}' ;;
esac
EOF
chmod +x "$TMP/bin/npm" "$TMP/bin/sleep" "$TMP/bin/now"

fail() { echo "FAIL: $*" >&2; exit 1; }
run_case() {
  local mode="$1" deadline="$2"
  rm -rf "$TMP/state"; mkdir "$TMP/state"
  printf '100' >"$TMP/state/clock"
  printf '%s' "$mode" >"$TMP/mode"
  set +e
  PATH="$TMP/bin:$PATH" NODE_AUTH_TOKEN='npm_SUPERSECRET99' \
    KASEKI_NPM_VERIFY_SLEEP_COMMAND="$TMP/bin/sleep" \
    KASEKI_NPM_VERIFY_NOW_COMMAND="$TMP/bin/now" \
    KASEKI_NPM_VERIFY_JITTER_PERCENT=0 \
    KASEKI_NPM_VERIFY_METADATA_FILE="$TMP/state/diagnostics/npm-view.json" \
    "$ROOT/scripts/npm-verify-publish.sh" pkg 1.2.3 "$deadline" >"$TMP/state/out" 2>"$TMP/state/err"
  STATUS=$?
  set -e
}

run_case eventual 3; [[ $STATUS == 0 && $(cat "$TMP/state/count") == 2 ]] || fail 'eventual success'
[[ $(cat "$TMP/state/delays") == 1 ]] || fail 'first retry delay'
grep -q 'Attempt 1 starting (elapsed 0s; deadline 3s)' "$TMP/state/out" || fail 'attempt progress output'
grep -q 'Next retry in 1s' "$TMP/state/err" || fail 'next-delay progress output'
grep -q -- '--registry=https://registry.npmjs.org/' "$TMP/state/args" || fail 'explicit registry'
[[ $(sort -u "$TMP/state/tokens") == unset ]] || fail 'NODE_AUTH_TOKEN inherited by npm'
jq -e '.version == "1.2.3" and .dist.tarball == "https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz"' \
  "$TMP/state/diagnostics/npm-view.json" >/dev/null || fail 'success metadata did not retain dist.tarball from npm response'
jq -e '.classification == "success" and (.stdout | fromjson | .dist.tarball == "https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz")' \
  "$TMP/state/diagnostics/npm-verify-last-response.json" >/dev/null || fail 'success diagnostic did not use actual npm response'

run_case e404 3; [[ $STATUS == 1 && $(cat "$TMP/state/count") == 3 ]] || fail 'persistent E404 retries until deadline'
[[ $(paste -sd ' ' "$TMP/state/delays") == '1 2' ]] || fail 'retry delay sequence'
jq -e '.classification == "version-not-found" and .attempt == 3' "$TMP/state/diagnostics/npm-verify-last-response.json" >/dev/null || fail 'E404 artifact'
grep -q 'elapsed 3s; deadline 3s' "$TMP/state/err" || fail 'terminal timing output'
[[ -f "$TMP/state/diagnostics/npm-view.json" && -f "$TMP/state/diagnostics/npm-verify-last-response.json" ]] || fail 'terminal failure diagnostics are not uploadable'

for mode in e401 e403; do
  run_case "$mode" 3
  [[ $STATUS == 1 && $(cat "$TMP/state/count") == 1 ]] || fail "$mode did not fail immediately"
done

run_case network 3; [[ $STATUS == 1 && $(cat "$TMP/state/count") == 3 ]] || fail 'network retries'
run_case mismatch 3; [[ $STATUS == 1 && $(cat "$TMP/state/count") == 1 ]] || fail 'version mismatch did not fail immediately'
jq -e '.classification == "version-mismatch"' "$TMP/state/diagnostics/npm-verify-last-response.json" >/dev/null || fail 'mismatch artifact'
run_case missing_tarball 3; [[ $STATUS == 1 && $(cat "$TMP/state/count") == 1 ]] || fail 'missing tarball did not fail immediately'
jq -e '.classification == "missing-tarball"' "$TMP/state/diagnostics/npm-verify-last-response.json" >/dev/null || fail 'missing tarball artifact'

run_case e404 40
[[ $(paste -sd ' ' "$TMP/state/delays") == '1 2 4 8 16 9' ]] || fail 'generated exponential delays capped by deadline'
[[ $(cat "$TMP/state/count") == 7 ]] || fail 'deadline did not bound generated retry attempts'

run_case network 1
! rg -q 'npm_SUPERSECRET99' "$TMP/state" || fail 'secret leaked to output or artifact'
jq -e '.stderr | contains("[REDACTED]")' "$TMP/state/diagnostics/npm-verify-last-response.json" >/dev/null || fail 'redaction absent'
! find "$TMP/state/diagnostics" -name '*.npmrc' -print -quit | grep -q . || fail 'generated npmrc entered diagnostics'

set +e
"$ROOT/scripts/npm-verify-publish.sh" pkg 1.2.3 6x >"$TMP/invalid.out" 2>"$TMP/invalid.err"
invalid_status=$?
set -e
[[ $invalid_status == 2 ]] || fail 'invalid deadline accepted'
grep -q 'MAX_ELAPSED_SECONDS must be an integer' "$TMP/invalid.err" || fail 'invalid deadline diagnostic'

echo 'npm publish verification tests passed'
