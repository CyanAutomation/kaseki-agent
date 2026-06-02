# Goal-Setting Agent Guide

## Overview

The goal-setting agent is the first stage in the Kaseki pipeline. It takes a user's raw task prompt and upgrades it into a mature, specific goal that sets expectations for the downstream scouting and coding agents.

**Default Behavior**: Goal-setting is **enabled by default**. To disable it, set `KASEKI_GOAL_SETTING=0`.

**Pipeline Position**:

```
User Prompt → Goal-Setting Agent → Scouting → Coding Loop → Goal-Check → Run Evaluation
```

## Why Goal-Setting?

According to [OpenAI's Codex guidance](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex), well-formed goals dramatically improve agent success rates by:

1. **Reducing ambiguity** — Vague prompts like "fix the parser" become specific: "Handle null values in parseRole() and add test coverage for edge cases"
2. **Setting success criteria** — Agents know when they're done ("all tests pass" vs. "make it better")
3. **Preventing scope creep** — Clear constraints prevent unintended changes
4. **Improving validation** — Post-goal-check evaluation becomes more accurate

**📖 See Also**:

- [Goal-Setting Improvements Guide](./GOAL_SETTING_IMPROVEMENTS.md) — Enhanced goal quality scoring, anti-pattern extraction, SMART criteria validation, and feedback loop infrastructure
- [Evaluation Best Practices](./EVALUATION_BEST_PRACTICES.md) — How goal-check and run-evaluation phases leverage goal-setting output to produce high-quality verdicts grounded in OpenAI best practices
- [Feedback Loop Integration](./FEEDBACK_LOOP_INTEGRATION.md) — How evaluation verdicts feed back into goal quality scoring and Kaseki process improvements

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

Goal-setting writes `/results/goal-setting.json` with comprehensive goal metadata:

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
    {
      "criterion": "All existing tests pass",
      "smart_score": "high",
      "reasoning": "clearly measurable via test output"
    },
    {
      "criterion": "New tests added for null/undefined cases",
      "smart_score": "high",
      "reasoning": "specific count (edge cases) and verifiable"
    },
    {
      "criterion": "No TypeErrors in parseRole()",
      "smart_score": "high",
      "reasoning": "binary outcome, testable"
    }
  ],
  "anti_patterns": {
    "do_not_modify": ["src/generated/**", "src/codegen/**"],
    "do_not_break": ["parser API surface", "backward compatibility"],
    "must_preserve": ["error message formats"]
  },
  "constraints": {
    "operational": ["max 3 files changed", "single run"],
    "architectural": ["respect parser module boundaries"],
    "technical": ["must pass TypeScript checks", "100% test pass rate"],
    "business": ["maintain existing behavior for valid inputs"]
  },
  "examples": {
    "before": "parseRole(null) → TypeError",
    "after": "parseRole(null) → {name: 'Unnamed Role'}"
  },
  "quality_metrics": {
    "clarity": "high",
    "measurability": "high",
    "specificity": "high",
    "scope_clarity": "high",
    "constraint_strength": "high"
  },
  "reasoning": "Original prompt was vague. Upgraded with specific issue (null handling), measurable success criteria (test counts), explicit anti-patterns (don't modify generated files), and clear scope.",
  "confidence": "high"
}
```

**Note**: The schema supports both new (object-based) and legacy (string-based) formats for backward compatibility.
Also logged: `/results/goal-setting-validation-notes.txt` (warnings), `/results/goal-setting-validation-errors.jsonl` (errors)

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

## Test Updates in Goals

When your task involves modifying **parsers, events, response construction, or serializers**, the goal-setting agent will automatically detect this and include **test-update success criteria** in the refined goal.

### Why Test Updates Matter

Code changes in these areas almost always require corresponding test assertion updates:

| Code Change | Test Updates Needed | Why |
|---|---|---|
| Parser logic (null handling, input validation) | ✅ Yes | Assertion expectations for input/output change |
| Event handling (field names, timing) | ✅ Yes | Event structure or behavior expectations shift |
| Response construction (format, serialization) | ✅ Yes | Serialization format or field mapping changes |
| Naming conventions (variable/function names) | ✅ Yes | String literal assertions must match new names |

### Examples of Good Test-Update Criteria

✅ **Parser Changes**:

```
"Add 4 tests for null/empty/whitespace role handling in tests/parser.test.ts (lines 120-150). Expected behavior: null → {name: 'Unnamed Role'}, empty → {name: 'Unnamed Role'}."
```

✅ **Event Changes**:

```
"Update 2-3 event assertions in tests/event-handler.test.ts for new async behavior (lines 200-220). Expect event.timestamp field and timing within 50ms instead of 10ms."
```

✅ **Response Format Changes**:

```
"Add round-trip serialization test: serialize new format, deserialize, verify field mapping matches. 3-5 test cases in tests/serialization.test.ts."
```

### What Goal-Setting Does

When the goal-setting agent detects parser/event/response changes in your prompt:

1. It automatically includes test-update criteria in the refined goal
2. It flags these as **success criteria** (measurable, specific, achievable)
3. The scouting agent identifies which test files are affected and what assertions need updating
4. The coding agent receives examples of how to update test assertions
5. Goal-check validates that tests were actually updated

### Disabling Auto-Injection (Advanced)

If goal-setting incorrectly identifies test updates as necessary, explicitly disable in your prompt:

```
"Fix parser logic (null handling). Do not add or modify any tests."
```

The goal-setting agent respects explicit "do not" clauses even when automatic detection would suggest otherwise.

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
