# Kaseki-170 Implementation Integration Guide

## Overview

This guide explains how to integrate the TDD-based fixes into the kaseki-agent and LLM gateway systems to prevent and debug empty assistant turns.

## Architecture

### Three Integration Points

```
User Request
    ↓
LLM Gateway
    │
    ├─→ Receive request
    ├─→ [NEW] Validate response before returning
    ├─→ Return response to Pi CLI
    │
    ↓
Pi CLI (via kaseki-agent)
    │
    ├─→ Receive response
    ├─→ [NEW] Log diagnostics if error detected
    ├─→ Process response
    │
    ↓
Kaseki-Agent Results
    │
    ├─→ /results/provider-diagnostics.jsonl [NEW]
    ├─→ /results/metadata.json (existing)
    ├─→ /results/failure.json (existing)
```

## Phase 1: Gateway Adapter Changes

### File: Gateway `adapters/openai-responses.ts` (or equivalent)

Add response validation before returning to Pi CLI:

```typescript
import { validateProviderResponse } from 'kaseki-agent/provider-response-validation';

async function handleResponse(response: any): Promise<any> {
  // ... existing code ...

  // [NEW] Validate response structure
  const validation = validateProviderResponse(response);
  if (!validation.valid) {
    // Convert validation errors to clear error response
    const errors = validation.errors.join('; ');
    throw new ValidationError(
      'invalid_response_structure',
      `Response validation failed: ${errors}. This indicates a provider or adapter bug. ` +
      `Response ID: ${response.response_id}`,
      response
    );
  }

  // [NEW] Log warnings
  if (validation.warnings.length > 0) {
    console.warn('Response validation warnings:', validation.warnings);
  }

  return response;
}
```

### What This Prevents

- Silent failures where HTTP 200 is returned with empty content
- Undetected bugs in response serialization
- Lost debugging information

### How to Test

```bash
# Simulate kaseki-170 response
curl -X POST https://manifest.scheimann.xyz/v1/responses \
  -H "Authorization: Bearer mnfst_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "input": "Analyze this file",
    "store": false
  }' | jq .

# Should return clear error if response is malformed
# Before: HTTP 200 with empty content (silent failure)
# After: HTTP 400/422 with validation error (explicit failure)
```

## Phase 1B: Kaseki-Agent Integration

### File: `src/kaseki-api-service.ts` (or startup code)

Initialize the diagnostics logger:

```typescript
import { initializeProviderDiagnosticsLogger } from './provider-diagnostics-logger';

// In service initialization
const resultsDir = process.env.KASEKI_RESULTS_DIR || '/results';
const diagnosticsLogger = initializeProviderDiagnosticsLogger(resultsDir);

// Export for use in other modules
export { getProviderDiagnosticsLogger } from './provider-diagnostics-logger';
```

### File: `src/pi-event-filter.ts` (where empty assistant is detected)

Add diagnostic logging when empty assistant turns are detected:

```typescript
import { getProviderDiagnosticsLogger } from './provider-diagnostics-logger';

function extractEmptyAssistantTurn(event: PiEvent, states: Map<string, AssistantTurnState>): ProviderErrorSummary | null {
  // ... existing detection code ...

  if (emptyAssistantDetected) {
    // [NEW] Log diagnostic
    const logger = getProviderDiagnosticsLogger();
    logger.logEmptyAssistantTurn(
      extractPhaseFromContext(), // 'scouting', 'coding', etc.
      message.provider,
      message.api,
      message.model,
      inputTokens,
      outputTokens,
      responseId,
      event // full event for debugging
    );

    // [EXISTING] Return provider error
    return {
      type: 'provider_empty_assistant_turn',
      // ... existing fields ...
    };
  }

  return null;
}
```

## Phase 2: Graceful Fallback (Optional but Recommended)

### For Scouting Failures

In `kaseki-agent.sh` or equivalent orchestration code:

```bash
# If scouting fails with empty assistant turn
if [ "$PROVIDER_ERROR_TYPE" = "provider_empty_assistant_turn" ]; then
  echo "==> Scouting failed with empty assistant turn"
  echo "==> Attempting fallback: using original task prompt"
  
  # Create fallback scouting candidate
  cat > "$RESULTS_DIR/scouting-candidate.json" <<'EOF'
{
  "original_prompt": "...",
  "scouting_fallback": true,
  "reason": "scouting_provider_empty_assistant_turn",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  
  # Continue to main agent phase with fallback
  SCOUTING_FAILED="yes"
  USING_SCOUTING_FALLBACK="yes"
fi
```

## Phase 3: Monitoring & Observability

### Prometheus Metrics (Optional)

```typescript
import { register, Counter } from 'prom-client';

const providerEmptyAssistantCounter = new Counter({
  name: 'provider_empty_assistant_turns_total',
  help: 'Total number of empty assistant turns from providers',
  labelNames: ['provider', 'api', 'model', 'phase'],
});

// In error logging
providerEmptyAssistantCounter.labels(
  provider,
  api,
  model,
  phase
).inc();
```

