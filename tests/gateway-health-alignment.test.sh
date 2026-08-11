#!/usr/bin/env bash
# Regression test for KASEKI-201: gateway health probes must honor the
# configured health surfaces without treating Cloudflare /compat as one.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'FAIL: gateway health alignment: %s\n' "$*" >&2
  exit 1
}

mkdir -p "$TMP_DIR/bin" "$TMP_DIR/results"
cat > "$TMP_DIR/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
printf '%s\n' "$url" >> "$FAKE_CURL_REQUESTS"
case "$url" in
  https://probe.example/health) printf '{"status":"ready"}\n' ;;
  https://probe.example/live) printf '{"status":"healthy"}\n' ;;
  https://probe.example/readiness) printf '{"ready":false}\n' ;;
  *) printf 'unexpected fake curl URL: %s\n' "$url" >&2; exit 22 ;;
esac
SH
chmod +x "$TMP_DIR/bin/curl"

run_probe() {
  local case_name="$1" gateway_url="$2" health_url="$3" readiness_url="$4"
  local requests="$TMP_DIR/$case_name.requests" diagnostics="$TMP_DIR/$case_name.stderr"
  : > "$requests"

  set +e
  env \
    PATH="$TMP_DIR/bin:$PATH" \
    FAKE_CURL_REQUESTS="$requests" \
    KASEKI_RESULTS_DIR="$TMP_DIR/results/$case_name" \
    KASEKI_GATEWAY_URL="$gateway_url" \
    KASEKI_GATEWAY_HEALTH_URL="$health_url" \
    KASEKI_GATEWAY_READINESS_URL="$readiness_url" \
    bash -c '. "$1"; pre_check_gateway_health gateway' \
      _ "$ROOT_DIR/scripts/lib/provider-retry.sh" > /dev/null 2> "$diagnostics"
  PROBE_STATUS=$?
  set -e

  PROBE_REQUESTS="$requests"
  PROBE_DIAGNOSTICS="$diagnostics"
}

run_probe ready https://ignored.example/base \
  https://probe.example/health https://probe.example/readiness
[ "$PROBE_STATUS" -eq 0 ] || fail "ready response exited $PROBE_STATUS instead of 0"
[ "$(cat "$PROBE_REQUESTS")" = 'https://probe.example/health' ] || fail 'ready probe selected the wrong endpoint'
grep -Fq 'Gateway responsive and ready' "$PROBE_DIAGNOSTICS" || fail 'ready diagnostic was not emitted'

run_probe not-ready https://ignored.example/base \
  https://probe.example/live https://probe.example/readiness
[ "$PROBE_STATUS" -eq 1 ] || fail "not-ready response exited $PROBE_STATUS instead of 1"
[ "$(cat "$PROBE_REQUESTS")" = $'https://probe.example/live\nhttps://probe.example/readiness' ] || fail 'not-ready probe did not fall back to the configured readiness endpoint'
grep -Fq 'Gateway responsive but not ready; refusing provider request' "$PROBE_DIAGNOSTICS" || fail 'not-ready diagnostic was not emitted'

# An empty health override exercises the entry point's documented /compat
# special case. The fake client makes an accidental HTTP request observable.
run_probe compat https://gateway.ai.cloudflare.com/v1/account/gateway/compat '' \
  https://probe.example/readiness
[ "$PROBE_STATUS" -eq 0 ] || fail "Cloudflare /compat response exited $PROBE_STATUS instead of 0"
[ ! -s "$PROBE_REQUESTS" ] || fail 'Cloudflare /compat unexpectedly invoked the HTTP client'
grep -Fq 'Cloudflare /compat has no implicit health endpoint; deferring to authenticated inference' "$PROBE_DIAGNOSTICS" || fail 'Cloudflare /compat diagnostic was not emitted'

printf 'PASS: gateway health entry point selects configured endpoints and reports readiness\n'
