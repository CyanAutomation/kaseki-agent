#!/usr/bin/env bash
# Sourceable early provider-configuration validation.

kaseki_validate_early_provider_configuration() {
  if [ "${KASEKI_PROVIDER:-gateway}" != "gateway" ]; then
    printf 'Unsupported KASEKI_PROVIDER=%s. Kaseki is gateway-only; the OpenRouter credential is reserved for evaluation stages.\n' "${KASEKI_PROVIDER:-}" >&2
    return 2
  fi

  if [ -z "${LLM_GATEWAY_URL:-}" ]; then
    printf 'Missing LLM Gateway configuration for provider=gateway.\n' >&2
    printf '  Set LLM_GATEWAY_URL with an OpenAI-compatible endpoint:\n' >&2
    printf '    - CloudFlare AI: https://gateway.ai.cloudflare.com/v1/{account_id}/{namespace}/compat\n' >&2
    printf '    - Azure OpenAI: https://{resource}.openai.azure.com/\n' >&2
    printf '    - Ollama: http://localhost:11434/v1\n' >&2
    printf '    - Other: {your-endpoint}\n' >&2
    return 2
  fi

  return 0
}
