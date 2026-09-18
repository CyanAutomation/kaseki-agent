# Goal-Setting Phase Exit Codes & Debugging

## Overview

The goal-setting phase is an optional pre-scouting step that upgrades the user's task prompt into a more structured, achievable goal. This document explains:

- How exit codes are classified (transient vs deterministic)
- When retries occur and when they don't
- How to debug failures using structured logs
- Common failure patterns and solutions

## Exit Code Classification

### Success (0)

- Goal-setting agent produced a valid upgraded goal
- Run proceeds with upgraded goal replacing original TASK_PROMPT
- Downstream agents (scouting, coding) use the upgraded goal

### Transient Failures (Retried Once)

These are failures that may succeed if retried:

- **Exit 124**: Timeout (goal-setting took too long)
  - Caused by: Slow model response, large prompt, network latency
  - Action: Retried immediately with same configuration
  - Fix: Increase `KASEKI_GOAL_SETTING_TIMEOUT_SECONDS` or use faster model

- **Generic Exit 1 with transient indicators**: Rare transient Pi errors
  - Caused by: Temporary API outage, rate limiting, connection reset
  - Indicators in stderr: "timeout", "429", "503", "ECONNRESET", "try again"
  - Action: Retried immediately
  - Fix: May resolve on next attempt; if persistent, check API status

### Deterministic Failures (Not Retried)

These will produce the same result if retried, so they don't retry:

- **Exit 2**: Missing configuration
  - Caused by: Missing `OPENROUTER_API_KEY`, invalid model name
  - Action: Fallback to original TASK_PROMPT; run continues
  - Fix: Set `OPENROUTER_API_KEY` or `KASEKI_GOAL_SETTING_MODEL`

- **Exit 86**: Artifact validation error
  - Caused by: Goal-setting returned invalid JSON or missing required fields
  - Indicators: Schema errors, malformed JSON, empty goals
  - Action: Fallback to original TASK_PROMPT; run continues with confidence=low
  - Fix: Check `goal-setting-validation-errors.jsonl` for field-level errors

- **Exit 88**: Provider/model error
  - Caused by: Model not available, API deprecation, LLM Gateway misconfiguration
  - Indicators: "model not found", "unavailable", "deprecated"
  - Action: Fallback to original TASK_PROMPT; run continues
  - Fix: Check provider status; use different model or disable goal-setting

- **Exit 1 with deterministic indicators**: Pi agent error
  - Caused by: Agent crashed, infinite loop, invalid request format
  - Indicators in stderr: "schema", "validation", "malformed", "invalid json"
  - Action: Fallback to original TASK_PROMPT; run continues
  - Fix: Check `goal-setting-stderr.log` for specific error

## Retry Behavior

### When Retries Happen

```
Attempt 1 (exit code → transient check)
├─ transient? YES → retry
└─ timeout imminent (>85%)? YES → don't retry (let it timeout)

Attempt 2 (max attempts reached)
└─ regardless of exit code → stop retrying
```

### Retry Decision Logic

```bash
# New logic (as of June 2026)
case "$exit_code" in
  124) return 0  # Timeout - always transient
  86|88|2) return 1  # Known deterministic failures
  1)
    # Only retry exit 1 if stderr has transient keywords
    grep -qi "timeout|rate.?limit|429|503|ECONNRESET" && return 0 || return 1
    ;;
  *)
    # Unknown codes: only retry with strong transient evidence
    grep -qi "timeout|connection.*error|try.?again" && return 0 || return 1
    ;;
esac
```

**Key Change**: Previously, ANY non-zero exit code was retried. Now:
- Exit 1 is NOT automatically retried
- Requires explicit transient indicators in stderr
- Reduces false-positive retries for deterministic agent errors

## Debugging Goal-Setting Failures

### Step 1: Check goal-setting-stderr.log

This file contains captured stderr from Pi invocation(s):

```
[attempt 1 exit 1 duration 5.2s timestamp 2026-06-22T11:51:21.645Z]
Error message from Pi agent
...
[attempt 2 exit 1 duration 4.9s timestamp 2026-06-22T11:56:22.261Z]
Different error or same error
```

**What to look for**:
- Transient indicators: "timeout", "429", "503", "connection reset"
- Deterministic errors: "schema", "validation", "malformed json"
- Provider errors: "model not found", "rate limited", "unauthorized"

### Step 2: Check goal-setting-validation-errors.jsonl

When artifact validation fails, structured error details are logged:

```json
{
  "timestamp": "2026-06-22T11:51:21.645Z",
  "phase": "goal-setting",
  "exit_code": 86,
  "attempts": 2,
  "total_duration_seconds": 301,
  "timeout_seconds": 300,
  "model": "openrouter/free",
  "reason": "max_retry_attempts_exhausted",
  "stderr_tail": "Last 400 chars of stderr...",
  "fallback_to_original_prompt": true,
  "field_errors": [
    {
      "field": "upgraded_goal",
      "expected": "non-empty string",
      "actual": "null",
      "suggestion": "Pi agent returned incomplete JSON"
    }
  ]
}
```

### Step 3: Check goal-setting-metrics.json

Summary metrics for the entire phase:

```json
{
  "invoked_at": "2026-06-22T11:46:21.075Z",
  "completed_at": "2026-06-22T11:56:22.340Z",
  "duration_ms": 601265,
  "retry_count": 2,
  "success": false,
  "failure_reason": "GOAL_SETTING_TIMEOUT",
  "model": "openrouter/free",
  "timeout_seconds": 300
}
```

