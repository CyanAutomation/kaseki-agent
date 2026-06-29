# Gateway Testing Guide

## Overview

The **Gateway Test** feature validates kaseki-agent's LLM gateway connectivity and inference capabilities. It supports two-stage testing and optional Pi provider adapter smoke testing for production environments.

## Quick Start

### Testing in Web UI

1. **Navigate to** `http://localhost:3000` (API service)
2. **Click** "Test LLM" button
3. **View results:**
   - ✅ **Green** = All tests passed
   - ❌ **Red** = One or more tests failed
   - 📊 **Details** = Response times, event counts, diagnostic information

### Testing via API

```bash
# Full two-stage test (connectivity + inference)
curl http://localhost:3000/api/gateway-test?stage=2

# Stage 1 only (connectivity check)
curl http://localhost:3000/api/gateway-test?stage=1

# Full test with Pi provider adapter check
curl http://localhost:3000/api/gateway-test?stage=2&piProvider=true

# Full test with debug diagnostics
curl http://localhost:3000/api/gateway-test?stage=2&piProvider=true&debug=true
```


## Manual Pi CLI Integration Test

Use this end-to-end check when Pi CLI is available and you need to validate the actual gateway payload format against a live gateway.

```bash
export LLM_GATEWAY_URL=https://llm-gateway.local.xyz/v1
export LLM_GATEWAY_API_KEY=<your-key>
export KASEKI_PROVIDER=gateway
export KASEKI_MODEL=dynamic/kaseki-agent

./run-kaseki.sh
```

After the run finishes, inspect these artifacts and logs:

1. `/agents/kaseki-results/kaseki-N/.gateway-diagnostics.jsonl` should contain `extension_module_loaded` and `provider_registered` events.
2. Gateway server logs should show the payload shape, including `{model, input, stream, tools, ...}`. Confirm whether `input` is a string or an array.
3. `metadata.json` should include `phases.gateway_normalization` with consolidated diagnostics.

## Test Stages

### Stage 1: Gateway Connectivity

**What it tests:**
- LLM gateway is reachable (network connectivity)
- Authentication credentials are valid
- Gateway API responds to requests

**Response fields:**
- `status` — 'ok' or 'bad'
- `responseTime` — Milliseconds to first response
- `authenticationValidated` — Boolean
- `detail` — Status message

**Example:**
```bash
curl http://localhost:3000/api/gateway-test?stage=1
# Response:
{
  "status": "ok",
  "detail": "Gateway responds to requests",
  "responseTime": 123,
  "timestamp": "2024-01-15T10:30:00Z",
  "authenticationValidated": true
}
```

### Stage 2: LLM Inference & Responses

**What it tests:**
- LLM can process prompts and generate text
- Response streaming works correctly
- Large prompts are handled
- Response parsing produces valid output tokens

**Response fields:**
- `status` — 'ok' or 'bad'
- `responseTime` — Milliseconds for full response
- `outputTokens` — Token count in response
- `responseSmokeValidated` — Boolean
- `streamSmokeValidated` — Boolean (streaming test passed)
- `largePromptSmokeValidated` — Boolean (large prompt test passed)
- `checks` — Array of individual check results

**Example:**
```bash
curl http://localhost:3000/api/gateway-test?stage=2
# Response:
{
  "status": "ok",
  "detail": "Gateway inference test passed",
  "responseTime": 2450,
  "outputTokens": 156,
  "responseSmokeValidated": true,
  "streamSmokeValidated": true,
  "largePromptSmokeValidated": true
}
```

## Pi Provider Adapter Testing

The **Pi provider adapter** translates kaseki-agent's requests into the LLM gateway's native API format. This test validates that responses are correctly parsed.

### When to Use

- **Development:** Optional; useful for debugging response format issues
- **Production:** Recommended before deploying to ensure responses are parseable
- **Cloudflare Gateway:** **Highly recommended** — Cloudflare Chat Completions API uses unique response fields

### Query Parameters

- `?piProvider=true` — Enable Pi provider adapter smoke test
- `?debug=true` — Collect full response diagnostics (for troubleshooting)

### Example: Cloudflare Gateway Test

