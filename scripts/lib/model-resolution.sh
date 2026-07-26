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

  export KASEKI_PROVIDER KASEKI_MODEL
}

# Validate provider configuration that must be present before any agent setup.
# This deliberately has no dependency on the main runner so integration tests
# and other entrypoints can exercise the same early validation path directly.
kaseki_validate_early_provider_configuration() {
  if [ "${KASEKI_PROVIDER:-}" = "gateway" ] && [ -z "${LLM_GATEWAY_URL:-}" ]; then
    printf 'Missing LLM Gateway configuration for provider=gateway.\n' >&2
    printf '  Set LLM_GATEWAY_URL with an OpenAI-compatible endpoint:\n' >&2
    printf '    - CloudFlare AI: https://gateway.ai.cloudflare.com/v1/{account_id}/{namespace}/compat\n' >&2
    printf '    - Azure OpenAI: https://{resource}.openai.azure.com/\n' >&2
    printf '    - Ollama: http://localhost:11434/v1\n' >&2
    printf '    - Other: {your-endpoint}\n' >&2
    printf '  Or set KASEKI_PROVIDER=openrouter and provide OPENROUTER_API_KEY to use OpenRouter instead.\n' >&2
    return 2
  fi
}