### Step 4: Check result-summary.md

Human-readable summary of the run:

```
## Goal-Setting Phase
Status: ⚠ FAILED (with fallback)
Attempts: 2/2 (max)
Total Duration: 10m 1s
Last Exit Code: 1 (Transient failure detected, max retries exhausted)
Fallback Strategy: Used original TASK_PROMPT
Confidence: low (goal-setting artifacts unavailable)
```

## Common Failure Patterns

### Pattern 1: Timeout Every Time (5 min = default timeout)

**Symptom**:
```
[attempt 1 exit 124 duration 300.0s]
[attempt 2 exit 124 duration 300.0s]
Max retry attempts exhausted (exit 124)
```

**Causes**:
- Model is too slow for this task
- Prompt is too complex or too long
- Network latency to LLM provider

**Solutions**:
1. Increase timeout: `export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600`
2. Use faster model: `export KASEKI_GOAL_SETTING_MODEL=openrouter/free`
3. Simplify TASK_PROMPT or disable goal-setting: `export KASEKI_GOAL_SETTING=0`

### Pattern 2: Immediate Exit 1 (Agent Crash)

**Symptom**:
```
[attempt 1 exit 1 duration 0.5s]
[attempt 2 exit 1 duration 0.5s]
```

**Causes**:
- Agent encountered exception early
- Invalid request format
- Crash during initialization

**Solutions**:
- Check `goal-setting-stderr.log` for stack trace
- Verify TASK_PROMPT is valid (< 10k chars)
- Try disabling goal-setting: `export KASEKI_GOAL_SETTING=0`

### Pattern 3: Validation Error (Exit 86)

**Symptom**:
```
[attempt 1 exit 86 duration 15.3s]
Deterministic failure (exit 86: GOAL_SETTING_VALIDATION_ERROR), not retrying
```

**Causes**:
- Pi agent returned invalid JSON
- Missing required fields (upgraded_goal, success_criteria, etc)
- Placeholder content instead of real goal

**Solutions**:
- Check `goal-setting-validation-errors.jsonl` for field-level errors
- Try different model: `export KASEKI_GOAL_SETTING_MODEL=...`
- Simplify original TASK_PROMPT

### Pattern 4: Provider Error (Exit 88)

**Symptom**:
```
stderr: "model openrouter/custom-model-123 not found"
[attempt 1 exit 88 duration 0.1s]
Deterministic failure (exit 88: GOAL_SETTING_PROVIDER_ERROR), not retrying
```

**Causes**:
- Invalid model string
- Model deprecated or removed
- API key invalid or revoked

**Solutions**:
- Use `openrouter/free` (free tier auto-selection)
- Check model name is correct
- Verify API key is valid
- Check provider status page

## Artifacts Generated

When goal-setting phase runs (regardless of success/failure):

| Artifact | When Generated | Purpose |
|----------|---|---|
| `goal-setting.json` | On success or fallback | Final goal artifact (required fields guaranteed valid) |
| `goal-setting-events.jsonl` | Always | Sanitized Pi events (think blocks removed) |
| `goal-setting-stderr.log` | On failure or provider error | Captured stderr from Pi invocation(s) |
| `goal-setting-validation-errors.jsonl` | On validation failure | Field-level error details |
| `goal-setting-metrics.json` | Always | Timing and retry metrics |
| `goal-setting-summary.json` | Always | Pi event summary (tokens, duration, model) |

## Environment Variables

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `KASEKI_GOAL_SETTING` | `1` | Enable/disable goal-setting phase |
| `KASEKI_GOAL_SETTING_MODEL` | (inherits from KASEKI_SCOUTING_MODEL) | Pi model override for goal-setting |
| `KASEKI_GOAL_SETTING_TIMEOUT_SECONDS` | `300` | Timeout for Pi agent |

### Tracking (Read-Only)

| Variable | Set By | Purpose |
|----------|--------|---------|
| `KASEKI_GOAL_SETTING_ATTEMPTS` | Shell script | Number of attempts made (1 or 2) |
| `KASEKI_GOAL_SETTING_SUCCEEDED_ON_ATTEMPT` | Shell script | Which attempt succeeded (empty if failed) |
| `GOAL_SETTING_FALLBACK_USED` | Shell script | Set to 1 if fallback artifact used |

## Performance Tips

### To speed up goal-setting:

1. **Use free model**:
   ```bash
   KASEKI_GOAL_SETTING_MODEL=openrouter/free
   ```

2. **Reduce prompt length**:
   - Keep TASK_PROMPT under 500 tokens
   - Be concise and specific
   - Remove examples if possible

3. **Disable if not needed**:
   ```bash
   KASEKI_GOAL_SETTING=0
   ```

### To improve goal quality:

1. **Use better model**:
   ```bash
   KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus
   ```

2. **Increase timeout** to allow more thought:
   ```bash
   KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600
   ```

3. **Write clear task prompt**:
   - Specific: "Fix null-safety in parseRole()" (not "improve parseRole()")
   - Measurable: "Add 5 edge-case tests" (not "better coverage")
   - Bounded: "Max 2 files" (to prevent scope creep)

## References

- [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md) - Full goal-setting guide
- [ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) - Environment variable reference
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - General troubleshooting