```bash
# Test Pi provider with Cloudflare gateway
curl "http://localhost:3000/api/gateway-test?stage=2&piProvider=true"

# With debug diagnostics
curl "http://localhost:3000/api/gateway-test?stage=2&piProvider=true&debug=true"
```

### Response Structure

When Pi provider adapter is tested, responses include a `piProviderSmoke` object:

```json
{
  "status": "ok",
  "piProviderSmoke": {
    "status": "ok",
    "detail": "Pi gateway provider produced assistant text (524ms)",
    "responseTime": 524,
    "assistantTextChars": 287,
    "outputEventCount": 12
  }
}
```

### Error Responses with Diagnostics

When the Pi provider adapter test fails, detailed diagnostics are provided:

```json
{
  "status": "ok",
  "piProviderSmoke": {
    "status": "error",
    "detail": "Pi provider smoke completed but produced no assistant text",
    "responseTime": 523,
    "diagnostics": {
      "fieldsSearched": [
        "message.text",
        "message.output_text",
        "message.assistantMessage",
        "message.content (string)",
        "message.choices[0].message.content",
        "message.choices[0].delta.content",
        "message.response.content"
      ],
      "fieldsFound": ["message.content", "message.role"],
      "eventsByType": {
        "content_block_start": 1,
        "content_block_delta": 3,
        "content_block_stop": 1,
        "message_stop": 1
      },
      "eventsWithText": 3,
      "suggestedPatterns": ["message.content (string)", "message.choices[0].message.content"],
      "sampleEventStructure": [
        {
          "type": "content_block_start",
          "content_block": {
            "type": "string(45)",
            "index": "number"
          }
        }
      ],
      "remediation": "Found response fields but text not extracted. Try patterns: message.content (string), message.choices[0].message.content. Check Pi provider registration and gateway response format."
    }
  }
}
```

### Diagnostic Fields Explained

| Field | Purpose |
|---|---|
| `fieldsSearched` | All field patterns the text extractor checks |
| `fieldsFound` | Actual fields present in gateway response |
| `eventsByType` | Count of each event type in Pi JSONL response |
| `eventsWithText` | Number of events containing extracted text |
| `suggestedPatterns` | Recommended field patterns to try |
| `sampleEventStructure` | Sanitized structure of first few events (type signatures, no sensitive data) |
| `remediation` | Actionable next steps for fixing the issue |

## Troubleshooting

### Issue: "No assistant text found"

**Diagnosis:** Pi provider extracted 0 characters from response

**Steps:**
1. Check `fieldsFound` in diagnostics — are there any fields detected?
2. Check `suggestedPatterns` — which response format is the gateway using?
3. Verify `.pi-extensions.js` has the correct `api: 'openai-completions'` configuration

**For Cloudflare:**
```javascript
// .pi-extensions.js should have:
{
  api: 'openai-completions',  // IMPORTANT: uses /chat/completions
  baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR-ACCOUNT/ai/run/...',
  apiKey: 'your-cf-token',
}
```

### Issue: "Fields found but text not extracted"

**Diagnosis:** Response contains data but extractor doesn't recognize the field names

**Steps:**
1. Check `fieldsFound` — does it include the field you expect?
2. Check `suggestedPatterns` — this shows fields the extractor knows about
3. Open a GitHub issue with the `sampleEventStructure` output so we can add support for your gateway

### Issue: "No response fields found"

**Diagnosis:** Gateway response is malformed or not a valid JSONL

**Steps:**
1. Verify gateway is reachable (Stage 1 test passes)
2. Check `eventsByType` in diagnostics — are there any events?
3. Verify `LLM_GATEWAY_URL` and `LLM_GATEWAY_API_KEY` environment variables
4. Run `npm run doctor` to check configuration

### Issue: "Event types seen but no text"

**Diagnosis:** Response has events but they don't contain text fields

**Steps:**
1. Compare `eventsByType` with gateway documentation
2. Look at `sampleEventStructure` to see actual event shapes
3. Check if gateway is in streaming vs. non-streaming mode
4. Verify prompt or model is correct (some models may not respond)

## Response Format Reference

### Chat Completions API (OpenAI, Cloudflare, others)

