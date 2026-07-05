#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/lib/provider-retry.sh"

fail() { printf 'FAIL: gateway health alignment: %s\n' "$*" >&2; exit 1; }

grep -Fq 'KASEKI_GATEWAY_URL:-${LLM_GATEWAY_URL' "$SCRIPT" || fail 'worker probe does not inherit the configured LLM gateway URL'
grep -Fq 'KASEKI_GATEWAY_HEALTH_URL' "$SCRIPT" || fail 'explicit health URL override missing'
grep -Fq 'KASEKI_GATEWAY_READINESS_URL' "$SCRIPT" || fail 'explicit readiness URL override missing'
grep -Fq '.status == "ready"' "$SCRIPT" || fail 'standard readiness response is not recognized'
grep -Fq 'Cloudflare /compat has no implicit health endpoint' "$SCRIPT" || fail 'Cloudflare compat health handling is missing'

AGENT_SCRIPT="$ROOT_DIR/kaseki-agent.sh"
grep -Fq 'export KASEKI_GATEWAY_URL="$llm_gateway_url"' "$AGENT_SCRIPT" || fail 'agent phases do not share one resolved gateway URL'

printf 'PASS: gateway health and readiness endpoints are aligned and configurable\n'
