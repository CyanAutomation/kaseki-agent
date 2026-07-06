#!/usr/bin/env bash
# Resolve Kaseki provider/model defaults.

kaseki_resolve_provider_model() {
  # Determine LLM provider: infer 'gateway' if gateway URL is set.
  if [ -z "${KASEKI_PROVIDER+x}" ]; then
    if [ -n "${LLM_GATEWAY_URL:-}" ]; then
      KASEKI_PROVIDER="gateway"
    else
      KASEKI_PROVIDER="${KASEKI_PROVIDER:-gateway}"
    fi
  fi

  # Gateway cannot consume the generic "auto" model sentinel, so normalize
  # unset or explicit auto to the gateway default before phase-specific model
  # defaults inherit it below.
  if [ "$KASEKI_PROVIDER" = "gateway" ]; then
    if [ -z "${KASEKI_MODEL+x}" ] || [ "$KASEKI_MODEL" = "auto" ]; then
      KASEKI_MODEL="${LLM_GATEWAY_MODEL:-dynamic/kaseki-agent}"
    fi
  elif [ -z "${KASEKI_MODEL+x}" ]; then
    KASEKI_MODEL="auto"
  fi

  export KASEKI_PROVIDER KASEKI_MODEL
}