### Dashboard Query (Grafana)

```promql
# Alert if more than 1 empty assistant error per hour
rate(provider_empty_assistant_turns_total[1h]) > 0
```

## File Integration Checklist

### Must Have (Phase 1)

- [x] `src/provider-response-validation.ts` - Core validation logic
- [x] `src/provider-response-validation.test.ts` - Unit tests
- [x] `src/provider-diagnostics-logger.ts` - Structured logging
- [x] `src/provider-diagnostics-logger.test.ts` - Unit tests
- [ ] Integration in `src/pi-event-filter.ts` - Use detection
- [ ] Integration in gateway adapter - Response validation
- [ ] Integration in startup - Initialize logger

### Nice to Have (Phase 2)

- [ ] Graceful fallback in orchestration
- [ ] Conditional model retry (model=auto → gpt-4)
- [ ] Provider health check endpoint
- [ ] Prometheus metrics
- [ ] Grafana dashboard
- [ ] PagerDuty alerts

## Testing Integration

### Unit Tests (Already Complete)

```bash
npm test -- src/provider-response-validation.test.ts
npm test -- src/provider-diagnostics-logger.test.ts
npm test -- test/empty-assistant-turn.test.ts
npm test -- test/kaseki-170-integration.test.ts
```

### Integration Test

```bash
# Simulate kaseki-170 scenario
KASEKI_MODEL=auto ./run-kaseki.sh

# Expect: /results/provider-diagnostics.jsonl to contain error
# Check: Response ID matches gateway logs
# Verify: Clear debugging instructions in stderr
```

### End-to-End Test

```bash
# Run actual scouting that triggers gateway
TASK_PROMPT="Analyze this code" ./run-kaseki.sh

# If gateway returns empty assistant:
# 1. See provider-diagnostics.jsonl with response_id
# 2. Exit code 86 (provider error)
# 3. Clear error message in result-summary.md
# 4. Full response available in diagnostics for debugging
```

## Debugging Workflow After Integration

### Step 1: Run fails with exit code 86

```bash
$ ./run-kaseki.sh
...
[ERROR] Pi provider error: exit 86
```

### Step 2: Check diagnostics file

```bash
$ cat /results/provider-diagnostics.jsonl | jq .

{
  "timestamp": "2026-06-24T21:23:27Z",
  "phase": "scouting",
  "provider": "gateway",
  "api": "openai-responses",
  "model": "auto",
  "responseId": "resp_4e859d2bfb3a457cb34d1e485d0b2958",
  "outputTokens": 146,
  "errorType": "empty_assistant_turn",
  "errorMessage": "Provider returned... but with zero assistant content",
  "suggestedAction": "Check LLM gateway (manifest.scheimann.xyz)...",
  "fullResponseBody": "{...full response for inspection...}"
}
```

### Step 3: Trace in gateway logs

Using the response_id from diagnostics:

```bash
# In gateway container/service
grep "resp_4e859d2bfb3a457cb34d1e485d0b2958" /var/log/gateway.log

# Look for:
# - Response serialization
# - message.content assignment
# - Adapter-specific processing
# - Field truncation or loss
```

### Step 4: Review metadata

```bash
$ cat /results/metadata.json | jq .provider_errors

{
  "provider_errors": [{
    "type": "provider_empty_assistant_turn",
    "provider": "gateway",
    "api": "openai-responses",
    "response_id": "resp_4e859d2bfb3a457cb34d1e485d0b2958",
    "input_tokens": 9019,
    "output_tokens": 146,
    "message": "Provider returned a successful stop response..."
  }]
}
```

## Success Indicators

After integration, you should see:

✅ **Clear Error Messages**: Instead of silent empty content failures  
✅ **Structured Logging**: provider-diagnostics.jsonl with full context  
✅ **Response ID Tracing**: Can match to gateway logs  
✅ **Actionable Suggestions**: How to debug based on error type  
✅ **No Regressions**: All existing tests still pass  
✅ **Better Observability**: Can detect and monitor provider issues

## Rollback Plan

If something breaks during integration:

1. Remove diagnostics logger initialization
2. Remove validation from gateway adapter
3. Remove provider-diagnostics-logger.ts and related files
4. Redeploy

The existing empty assistant detection in pi-event-filter.ts will still work; it just won't log diagnostics.

## Next Steps

1. **Review** this implementation with team
2. **Test** in staging with gateway changes
3. **Deploy** gateway response validation first
4. **Deploy** kaseki-agent diagnostics logging
5. **Re-run** kaseki-170 to verify fix works
6. **Monitor** next 20 runs for regressions
7. **Implement** Phase 2 features (fallback, retry, monitoring)

## Questions?

- Response validation logic: See `src/provider-response-validation.ts`
- Diagnostics logging: See `src/provider-diagnostics-logger.ts`
- Integration examples: See `test/kaseki-170-integration.test.ts`
- Gateway integration: See comments in integration guide above