Standard response structure:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "response text here"
      }
    }
  ]
}
```

**Field extraction:** `message.choices[0].message.content`

### Cloudflare Chat Completions API

Cloudflare variant with direct content field:

```json
{
  "message": {
    "content": "response text here",
    "role": "assistant"
  }
}
```

**Field extraction:** `message.content (string)`

### Pi Provider Native Format

Pi CLI's native response format (JSONL stream):

```jsonl
{"type": "content_block_start", "content_block": {"type": "text", "text": ""}}
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "response text"}}
{"type": "message_stop", "message": {"content": [{"type": "text", "text": "full response"}]}}
```

**Field extraction:** Multiple patterns supported

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `LLM_GATEWAY_URL` | — | LLM gateway API endpoint (required) |
| `LLM_GATEWAY_API_KEY` | — | API authentication key (required) |
| `KASEKI_GATEWAY_MODEL` | openrouter/free | Model to use for testing |
| `KASEKI_GATEWAY_TIMEOUT` | 30000 | Test timeout in milliseconds |

### Pi Provider Registration

Edit `.pi-extensions.js` to register your gateway:

```javascript
module.exports = {
  providers: {
    gateway: {
      model: 'your-model-name',
      api: 'openai-completions',  // Chat Completions format
      baseUrl: process.env.LLM_GATEWAY_URL,
      apiKey: process.env.LLM_GATEWAY_API_KEY,
      maxTokens: 8192,
    },
  },
};
```

**Key:** `api: 'openai-completions'` tells Pi CLI to append `/chat/completions` to the configured `/compat` base URL.

## Testing Checklist

Use this checklist before deploying kaseki-agent to production:

- [ ] Stage 1 test passes (gateway connectivity)
- [ ] Stage 2 test passes (inference and response parsing)
- [ ] Pi provider adapter test passes with `?piProvider=true`
- [ ] Large prompt test passes (check `largePromptSmokeValidated`)
- [ ] Stream parsing test passes (check `streamSmokeValidated`)
- [ ] Response quality is acceptable (review `outputTokens`)
- [ ] Response time is within SLA (check `responseTime`)
- [ ] All diagnostic fields are expected (no surprises in `fieldsFound`)

## Examples

### Example 1: Basic Connectivity Check

```bash
# Quick connectivity check
curl http://localhost:3000/api/gateway-test?stage=1

# Expected output:
# {
#   "status": "ok",
#   "authenticationValidated": true,
#   "responseTime": 150
# }
```

### Example 2: Full Production Validation

```bash
# Full validation with Pi provider adapter
curl "http://localhost:3000/api/gateway-test?stage=2&piProvider=true"

# Check response:
# - status: ok
# - responseSmokeValidated: true
# - streamSmokeValidated: true
# - largePromptSmokeValidated: true
# - piProviderSmoke.status: ok
```

### Example 3: Debugging Cloudflare Gateway

```bash
# Test with full diagnostics
curl "http://localhost:3000/api/gateway-test?stage=2&piProvider=true&debug=true"

# If fails, check:
# - piProviderSmoke.diagnostics.fieldsFound
# - piProviderSmoke.diagnostics.suggestedPatterns
# - piProviderSmoke.remediation
```

### Example 4: Integration with CI/CD

```bash
#!/bin/bash
# Deploy test: verify gateway before starting kaseki runs

RESPONSE=$(curl -s http://localhost:3000/api/gateway-test?stage=2&piProvider=true)

if [[ $(echo "$RESPONSE" | jq -r '.piProviderSmoke.status') == "ok" ]]; then
  echo "✅ Gateway test passed, proceeding with deployment"
  exit 0
else
  echo "❌ Gateway test failed"
  echo "$RESPONSE" | jq '.piProviderSmoke.diagnostics'
  exit 1
fi
```

## See Also

- [ENV_VARS.md](ENV_VARS.md) — Complete environment variable reference
- [DEPLOYMENT.md](DEPLOYMENT.md) — Deployment and setup guide
- [EXIT_CODES.md](EXIT_CODES.md) — Kaseki run exit codes and troubleshooting
- [docs/API.md](API.md) — Complete API reference
