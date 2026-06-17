/**
 * Pi CLI Custom Extension: LLM Gateway Provider
 * 
 * Registers a custom LLM gateway provider that reads endpoint and API key
 * from environment variables.
 * 
 * Configuration Environment Variables:
 * - LLM_GATEWAY_URL: Gateway API endpoint (required, e.g., https://manifest.scheimann.xyz/v1/responses)
 * - LLM_GATEWAY_API_KEY: API key literal (optional, prefer file)
 * - LLM_GATEWAY_API_KEY_FILE: Path to file containing API key (default: ~/.kaseki/secrets.json)
 * - LLM_GATEWAY_MODEL: Model selector (optional, defaults to "auto")
 */

module.exports = function (pi) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  
  // If gateway is configured, register the provider
  if (gatewayUrl) {
    pi.registerProvider("gateway", {
      name: "LLM Gateway",
      baseUrl: gatewayUrl,
      apiKey: "$LLM_GATEWAY_API_KEY", // Env var interpolation
      api: "openai-responses", // Manifest gateway is OpenAI Responses API compatible
      models: [
        {
          id: "auto",
          name: "Auto (Gateway Default)",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096
        }
      ]
    });
  }
};
