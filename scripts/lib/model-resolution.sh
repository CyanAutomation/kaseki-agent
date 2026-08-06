#!/usr/bin/env bash
# Resolve Kaseki provider/model defaults.

kaseki_resolve_provider_model() {
  # Determine LLM provider: default to gateway when no provider is set.
  if [ -z "${KASEKI_PROVIDER+x}" ]; then
    KASEKI_PROVIDER="gateway"
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

  # Preserve the model selected before the gateway adapter serializes requests.
  # Gateways that perform dynamic routing can override this with the concrete
  # routed model in their response/log enrichment without losing lineage.
  KASEKI_RESOLVED_MODEL="${KASEKI_RESOLVED_MODEL:-$KASEKI_MODEL}"
  export KASEKI_PROVIDER KASEKI_MODEL KASEKI_RESOLVED_MODEL
}
