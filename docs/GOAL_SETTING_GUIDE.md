# Goal-Setting Agent Guide

## Overview

The goal-setting agent is the first stage in the Kaseki pipeline. It takes a user's raw task prompt and upgrades it into a mature, specific goal that sets expectations for the downstream scouting and coding agents.

**Default Behavior**: Goal-setting is **enabled by default**. To disable it, set `KASEKI_GOAL_SETTING=0`.

**Pipeline Position**: 
```
User Prompt → Goal-Setting Agent → Scouting → Coding Loop → Goal-Check → Run Evaluation
```

## Why Goal-Setting?

According to [OpenAI's Codex guidance](https://developers.openrouter.ai/docs/guides/model-selection), well-formed goals dramatically improve agent success rates by:

1. **Reducing ambiguity** — Vague prompts like "fix the parser" become specific: "Handle null values in parseRole() and add test coverage for edge cases"
2. **Setting success criteria** — Agents know when they're done ("all tests pass" vs. "make it better")
3. **Preventing scope creep** — Clear constraints prevent unintended changes
4. **Improving validation** — Post-goal-check evaluation becomes more accurate

## What Makes a Good Goal?

A high-quality goal has these characteristics:

### 1. **Clarity**
- ✅ Good: "Refactor the authentication middleware to use JWT tokens instead of session cookies, and ensure backward compatibility with existing API clients."
- ❌ Poor: "Fix the auth system"

### 2. **Measurability**
- ✅ Good: "Add 5 new test cases to cover password validation edge cases (empty, too long, special characters), ensuring 100% line coverage on the validator."
- ❌ Poor: "Improve test coverage"

### 3. **Context**
- ✅ Good: "Migrate from deprecated `npm-shrinkwrap.json` to `package-lock.json` to align with Node.js ecosystem standards and reduce dependency conflicts."
- ❌ Poor: "Update lockfile"

### 4. **Constraints**
- ✅ Good: "Fix TypeScript errors in src/api/ WITHOUT modifying any generated GraphQL files or altering the API schema."
- ❌ Poor: "Fix TypeScript errors"

### 5. **Scope**
- ✅ Good: "Add error handling to the payment gateway module (src/payments/) for network timeouts, rate limits, and invalid responses. Do not modify the merchant configuration system (src/merchant/)."
- ❌ Poor: "Add error handling"

## Configuration

### Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `KASEKI_GOAL_SETTING` | `1` (enabled) | Set to `0` to disable goal-setting |
| `KASEKI_GOAL_SETTING_MODEL` | same as `KASEKI_SCOUTING_MODEL` | Optional Pi model override (e.g., `openrouter/anthropic/claude-3-opus`) |
| `KASEKI_GOAL_SETTING_TIMEOUT_SECONDS` | `300` | Max seconds for goal-setting agent (typically fast, read-only phase) |

### API Request Example

```json
{
  "repoUrl": "https://github.com/user/repo",
  "ref": "main",
  "taskPrompt": "Fix the bug in user authentication",
  "goalSetting": {
    "enabled": true,
    "model": "openrouter/anthropic/claude-3-opus",
    "timeoutSeconds": 300
  }
}
```

### Shell Execution Example

```bash
export KASEKI_GOAL_SETTING=1
export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus
export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=300
export TASK_PROMPT="Fix the user login flow to handle rate limiting"

./run-kaseki.sh kaseki-1
```

## How Goal-Setting Works

### 1. **Prompt Analysis**
The goal-setting agent reads the raw `TASK_PROMPT` and analyzes:
- What problem is being solved?
- What are implicit success criteria?
- Are there hidden constraints or edge cases?
- Is the scope clear?

### 2. **Goal Upgrade**
The agent creates a structured goal with:
- **Upgraded Goal**: A refined, specific 1-3 sentence goal statement
- **Key Requirements**: Critical constraints and dependencies
- **Success Criteria**: Measurable indicators of completion
- **Potential Constraints**: Operational guardrails (e.g., "don't modify X files")
- **Reasoning**: Why the upgrade was made

### 3. **Prompt Replacement**
If goal-setting succeeds, the upgraded goal **replaces** the original `TASK_PROMPT` in all downstream agents (scouting, coding, goal-check).

If goal-setting fails (transient error), the original prompt is used. If it fails deterministically, the original prompt is used without retry.

### 4. **Artifact Output**
Goal-setting writes `/results/goal-setting.json`:

```json
{
  "original_prompt": "Fix the parser bug",
  "upgraded_goal": "Fix the parseRole() function to safely handle null and undefined values, preventing TypeErrors when FriendlyName is missing. Add test coverage for edge cases.",
  "key_requirements": [
    "Handle null/undefined FriendlyName values",
    "Preserve existing parser behavior for valid inputs",
    "Add test cases for edge scenarios"
  ],
  "success_criteria": [
    "All existing tests pass",
    "New tests added for null/undefined cases",
    "No TypeErrors in parseRole()"
  ],
  "potential_constraints": [
    "Do not modify the parser schema",
    "Do not break backward compatibility"
  ],
  "reasoning": "The original prompt was vague about what 'fix' means. This upgrade clarifies the specific issue (null handling), adds measurable success criteria, and defines scope boundaries.",
  "confidence": "high"
}
```

## Disabling Goal-Setting

To skip goal-setting and run directly with your original prompt:

```bash
export KASEKI_GOAL_SETTING=0
./run-kaseki.sh
```

Or via API:

```bash
curl -X POST http://localhost:8080/run \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo",
    "taskPrompt": "Your raw prompt here",
    "goalSetting": {
      "enabled": false
    }
  }'
```

## Failure Modes

### Transient Failure (Retried)
- **Timeout** (124 exit code) — goal-setting took too long
- **API error** — OpenRouter rate limit or temporary outage
- **Network error** — Connection lost mid-response

**Action**: Retried once automatically. If still fails, original prompt is used.

### Deterministic Failure (Not Retried)
- **Malformed JSON** — Agent returned invalid JSON
- **Missing required fields** — Goal output incomplete
- **Schema mismatch** — Output doesn't match expected structure

**Action**: Original prompt is used; pipeline continues without retry.

### Configuration Error (Not Retried)
- **Missing API key** — `OPENROUTER_API_KEY` not set
- **Invalid model** — Requested model not available

**Action**: Original prompt is used; pipeline continues.

## Best Practices

### ✅ DO

- **Be specific**: Include concrete examples in your prompt
- **Define success**: Mention test coverage, acceptance criteria, or validation steps
- **Set scope**: Explicitly say what should NOT be changed
- **Add context**: Explain the business or technical reason for the change

### ❌ DON'T

- **Use vague verbs**: Avoid "fix", "improve", "handle" without context
- **Assume knowledge**: The agent doesn't know your project internals
- **Mix multiple tasks**: One goal per run; use separate runs for different concerns
- **Ignore edge cases**: Mention known limitations or tricky scenarios upfront

## Examples

### ❌ Poor Prompt

```
"Fix all TypeScript errors"
```

### ✅ Good Upgraded Goal

```
"Fix TypeScript compilation errors in src/api/ by updating type annotations for async/await functions and Request/Response objects. Ensure the build passes with zero errors. Do not modify src/generated/ (auto-generated files)."
```

---

### ❌ Poor Prompt

```
"Optimize the search function"
```

### ✅ Good Upgraded Goal

```
"Optimize the full-text search function (src/search.ts) to use database indexes instead of in-memory filtering. Performance target: query time <100ms for 10k documents. Preserve existing API surface; all tests must pass."
```

---

### ❌ Poor Prompt

```
"Update dependencies"
```

### ✅ Good Upgraded Goal

```
"Update npm dependencies to the latest versions using 'npm update'. Prioritize security patches. Ensure all tests pass after update. If update breaks anything, revert only the breaking dependency and document the issue in a comment."
```

## Monitoring

### Check Goal-Setting Status

```bash
# View the generated goal
cat /results/goal-setting.json | jq .

# Check if it was skipped or failed
cat /results/goal-setting-stderr.log

# View all goal-setting events
cat /results/goal-setting-events.jsonl | jq .
```

### Compare Original vs. Upgraded

```bash
cat /results/goal-setting.json | jq '{original: .original_prompt, upgraded: .upgraded_goal}'
```

## Troubleshooting

### Goal-Setting Times Out

**Symptom**: `[Goal-Setting Phase] Transient failure detected (exit 124)`

**Solutions**:
1. Increase timeout: `export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600`
2. Use a faster model: `export KASEKI_GOAL_SETTING_MODEL=openrouter/free`
3. Disable goal-setting: `export KASEKI_GOAL_SETTING=0`

### Goal-Setting Produces Confusing Goals

**Symptom**: Upgraded goal doesn't match your intent

**Solutions**:
1. Your original prompt was too vague. Be more specific in `TASK_PROMPT`.
2. Disable goal-setting and try again: `export KASEKI_GOAL_SETTING=0`
3. Use a different model: `export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus`

### API Key Missing for Goal-Setting Only

**Symptom**: Goal-setting fails, but scouting/coding work fine

**Cause**: `OPENROUTER_API_KEY` not propagated to goal-setting phase

**Solution**: Ensure API key is set before pipeline starts:
```bash
export OPENROUTER_API_KEY_FILE=$HOME/.kaseki/secrets.json
# or
export OPENROUTER_API_KEY=sk-or-...
```

## Advanced: Custom Goal-Setting Models

To use a specific model for goal-setting only (different from scouting):

```bash
export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus
export KASEKI_SCOUTING_MODEL=openrouter/free
export KASEKI_MODEL=openrouter/free

./run-kaseki.sh
```

This allows you to spend more on the goal-setting phase (better model) while keeping scouting/coding cheaper.

## See Also

- [ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) — Complete environment variable reference
- [QUALITY_GATES.md](QUALITY_GATES.md) — Goal-setting output validation
- [OpenAI Codex Best Practices](https://developers.openrouter.ai/docs/guides/model-selection) — Reference on goal design
