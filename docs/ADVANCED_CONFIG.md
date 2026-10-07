# Advanced Configuration Reference

Complete documentation of all 60+ kaseki-agent configuration variables.

> **New to kaseki-agent?** Start with [docs/QUICK_START.md](QUICK_START.md) instead.
> **Looking for a quick reference?** See [.env.template](../.env.template) for Essential 8 variables.

---

## Table of Contents

1. [Essential 8 Variables](#essential-8-variables)
2. [Execution Zone](#execution-zone)
3. [Validation & Quality Gates Zone](#validation--quality-gates-zone)
4. [Baseline Test Failure Comparison (v2.8+)](#baseline-test-failure-comparison-v28)
5. [Caching & Performance Zone](#caching--performance-zone)
6. [Logging & Debugging Zone](#logging--debugging-zone)
7. [Monitoring Zone (Sentry)](#monitoring-zone-sentry)
8. [Infrastructure Zone (API Service)](#infrastructure-zone-api-service-only)
9. [GitHub Integration Zone](#github-integration-zone)
10. [Advanced & Experimental Zone](#advanced--experimental-zone)
11. [Configuration Precedence](#configuration-precedence)
12. [Variable Types & Validation](#variable-types--validation)

---

## Essential 8 Variables

These are the minimum variables needed for any setup path. All other variables have intelligent defaults.

### `LLM_GATEWAY_API_KEY_FILE`

- **Type**: `string` (file path)
- **Default**: `~/.kaseki/secrets.json`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Path to file containing the LLM Gateway API key
- **Security**: File must have mode `0600` (owner read/write only)
- **Example**:

  ```bash
  LLM_GATEWAY_API_KEY_FILE=$HOME/.kaseki/secrets.json
  ```

### `KASEKI_MODEL`

- **Type**: `string`
- **Default**: `dynamic/kaseki-agent`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: AI model to use for code generation
- **Options**:
  - `dynamic/kaseki-agent` — Default; the gateway resolves the model dynamically
  - Provider-specific model IDs (e.g., `openrouter/openai/gpt-4-turbo` for OpenRouter)
  - See your gateway or provider docs for the full model list
- **Example**:

  ```bash
  # Default (gateway resolves the model)
  KASEKI_MODEL=dynamic/kaseki-agent

  # Explicit provider model
  KASEKI_MODEL=openrouter/openai/gpt-4-turbo
  ```

### `KASEKI_VALIDATION_COMMANDS`

- **Type**: `string` (semicolon-separated command list)
- **Default**: `npm run check;npm run test;npm run build`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Commands to run after agent completes to validate changes
- **Behavior**:
  - Commands are run sequentially in the target repository
  - If a command doesn't exist (not defined in package.json), it's skipped (non-fatal by default)
  - Set `KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS=false` to fail on missing scripts
- **Examples**:

  ```bash
  # Node.js/npm projects (default)
  KASEKI_VALIDATION_COMMANDS=npm run check;npm run test;npm run build

  # Python projects
  KASEKI_VALIDATION_COMMANDS=pytest;mypy .

  # Rust projects
  KASEKI_VALIDATION_COMMANDS=cargo test;cargo fmt --check

  # Go projects
  KASEKI_VALIDATION_COMMANDS=go test ./...;go fmt ./...

  # Multi-language
  KASEKI_VALIDATION_COMMANDS=npm run test;python -m pytest;cargo test
  ```

### `KASEKI_VALIDATION_RUN_ALL_COMMANDS`

- **Type**: `boolean` (0 or 1)
- **Default**: `0`
- **Required**: Optional
- **Paths**: Single-run, Local API, Production API
- **Description**: Run all validation commands even if some fail (comprehensive validation mode)
- **Behavior**:
  - By default (`0`), validation stops at the first command failure (fail-fast mode)
  - When set to `1`, runs all validation commands, collects all failures
  - Useful for seeing all problems at once instead of fixing one and re-running
  - Sets `KASEKI_VALIDATION_FAIL_FAST=0` internally
  - Result summary notes whether comprehensive mode was used
- **Example**:

  ```bash
  # Run all tests even if one fails (comprehensive validation)
  KASEKI_VALIDATION_RUN_ALL_COMMANDS=1
  KASEKI_VALIDATION_COMMANDS=npm run check;npm run test;npm run lint
  ```

### `KASEKI_PRE_AGENT_VALIDATION`

- **Type**: `boolean`
- **Default**: `false`
- **Required**: Optional
- **Paths**: Single-run, Local API, Production API
- **Description**: Run validation commands before agent executes (to check baseline)
- **Use case**: Verify the target repository is in a healthy state before attempting changes
- **Behavior**:
  - If baseline validation fails, execution continues (doesn't block agent)
  - Both pre and post validation results are logged separately
  - Helps distinguish baseline failures from agent-caused failures
- **Example**:

  ```bash
  KASEKI_PRE_AGENT_VALIDATION=true
  ```

### `KASEKI_AGENT_TIMEOUT_SECONDS`

- **Type**: `number` (integer, positive)
- **Default**: `10800` (3 hours)
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Maximum time agent can run before being forcibly stopped
- **Behavior**:
  - Agent process is terminated if it exceeds this timeout
  - Exit code: `124` (timeout error)
  - Partially completed work is kept, validation doesn't run
- **Recommendations**:
  - Small/simple repos: `10800` (3 hours)
  - Medium repos: `2400` (40 min)
  - Large/complex repos: `3600` (1 hour)
  - Very large or complex tasks: `5400` (90 min)
- **Example**:

  ```bash
  KASEKI_AGENT_TIMEOUT_SECONDS=2400
  ```

### `KASEKI_MAX_DIFF_BYTES`

- **Type**: `number` (integer, positive)
- **Default**: `400000` (400 KB)
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Maximum allowed diff size (quality gate)
- **Behavior**:
  - If changes exceed this size, execution fails with exit code `4`
  - Prevents runaway agents from making too many changes
  - Check `quality.log` to see actual diff size
- **Recommendations**:
  - Normal changes: `400000` (400 KB)
  - Large refactors: `400000` (400 KB)
  - Very large refactors: `1000000` (1 MB)
- **Example**:

  ```bash
  KASEKI_MAX_DIFF_BYTES=400000
  ```

### `KASEKI_STREAM_PROGRESS`

- **Type**: `boolean`
- **Default**: `true`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Stream sanitized progress lines to stdout in real-time
- **Behavior**:
  - `true` (default): Show progress, useful for interactive use
  - `false`: Reduce output noise, useful in CI/CD
  - Progress events are always saved to `progress.jsonl` regardless
- **Example**:

  ```bash
  KASEKI_STREAM_PROGRESS=false  # For CI/CD pipelines
  ```

---

## Baseline Test Failure Comparison (v2.8+)

Variables controlling baseline test failure classification to distinguish pre-existing from newly-introduced failures.

### `KASEKI_BASELINE_VALIDATION_ENABLED`

- **Type**: `boolean`
- **Default**: `1` (enabled)
- **Options**: `0` (disabled), `1` (enabled)
- **Paths**: Single-run, Local API, Production API
- **Description**: Enable/disable automatic baseline validation on main branch
- **Behavior**:
  - When enabled, checks out main branch and runs `KASEKI_PRE_AGENT_VALIDATION_COMMANDS`
  - Compares test results before and after agent changes
  - Classifies failures as pre-existing, newly-introduced, fixed, or changed
  - Gracefully degrades if baseline checkout fails (continues run without comparison)
- **Use case**: Identify whether test failures are caused by agent changes or existed in main
- **Performance impact**: ~30-60 seconds per run (baseline checkout); subsequent runs reuse cache
- **Example**:

  ```bash
  # Enable (default)
  KASEKI_BASELINE_VALIDATION_ENABLED=1

  # Disable for faster runs if you don't care about comparison
  KASEKI_BASELINE_VALIDATION_ENABLED=0
  ```

### `KASEKI_BASELINE_CACHE_ROOT`

- **Type**: `string` (directory path)
- **Default**: `/cache/kaseki-baseline`
- **Paths**: Single-run (if writable), Local API, Production API
- **Description**: Root directory for caching baseline checkouts
- **Behavior**:
  - First run: Clones main branch and caches it at `<KASEKI_BASELINE_CACHE_ROOT>/<cache_key>/`
  - Subsequent runs: Reuses cached checkout if not older than `KASEKI_BASELINE_CACHE_MAX_AGE_DAYS`
  - Cache key is stable: `sha256(REPO_URL) + "main"`
  - Different repos have separate cache directories
- **Disk usage per repo**: ~200 MB (npm_modules + git objects)
- **Example**:

  ```bash
  # Default
  KASEKI_BASELINE_CACHE_ROOT=/cache/kaseki-baseline

  # Custom path (e.g., on fast SSD)
  KASEKI_BASELINE_CACHE_ROOT=/mnt/ssd/kaseki-cache

  # Shared across cluster
  KASEKI_BASELINE_CACHE_ROOT=/nfs/kaseki-baseline
  ```

### `KASEKI_BASELINE_CACHE_MAX_AGE_DAYS`

- **Type**: `number` (integer, positive)
- **Default**: `7` (7 days)
- **Paths**: Single-run, Local API, Production API
- **Description**: Maximum age of cached baseline before invalidation
- **Behavior**:
  - Cache is invalidated if modification time > `KASEKI_BASELINE_CACHE_MAX_AGE_DAYS`
  - On invalidation, new baseline is checked out and cached
  - Set to `0` to always fetch fresh baseline (slow, not recommended)
  - Set to `999` to never invalidate cache (except on manual deletion)
- **Recommendations**:
  - Development/local: `1` (fresh daily)
  - Stable repos: `7` (fresh weekly)
  - Long-running cached environments: `14` (fresh bi-weekly)
- **Example**:

  ```bash
  # Fresh baseline every day
  KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=1

  # Keep cache for 2 weeks
  KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=14

  # Never invalidate (manual management)
  KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=999
  ```

**Output Artifacts**:

When baseline validation is enabled, these artifacts are generated:

- `/results/validation-baseline.log` — Full output from validation commands on main branch
- `/results/validation-baseline-timings.tsv` — Per-command timing for baseline
- `/results/test-baseline-comparison.json` — Structured classification data:

  ```json
  {
    "summary": {
      "total_pre_existing": 2,
      "total_newly_introduced": 1,
      "total_fixed": 0
    },
    "classification": {
      "test_name": {
        "baseline_status": "passed",
        "working_status": "failed",
        "category": "newly-introduced"
      }
    }
  }
  ```

**Integration with Metadata**:

- `metadata.json` includes:
  - `baseline_validation_enabled`: boolean
  - `baseline_cache_status`: "completed", "checkout_failed", "validation_failed", "disabled"
  - `baseline_validation_exit_code`: exit code from baseline validation
  - `test_failure_classification_status`: "completed", "skipped", "failed"
  - `newly_introduced_failures_count`: count of newly-introduced failures

**Best Practices**:

- ✅ Enable baseline validation when running tests: `KASEKI_BASELINE_VALIDATION_ENABLED=1`
- ✅ Set appropriate cache TTL for your environment
- ✅ Use `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` to specify which tests to run
- ❌ Don't set cache max age to 0 (forces fresh checkout every run, slow)
- ❌ Don't disable completely if you want to detect regressions

**See also**: [docs/BASELINE_TEST_COMPARISON.md](BASELINE_TEST_COMPARISON.md) for detailed usage guide.

---

## Execution Zone

Variables controlling what code the agent operates on.

### `REPO_URL`

- **Type**: `string` (URL)
- **Default**: Required from CLI or env var
- **Paths**: Single-run, Local API, Production API
- **Description**: Target repository URL (GitHub, GitLab, etc.)
- **Examples**:

  ```bash
  REPO_URL=https://github.com/user/repo
  REPO_URL=https://gitlab.com/org/project
  ```

### `GIT_REF`

- **Type**: `string`
- **Default**: `main`
- **Paths**: Single-run, Local API, Production API
- **Description**: Git branch, tag, or commit SHA to check out
- **Examples**:

  ```bash
  GIT_REF=main
  GIT_REF=develop
  GIT_REF=v1.2.3
  GIT_REF=abc123def456  # commit SHA
  ```

### `TASK_PROMPT`

- **Type**: `string`
- **Default**: Read from TASK_PROMPT env var or interactive
- **Paths**: Single-run, Local API, Production API
- **Description**: Instruction for what the agent should do
- **Best practices**:
  - Be specific: "Fix TypeScript errors in src/" is better than "Fix errors"
  - Be scoped: "Update dependencies to latest patch versions" is clearer than "Update dependencies"
  - Avoid scope creep: Don't ask the agent to do multiple unrelated things in one run
- **Examples**:

  ```bash
  TASK_PROMPT="Fix all TypeScript errors in src/"
  TASK_PROMPT="Update all npm dependencies to latest versions"
  TASK_PROMPT="Add comprehensive error handling to all API endpoints"
  TASK_PROMPT="Refactor authentication module to use OAuth2"
  ```

### `KASEKI_PUBLISH_MODE`

- **Type**: `string` (enum)
- **Default**: `pr` (normal pull request)
- **Paths**: Single-run, Local API, Production API
- **Description**: How to publish agent results to GitHub
- **Options**:
  - `pr` — Create a normal pull request (default)
  - `branch` — Push changes to new branch without creating a PR
  - `auto` — Create PR if credentials found, otherwise skip (legacy)
  - `none` — Don't publish, keep results local
- **Note**: `pr` and `branch` require GitHub App credentials in `GITHUB_APP_*` variables; `auto` skips publishing without credentials, and `none` does not use them.
- **Example**:

  ```bash
  # Create normal PR (default)
  KASEKI_PUBLISH_MODE=pr
  ```

---

## Validation & Quality Gates Zone

Variables controlling validation and quality gates.

### Goal-Setting Agent (v2.7+)

**Pre-scouting prompt enhancement phase**

The goal-setting agent runs **before scouting** to upgrade your task prompt into a mature, specific goal with clear success criteria. This improves downstream agent performance by setting expectations upfront.

**Configuration Variables**:

#### `KASEKI_GOAL_SETTING`

- **Type**: `boolean`
- **Default**: `1` (enabled)
- **Options**: `0` (disabled), `1` (enabled)
- **Description**: Enable/disable the goal-setting phase
- **Behavior**:
  - Goal-setting runs before scouting if enabled
  - If goal-setting fails (transient error), it retries once
  - If goal-setting fails deterministically, original prompt is used (graceful fallback)
  - Upgraded goal replaces original `TASK_PROMPT` for downstream agents
- **Example**:

  ```bash
  # Enable (default)
  KASEKI_GOAL_SETTING=1

  # Disable to use original prompt directly
  KASEKI_GOAL_SETTING=0
  ```

#### `KASEKI_GOAL_SETTING_MODEL`

- **Type**: `string`
- **Default**: Same as `KASEKI_SCOUTING_MODEL`
- **Description**: Optional Pi model override for goal-setting phase
- **Use case**: Use a more capable model for goal-setting while keeping scouting/coding cheaper
- **Example**:

  ```bash
  export KASEKI_GOAL_SETTING_MODEL=openrouter/anthropic/claude-3-opus
  export KASEKI_SCOUTING_MODEL=openrouter/free
  export KASEKI_MODEL=dynamic/kaseki-agent
  ```

#### `KASEKI_GOAL_SETTING_TIMEOUT_SECONDS`

- **Type**: `number` (integer, positive)
- **Default**: `300` (5 minutes)
- **Description**: Maximum time for goal-setting phase
- **Recommendations**:
  - `300` (5 min) — typical
  - `600` (10 min) — if using slower models
  - `120` (2 min) — if using very fast models
- **Example**:

  ```bash
  KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600
  ```

**API Request Example**:

```json
{
  "taskPrompt": "Fix the parser bug",
  "goalSetting": {
    "enabled": true,
    "model": "openrouter/anthropic/claude-3-opus",
    "timeoutSeconds": 300
  }
}
```

**Output Artifacts**:

- `/results/goal-setting.json` — Upgraded goal with reasoning and success criteria
- `/results/goal-setting-events.jsonl` — Agent activity and token usage
- `/results/goal-setting-summary.json` — Concise metrics

**Example goal-setting.json**:

```json
{
  "original_prompt": "Fix the parser",
  "upgraded_goal": "Fix parseRole() to safely handle null/undefined FriendlyName values. Add test coverage for 5 edge cases.",
  "key_requirements": [
    "Handle null/undefined safely",
    "Preserve existing behavior for valid inputs",
    "Add test cases"
  ],
  "success_criteria": [
    "All existing tests pass",
    "New edge case tests added and passing",
    "No TypeErrors on null FriendlyName"
  ],
  "reasoning": "Original prompt was vague about what 'fix' means. Upgraded goal clarifies the specific issue and measurable success criteria.",
  "confidence": "high"
}
```

**Best Practices**:

- ✅ **Be specific**: "Fix authentication edge cases" → "Add rate limiting to login endpoint to prevent brute-force attacks"
- ✅ **Define success**: Include test coverage, performance targets, or validation criteria
- ✅ **Set scope**: Explicitly say what should and shouldn't be changed
- ❌ **Avoid vague verbs**: Don't just say "fix", "improve", or "handle"

For detailed guidance, see [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md).

---

### Scouting Agent & Allowlist Control (v2.6+)

**Automatic allowlist management via scouting research phase**

When `KASEKI_SCOUTING=1` or `scouting.enabled=true` in an API request:

1. **Scouting Phase** generates `suggested_allowlist` with patterns:
   - `agent_patterns`: Glob patterns for files the coding agent should modify
   - `validation_patterns`: Glob patterns for files validation commands may touch

2. **Allowlist Merge** (automatic):
   - Scouting patterns are merged (union) with user-provided `KASEKI_CHANGED_FILES_ALLOWLIST` and `KASEKI_VALIDATION_ALLOWLIST`
   - If both are provided, main agent can modify files matching either set

3. **Coverage Metrics** logged in `/results/scouting-report.md`:
   - Agent-phase coverage %: How many changed files match scouting patterns
   - Validation-phase coverage %: How many validation changes match scouting patterns
   - Warnings if patterns are too broad (>98%) or too narrow (<30%)

**Example: Merge behavior**

```bash
export KASEKI_SCOUTING=1
export KASEKI_CHANGED_FILES_ALLOWLIST="src/**"
./run-kaseki.sh
```

Scouting suggests: `src/parser.ts tests/parser.test.ts`
User provides: `src/**`
**Result**: Main agent can modify files in `src/**` (most permissive of both)

**Fallback: No allowlist merging**

To disable automatic scouting allowlist control:

```bash
export KASEKI_SCOUTING=0  # Scouting still runs, but allowlist not used
export KASEKI_CHANGED_FILES_ALLOWLIST="src/**"  # Manual allowlist only
```

Or via API:

```json
{ "scouting": { "enabled": false }, "changedFilesAllowlist": ["src/**"] }
```

**Artifacts generated**:

- `/results/scouting.json` → Full research + suggested_allowlist + coverage metrics
- `/results/scouting-report.md` → Human-readable coverage summary
- `/results/restoration.jsonl → Log entry for allowlist merge decision

### Goal Check Agent Loop

When scouting is enabled, Kaseki also enables a post-validation goal-check Pi evaluator by default. The evaluator compares the original task, `/results/scouting.json`, the current diff, changed files, validation output, and coding-agent event summary. If it reports that the goal was not met, Kaseki retries only the coding phase in the same workspace, using the evaluator's `retry_prompt`.

Configuration:

```bash
export KASEKI_GOAL_CHECK=1
export KASEKI_GOAL_CHECK_MAX_RETRIES=1
export KASEKI_GOAL_CHECK_MODEL="$KASEKI_SCOUTING_MODEL"
export KASEKI_GOAL_CHECK_TIMEOUT_SECONDS="$KASEKI_SCOUTING_TIMEOUT_SECONDS"
export KASEKI_GOAL_CHECK_CONTRACT_REPAIR_TIMEOUT_SECONDS=60
export KASEKI_GOAL_CHECK_CONTRACT_REPAIR_MAX_OUTPUT_TOKENS=768
```

The output-token values are soft targets for observability and prompt design.
They are not forwarded as per-phase provider limits and cannot by themselves
fail a run. Set `LLM_GATEWAY_MAX_OUTPUT_TOKENS` only when an operator intends
to impose a provider-wide technical ceiling.

If the evidence pass completes without a schema-valid verdict, Kaseki performs
one constrained contract-repair pass using the evidence already gathered. Its
diagnostics are written to `goal-check-contract-diagnostics.json`; it records
event hashes and budget metadata but not raw response text.

Or via API:

```json
{
  "goalCheck": {
    "enabled": true,
    "maxRetries": 1,
    "model": "openrouter/free",
    "timeoutSeconds": 300
  }
}
```

The latest verdict is written to `/results/goal-check.json`, all verdicts are appended to `/results/goal-check-attempts.jsonl`, and exhausted retries fail the run with exit code `8`.

### Run Evaluation

Kaseki can run a final task-agnostic evaluator after validation and goal-check, before PR creation. It is enabled by default for normal PR-publishing patch runs (`pr`) and disabled for inspect, startup-check, branch-only, and publish-none runs unless explicitly enabled.

```bash
export KASEKI_RUN_EVALUATION=1
export KASEKI_RUN_EVALUATION_MODEL="$KASEKI_GOAL_CHECK_MODEL"
export KASEKI_RUN_EVALUATION_TIMEOUT_SECONDS=300
```

API requests can override the same behavior with:

```json
{
  "runEvaluation": {
    "enabled": true,
    "model": "openrouter/free",
    "timeoutSeconds": 300
  }
}
```

The evaluator writes `/results/run-evaluation.json`, `/results/run-evaluation-events.jsonl`, `/results/run-evaluation-summary.json`, and `/results/run-evaluation-stderr.log`. It is annotate-only in v1: invalid output or evaluator failure records a warning artifact and does not block publishing.

### `KASEKI_CHANGED_FILES_ALLOWLIST`

- **Type**: `string` (space-separated glob patterns)
- **Default**: No restrictions (agent can change any files, or scouting-derived if scouting enabled)
- **Paths**: Single-run, Local API, Production API
- **Description**: File patterns agent is allowed to modify
- **Behavior**:
  - If set AND scouting enabled: merged (union) with scouting-derived patterns
  - If set AND scouting disabled: used as-is (restrictive)
  - If set: files outside patterns are restored before validation
  - Helps prevent unintended scope creep
  - Check `restoration.log` or `restoration-report.md` to see what was restored
- **Glob pattern syntax**:
  - `src/**` — All files in src directory and subdirectories
  - `tests/**` — All files in tests directory
  - `*.json` — All JSON files in root
  - `lib/*.ts` — TypeScript files in lib directory (not subdirectories)
- **Examples**:

  ```bash
  # Only src/ can be modified (merged with scouting if enabled)
  KASEKI_CHANGED_FILES_ALLOWLIST=src/**

  # src/ and tests/ can be modified
  KASEKI_CHANGED_FILES_ALLOWLIST=src/** tests/**

  # lib/ and root-level JSON files
  KASEKI_CHANGED_FILES_ALLOWLIST=lib/** *.json
  ```

- **With Scouting**:

  ```bash
  # Scouting suggests: src/parser.ts src/lexer.ts
  # User provides: src/**
  # Result: Agent can modify any src/** file (union of both)
  export KASEKI_SCOUTING=1
  export KASEKI_CHANGED_FILES_ALLOWLIST=src/**
  ./run-kaseki.sh
  ```

### `KASEKI_VALIDATION_ALLOWLIST`

- **Type**: `string` (space-separated glob patterns)
- **Default**: Same as `KASEKI_CHANGED_FILES_ALLOWLIST`
- **Paths**: Single-run, Local API, Production API
- **Description**: Files to validate during post-agent validation phase
- **Behavior**:
  - If set, only these files' validation commands are checked
  - Useful when validation changes unrelated files
- **Example**:

  ```bash
  # Restrict both changes and validation to specific files
  KASEKI_CHANGED_FILES_ALLOWLIST=src/**
  KASEKI_VALIDATION_ALLOWLIST=src/** tests/**
  ```

### `KASEKI_RESTORE_DISALLOWED_CHANGES`

- **Type**: `boolean`
- **Default**: `true`
- **Paths**: Single-run, Local API, Production API
- **Description**: Restore files outside allowlist before validation
- **Behavior**:
  - If `true` (default), files outside allowlist are reverted before validation
  - Provides safety by ensuring validation doesn't check unintended changes
  - Logs restored files to `restoration.log`
- **Example**:

  ```bash
  KASEKI_RESTORE_DISALLOWED_CHANGES=false  # Keep agent's full changes
  ```

### `KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS`

- **Type**: `boolean`
- **Default**: `true`
- **Paths**: Single-run, Local API, Production API
- **Description**: Skip missing npm/npm scripts instead of failing
- **Behavior**:
  - If `true` (default), missing scripts are silently skipped (non-fatal)
  - If `false`, execution fails if any script is missing
  - Check `validation-timings.tsv` to see which scripts were attempted
- **Example**:

  ```bash
  KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS=false
  ```

### TypeScript Pre-Check (v2.7+)

**Early TypeScript compilation detection before agent runs**

Kaseki can run TypeScript compilation before invoking the agent to catch export issues, type errors, and build failures early. Without this check, TypeScript errors are only discovered during post-agent validation, wasting 15+ minutes of agent time.

### `KASEKI_TS_PRE_CHECK`

- **Type**: `boolean`
- **Default**: `true`
- **Paths**: Single-run, Local API, Production API
- **Description**: Enable automatic TypeScript pre-check before agent invocation
- **Behavior** (now with intelligent auto-detection):
  - If `false` (explicitly disabled), skips entirely → `skipped_by_config`
  - If `true` (default) AND no TypeScript detected, skips gracefully → `skipped_no_typescript`
    - Checks for `tsconfig.json` OR `typescript` dependency (dev/regular/optional)
    - Non-TS projects don't fail on missing build script (safe for multi-language repos)
  - If `true` AND TypeScript detected but npm script missing, skips with warning → `skipped_missing_script`
    - Logs warning to `/results/pre-validation-ts-check.log`
    - Emits `typescript_precheck_skipped_missing_script` event (non-fatal)
  - If `true` AND TypeScript detected AND script exists:
    - Runs `KASEKI_TS_CHECK_COMMAND` after dependencies are installed
    - If compilation succeeds → `success`
    - If compilation fails and scouting disabled → fatal exit (propagated exit code)
    - If compilation fails and scouting enabled → logs warning, continues (experimental path)
  - Output logged to `/results/pre-validation-ts-check.log`
  - Exit code, duration, and detail (success/failed/skipped_*) recorded in `metadata.json` under `typescript_precheck`
  - Stage timings recorded to `/results/stage-timings.tsv`
- **Timing Impact**: ~30 seconds per run (if check runs); 0-1 seconds for skipped cases
- **Use case**:
  - Repositories where TypeScript exports are critical → keep default `true`
  - Multi-language repos (Python, Go, JS mixed) → auto-detection skips safely for non-TS projects
  - Performance-optimized runs → set to `false` to disable entirely
- **Example**:

  ```bash
  # Disable TS pre-check entirely (not recommended)
  KASEKI_TS_PRE_CHECK=0

  # Keep enabled (default) - auto-detection handles non-TS projects safely
  KASEKI_TS_PRE_CHECK=1
  ```

### `KASEKI_TS_CHECK_COMMAND`

- **Type**: `string` (shell command)
- **Default**: `npm run build`
- **Paths**: Single-run, Local API, Production API
- **Description**: Command to run for TypeScript pre-check (only runs if TypeScript is detected and script exists)
- **Behavior**:
  - Executed in the repository root after dependencies are installed
  - Only executed if TypeScript project detected AND npm script exists (auto-detection prevents errors)
  - Must succeed (exit code 0) for the check to pass
  - Common commands: `npm run build`, `tsc --noEmit`, `tsc`, `npm run compile`
  - Customizable per project; check your `package.json` for available scripts
- **Examples**:

  ```bash
  # Default: full build (catches export issues)
  KASEKI_TS_CHECK_COMMAND="npm run build"

  # Just type-check without emit (faster)
  KASEKI_TS_CHECK_COMMAND="tsc --noEmit"

  # Custom build script
  KASEKI_TS_CHECK_COMMAND="npm run build:validate"

  # Monorepo or multi-step build
  KASEKI_TS_CHECK_COMMAND="npm run prebuild && npm run build"
  ```

**Artifacts generated**:

- `/results/pre-validation-ts-check.log` → Full command output and errors
- `metadata.json` → `typescript_precheck` object with `{enabled, command, exit_code, duration_seconds, timestamp, log_file}`

**Error diagnostics**:
Check `/results/pre-validation-ts-check.log` for TypeScript compiler output. Common issues:

- Missing type definitions
- Export statements referencing non-existent modules
- TypeScript configuration errors (tsconfig.json)
- Build script misconfiguration

---

## Caching & Performance Zone

Variables for dependency caching and performance optimization.

### `KASEKI_CACHE_ENABLED`

- **Type**: `boolean`
- **Default**: `true`
- **Paths**: Single-run, Local API, Production API
- **Description**: Enable 4-layer npm dependency cache
- **Benefits**: Significantly faster dependency installation (especially across multiple runs)
- **Layers**:
  1. Workspace-level stamp check (if node_modules exists with matching lock file)
  2. Workspace cache (per-project dependency cache)
  3. Image seed cache (bundled in Docker image)
  4. Fresh `npm install` (fallback)
- **Example**:

  ```bash
  KASEKI_CACHE_ENABLED=false  # Disable caching for isolated/fresh installs
  ```

### `KASEKI_DEPENDENCY_CACHE_DIR`

- **Type**: `string` (directory path)
- **Default**: `~/.kaseki/cache`
- **Paths**: Single-run, Local API, Production API
- **Description**: Directory for caching npm and other dependencies
- **Requirements**: Must have sufficient disk space
- **Typical size**: 500 MB - 2 GB depending on project types
- **Example**:

  ```bash
  KASEKI_DEPENDENCY_CACHE_DIR=/mnt/large-cache
  ```

### `KASEKI_GIT_CACHE_MODE`

- **Type**: `string` (enum)
- **Default**: `mirror`
- **Paths**: Single-run, Local API, Production API
- **Description**: Git repository caching mode
- **Options**:
  - `mirror` — Clone once, reuse mirror for subsequent clones (faster)
  - `off` — Fresh clone every time (slower but guaranteed fresh)
- **Example**:

  ```bash
  KASEKI_GIT_CACHE_MODE=off  # Fresh clone for each run
  ```

### `KASEKI_DEPENDENCY_RESTORE_MODE`

- **Type**: `string` (enum)
- **Default**: `auto`
- **Paths**: Single-run, Local API, Production API
- **Description**: How to restore dependencies from cache
- **Options**:
  - `auto` — Recommended isolated restore: capability-probed copy-on-write reflink where supported, normal copy otherwise; both outcomes are content- and inode-verified
  - `copy` — The same inode-isolated copy/reflink mechanism, selected explicitly
  - `hardlink` — Experimental compatibility mode: private, trap-cleaned hardlink staging followed by verified inode detachment and atomic publication before agent execution; copy fallback across filesystems
  - `symlink` — Symlink `node_modules` to the cache (experimental)
- **Example**:

  ```bash
  KASEKI_DEPENDENCY_RESTORE_MODE=auto  # Recommended; workspace writes cannot alter cache inodes
  # KASEKI_DEPENDENCY_RESTORE_MODE=copy  # Explicit isolated copy/reflink restore
  # KASEKI_DEPENDENCY_RESTORE_MODE=hardlink  # Experimental; links are detached before use
  ```

`auto`, `copy`, and the completed `hardlink` restore all leave the workspace
with inodes isolated from the persistent cache. The cache is not made
recursively read-only, because doing so would also make a hardlinked staging
tree unusable; explicit hardlink mode instead materializes a detached tree
before any validation or agent command runs. `symlink` remains experimental
and intentionally couples workspace access to the cache, so do not use it for
untrusted or cache-mutating jobs.

### Dependency Cache Pruning

- `KASEKI_DEPENDENCY_CACHE_MAX_BYTES` defaults to `10737418240` (10 GiB). Set `0` to disable size pruning.
- `KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS` defaults to `30`. Set `0` to disable age pruning.
- `KASEKI_DEPENDENCY_CACHE_RECONCILE_INTERVAL_SECONDS` defaults to `86400` (one day). A reconciliation scans actual disk allocation, while intervening runs use inexpensive per-entry metadata.
- `KASEKI_DEPENDENCY_CACHE_RECONCILE_THRESHOLD_PERCENT` defaults to `90`, triggering an early actual-usage reconciliation as the recorded total approaches the byte limit.
- `KASEKI_DEPENDENCY_CACHE_PRUNE` defaults to `1`; set `0` to disable worker pruning.
- The worker writes `${KASEKI_DEPENDENCY_CACHE_DIR}/.kaseki-cache-metrics`, which the API exposes as Prometheus dependency-cache gauges.

### `KASEKI_INSTALL_IGNORE_SCRIPTS`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Single-run, Local API, Production API
- **Description**: Skip running install scripts during npm install
- **Use case**: Speed up npm install when install scripts aren't needed
- **Warning**: Some packages require install scripts to function
- **Example**:

  ```bash
  KASEKI_INSTALL_IGNORE_SCRIPTS=true
  ```

### `KASEKI_NPM_OMIT_DEV`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Single-run, Local API, Production API
- **Description**: Omit dev dependencies during npm install
- **Use case**: Faster installs for production-only agent runs
- **Example**:

  ```bash
  KASEKI_NPM_OMIT_DEV=true
  ```

### `KASEKI_CAVEMAN_LEVEL`

- **Type**: integer, `0`–`3`
- **Default**: `2`
- **Purpose**: Control concise prompt guidance and JEV-selected, local reductions of large tool results.
- **Levels**:
  - **0** — Caveman output guidance, compressed prompt sections, and dynamic tool-result routing are off.
  - **1** — Add terse response guidance. Preserve full tool output.
  - **2** — Default. Add terse response guidance and compact static prompt sections. Semantic routing considers successful coding results at or above 1,500 estimated tokens by default; the legacy router uses a 6,000-character threshold.
  - **3** — Same safeguards as level 2. The legacy router uses a lower 3,000-character threshold; semantic routing uses `KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS` at every Caveman level.
- **Routing**: With semantic routing enabled (the default), JEV receives bounded metadata about the phase, tool and operation category, output size, repeated lines, read range, error status, and a redacted goal summary. It never receives raw tool output, source files, or shell command text. JEV chooses `preserve`, `condense`, or `discard`; Caveman applies an existing local reduction only for `condense`. When semantic routing is disabled, the legacy router continues to choose `preserve`, `compact_repeated`, or `structural_code`.
- **Preservation**: Errors and uncertain JEV answers keep their original content. Repeated-line compression retains each exact line and adds an explicit repeat count. Structural previews apply only to full TypeScript/JavaScript reads, show omitted implementation details, and provide the workspace path for an exact follow-up read.
- **Configuration**: `KASEKI_CAVEMAN_ROUTER=off` disables dynamic routing. `KASEKI_CAVEMAN_ROUTER_MIN_CHARS` and `KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD` tune the legacy router. `KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED=0` uses legacy Caveman routing; `KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS`, `KASEKI_SEMANTIC_CONTEXT_DISCARD_THRESHOLD`, and `KASEKI_SEMANTIC_CONTEXT_CONDENSE_THRESHOLD` tune semantic routing. `KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED=0` disables scouting-to-coding fact selection, and `KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED=0` disables stale-read replacement. See [Environment Variables](ENV_VARS.md).
- **Fallback**: Missing credentials, JEV errors, malformed answers, timeouts, and low confidence preserve the original result. JEV is configured with no retries and a 1.2-second default timeout so it cannot add a long retry loop to a tool call.
- **Observability**: Each tool result records its disposition, bypass/evaluation status, bounded metadata, estimated token counts, latency, and before/after sizes in `caveman-routing.jsonl`; payload text is not recorded. See [ENV_VARS.md](ENV_VARS.md#caveman-and-jev-tool-output-routing) for semantic routing configuration and fail-open behavior.
- **Semantic phase transfer**: During scouting-to-coding handoff, JEV routes up to 32 bounded scouting facts in one request. It preserves requirements, required/protected paths, and facts beyond the request limit. Condensed facts retain their paths and strongest supporting details; discard requires the configured high confidence. Set `KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED=0` to preserve the pre-feature handoff contract.
- **Event-driven reevaluation**: In coding, Kaseki tracks large `read` results in memory and invalidates matching results only after a successful `write`, `edit`, or `hashline_edit` to the same path. The next context build replaces each old read result with a reread notice. This does not rescore every turn or create persistent memory. Set `KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED=0` to disable it.
- **Responsibilities**: JEV selects preserve/condense/discard; Caveman performs local reductions; Pi handles reasoning and code generation. Both new paths use the existing JEV Decisions client and write aggregate counts/token estimates to `caveman-routing.jsonl`, without logging source contents.
- **Next iteration**: Broaden phase-transfer scoring to later boundaries only after evaluating scouting-to-coding quality and cost. Add more invalidation events (for example, superseding test runs or changed implementation direction) only when Kaseki can identify those changes reliably and preserve critical verification evidence.
- **Phase targets**: Context, turn, tool-output, and generated-output targets are soft guidance. They never cap provider requests, truncate evidence, or stop/retry a run. Current default targets are in [Environment Variables](ENV_VARS.md).
- **Legacy switch**: `KASEKI_CAVEMAN=0` disables Caveman behavior. `KASEKI_CAVEMAN=1` enables it at the selected level; it does not force level 1.
- **Measurement**: Use `scripts/measure-caveman-impact.sh` to compare all-phase token-ledger usage and configured per-response pricing with semantic routing enabled and disabled. Review run duration, task completion, validation, goal-check, and publish outcomes alongside token savings. Token reduction alone is not evidence of success, and the report does not claim causality from unequal task outcomes.

---

## Logging & Debugging Zone

Variables for logging, debugging, and diagnostics.

### `KASEKI_DEBUG_RAW_EVENTS`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Single-run, Local API, Production API
- **Description**: Keep raw Pi JSONL events for debugging
- **Behavior**:
  - If `true`, preserves raw agent events in `pi-events.jsonl.raw`
  - Useful for debugging agent behavior or reporting issues
  - Increases disk usage slightly
- **Example**:

  ```bash
  KASEKI_DEBUG_RAW_EVENTS=true
  ```

### `KASEKI_LOG_DIR`

- **Type**: `string` (directory path)
- **Default**: `/var/log/kaseki`
- **Paths**: Production API only
- **Description**: Host-level log mirror directory for API service
- **Requirements**:
  - Must be writable by Docker container (UID 10000) to enable host log mirroring
  - Recommend persistent volume mount
- **Behavior if unavailable**:
  - Default (`KASEKI_STRICT_HOST_LOGGING=0`): warning-only; startup continues with `/results/stdout.log` and `/results/stderr.log`
  - Strict mode (`KASEKI_STRICT_HOST_LOGGING=1`): fail fast at startup when `KASEKI_LOG_DIR` is not writable
- **Example**:

  ```bash
  KASEKI_LOG_DIR=/var/log/kaseki
  ```

### `KASEKI_API_LOG_LEVEL`

- **Type**: `string` (enum)
- **Default**: `info`
- **Paths**: Local API, Production API only
- **Description**: Log level for API service
- **Options**: `debug`, `info`, `warn`, `error`
- **Example**:

  ```bash
  KASEKI_API_LOG_LEVEL=debug
  ```

---

## Monitoring Zone (Sentry)

Variables for error tracking and monitoring with Sentry.

### `SENTRY_DSN`

- **Type**: `string` (Data Source Name)
- **Default**: Not set (monitoring disabled)
- **Paths**: Local API, Production API only
- **Required**: Optional, but recommended for production
- **Description**: Sentry Data Source Name for error tracking and performance monitoring
- **Security**: The DSN contains your organization and project ID; keep it secure
- **Setup**:
  1. Create a Sentry account at [sentry.io](https://sentry.io)
  2. Create a new project for `kaseki-agent` (Node.js environment)
  3. Copy the DSN from project settings
  4. Set this environment variable
- **Example**:

  ```bash
  SENTRY_DSN=https://your-key@o4510014518919168.ingest.de.sentry.io/4511464131264593
  ```

### `SENTRY_ENVIRONMENT`

- **Type**: `string`
- **Default**: `production`
- **Paths**: Local API, Production API only
- **Description**: Environment name for Sentry reporting
- **Options**: `development`, `staging`, `production` (or custom values)
- **Use case**: Filter and organize errors by environment in Sentry dashboard
- **Behavior**: By default, assumes production environment. Override to `development` for local debugging or `staging` for pre-release environments.
- **Example**:

  ```bash
  # Override default for development
  SENTRY_ENVIRONMENT=development
  ```

### `SENTRY_RELEASE`

- **Type**: `string`
- **Default**: Auto-detected in this order:
  1. `SENTRY_RELEASE` environment variable (if set)
  2. Output of `git describe --tags --always` (latest Git tag or commit hash)
  3. Not set (if Git unavailable)
- **Paths**: Local API, Production API only
- **Description**: Release version for tracking which version of code has errors
- **Behavior**: Automatically detects from Git tags or commit hash. Useful for linking errors to specific deployed versions.
- **Format**: Semantic versioning (e.g., `1.53.4`, `v1.53.4`) or Git commit hash (e.g., `abc1234d`)
- **Override example**:

  ```bash
  # Explicitly set (overrides auto-detection)
  SENTRY_RELEASE=1.53.4

  # Or set from GitHub Actions release workflow
  SENTRY_RELEASE=${{ github.event.release.tag_name }}
  ```

### `SENTRY_SAMPLE_RATE`

- **Type**: `number` (0.0 - 1.0)
- **Default**: `0.1` (10% of transactions)
- **Paths**: Local API, Production API only
- **Description**: Percentage of transactions to sample for performance monitoring
- **Use case**: Reduce costs while still collecting performance data
- **Values**:
  - `0.0` — No transactions sampled (errors still tracked)
  - `0.1` — 10% of transactions (default, recommended for production)
  - `0.5` — 50% of transactions
  - `1.0` — All transactions (high cost, useful for debugging)
- **Example**:

  ```bash
  SENTRY_SAMPLE_RATE=0.1
  ```

### `SENTRY_ENABLED`

- **Type**: `boolean` (0 or 1)
- **Default**: Auto-detected from `SENTRY_DSN`
- **Paths**: Local API, Production API only
- **Description**: Explicitly enable or disable Sentry monitoring
- **Behavior**:
  - If `SENTRY_DSN` is set, Sentry is enabled by default
  - Set `SENTRY_ENABLED=0` to disable even if DSN is present
  - Set `SENTRY_ENABLED=1` to explicitly require DSN (fails if missing)
- **Example**:

  ```bash
  SENTRY_ENABLED=1
  ```

---

## Infrastructure Zone (API Service Only)

Variables for API service configuration and Docker integration.

### `KASEKI_API_KEYS`

- **Type**: `string` (comma or newline-separated tokens)
- **Default**: Auto-generated during setup
- **Required**: Yes (for Local API, Production API)
- **Paths**: Local API, Production API only
- **Description**: Bearer tokens for API authentication
- **Security**: Keep secure; treat like passwords
- **Format**: Multiple keys separated by commas or newlines
- **Example**:

  ```bash
  KASEKI_API_KEYS=sk-key-1,sk-key-2
  # or
  KASEKI_API_KEYS=sk-key-1
  KASEKI_API_KEYS=sk-key-2
  ```

### `KASEKI_API_PORT`

- **Type**: `number` (1-65535)
- **Default**: `8080`
- **Paths**: Local API, Production API only
- **Description**: Port for API service to listen on
- **Example**:

  ```bash
  KASEKI_API_PORT=3000
  ```

### `KASEKI_API_BASE_URL`

- **Type**: `string` (URL)
- **Default**: `http://localhost:8080`
- **Paths**: Local API, Production API only
- **Description**: Base URL for external access to API
- **Use case**: When API is behind a reverse proxy or on a different host
- **Example**:

  ```bash
  KASEKI_API_BASE_URL=https://kaseki.example.com
  ```

### `KASEKI_API_MAX_CONCURRENT_RUNS`

- **Type**: `number` (positive integer)
- **Default**: `3` (production), `2` (local)
- **Paths**: Local API, Production API only
- **Description**: Maximum number of agent runs to execute concurrently
- **Tuning**:
  - Decrease for resource-constrained systems
  - Increase for powerful hardware
  - Each run needs ~500MB-2GB depending on project size
- **Example**:

  ```bash
  KASEKI_API_MAX_CONCURRENT_RUNS=5  # For powerful hardware
  ```

### `KASEKI_ROOT`

- **Type**: `string` (directory path)
- **Default**: `/agents`
- **Paths**: Single-run, Local API, Production API
- **Description**: Base directory for runs and results
- **Requirements**: Must be writable by Docker container (UID 10000)
- **Example**:

  ```bash
  KASEKI_ROOT=/mnt/agents
  ```

### `KASEKI_IMAGE`

- **Type**: `string` (Docker image reference)
- **Default**: `docker.io/cyanautomation/kaseki-agent:latest`
- **Paths**: Single-run, Local API, Production API
- **Description**: Docker image to use for agent container
- **Options**:
  - Latest release: `docker.io/cyanautomation/kaseki-agent:latest`
  - Specific version: `docker.io/cyanautomation/kaseki-agent:v1.2.3`
  - Custom image: `registry.example.com/kaseki-agent:custom`
- **Example**:

  ```bash
  KASEKI_IMAGE=docker.io/cyanautomation/kaseki-agent:v1.5.0
  ```

---

## GitHub Integration Zone

Variables for GitHub App integration (PR creation, etc.).

### `GITHUB_APP_ENABLED`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Local API, Production API only
- **Description**: Enable GitHub App for PR creation
- **Requirements**: Must set `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_FILE`
- **Example**:

  ```bash
  GITHUB_APP_ENABLED=true
  ```

### `GITHUB_APP_ID`

- **Type**: `string` or `number`
- **Paths**: Local API, Production API only (if enabled)
- **Description**: GitHub App ID from GitHub settings
- **How to find**: Settings → Developer Settings → GitHub Apps → Your App → App ID
- **Example**:

  ```bash
  GITHUB_APP_ID=12345
  ```

### `GITHUB_APP_CLIENT_ID`

- **Type**: `string`
- **Paths**: Local API, Production API only (if enabled)
- **Description**: GitHub App Client ID
- **How to find**: Settings → Developer Settings → GitHub Apps → Your App → Client ID
- **Example**:

  ```bash
  GITHUB_APP_CLIENT_ID=Iv1.abc123xyz
  ```

### `GITHUB_APP_PRIVATE_KEY_FILE`

- **Type**: `string` (file path)
- **Paths**: Local API, Production API only (if enabled)
- **Description**: Path to GitHub App private key (PEM format)
- **Security**: File must have mode `0600` (owner read/write only)
- **How to get**: Settings → Developer Settings → GitHub Apps → Your App → Private Keys → Generate
- **Example**:

  ```bash
  GITHUB_APP_PRIVATE_KEY_FILE=$HOME/.kaseki/github-app-key.pem
  ```

---

## Advanced & Experimental Zone

Advanced and experimental configuration variables.

### `KASEKI_KEEP_WORKSPACE`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Single-run, Local API, Production API
- **Description**: Keep workspace directory after run (default: cleanup)
- **Use case**: Debugging failed runs
- **Warning**: Workspaces can be large; cleanup recommended after debugging
- **Example**:

  ```bash
  KASEKI_KEEP_WORKSPACE=true
  ```

### `KASEKI_DRY_RUN`

- **Type**: `boolean`
- **Default**: `false`
- **Paths**: Single-run, Local API, Production API
- **Description**: Validate setup without running agent
- **Behavior**: Runs all pre-flight checks and setup but stops before invoking Pi
- **Use case**: Testing configuration changes before running actual jobs
- **Example**:

  ```bash
  KASEKI_DRY_RUN=true
  ```

### `KASEKI_REPO_MEMORY_MODE`

- **Type**: `string` (enum)
- **Default**: `off`
- **Paths**: Single-run, Local API, Production API
- **Description**: Repository memory mode (experimental)
- **Options**: `off`, `read`, `read-write`
- **Note**: Experimental feature; behavior may change
- **Example**:

  ```bash
  KASEKI_REPO_MEMORY_MODE=read-write
  ```

### `KASEKI_REPO_MEMORY_TTL_DAYS`

- **Type**: `number` (positive integer)
- **Default**: `30`
- **Paths**: Single-run, Local API, Production API
- **Description**: Time-to-live for repository memory cache
- **Example**:

  ```bash
  KASEKI_REPO_MEMORY_TTL_DAYS=7
  ```

### `KASEKI_REPO_MEMORY_MAX_BYTES`

- **Type**: `number` (positive integer)
- **Default**: `1000000`
- **Paths**: Single-run, Local API, Production API
- **Description**: Maximum size of repository memory cache
- **Example**:

  ```bash
  KASEKI_REPO_MEMORY_MAX_BYTES=5000000
  ```

### `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE`

- **Type**: `boolean` (string: `'1'` or `'0'`)
- **Default**: `1` (enabled)
- **Paths**: Container startup (API service only)
- **Description**: Enable automatic remediation of startup configuration issues
- **Behavior**:
  - When enabled: Automatically fixes recoverable issues like missing git safe.directory configuration
  - When disabled (`'0'`): Reports issues without attempting fixes; useful for diagnosing setup problems
- **Details**:
  - Applies to `container-preflight.ts` checks that run at container startup
  - Currently handles: git safe.directory auto-configuration when not set
  - Does NOT affect host-side setup (run `sudo kaseki-agent host setup --fix` for that)
- **Use case**: Set to `'0'` when troubleshooting startup issues to see all problems without auto-fixes
- **Example**:

  ```bash
  KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0  # Disable auto-remediation (diagnostic mode)
  ```

### `KASEKI_SAFE_DIRECTORY_SCOPE`

- **Type**: `string` (enum)
- **Default**: `global`
- **Paths**: Container startup (API service only)
- **Description**: Git config scope for safe.directory configuration
- **Options**:
  - `global`: Store in user's global git config (`~/.gitconfig`)
  - `system`: Store in system-wide git config (`/etc/gitconfig`, visible to all users including containers)
- **Details**:
  - `system` scope is preferred for multi-user or container scenarios as it's visible to all users
  - `global` scope only applies to the current user context
  - If system scope configuration fails, falls back to global
- **Note**: This is primarily used by auto-remediation in container startup checks
- **Example**:

  ```bash
  KASEKI_SAFE_DIRECTORY_SCOPE=system  # Use system-wide config (preferred for containers)
  ```

---

## Configuration Precedence

Variables are resolved in this order (highest to lowest priority):

1. **CLI flags** (if supported)
2. **Environment variables** (e.g., `export KASEKI_MODEL=...`)
3. **`.env` file** in current directory
4. **Configuration file** (`~/.kaseki/config.json`)
5. **Built-in defaults** (lowest priority)

### Loading `.env` files

```bash
# Automatic (preferred)
docker-compose up -d  # Loads .env automatically

# Manual
export $(cat .env | xargs)

# For single-run
set -a
source .env
set +a
./run-kaseki.sh
```

---

## Variable Types & Validation

### String variables

- Examples: `KASEKI_MODEL`, `TASK_PROMPT`
- Validation: No special constraints (unless documented)
- Example: `KASEKI_MODEL="openrouter/openai/gpt-4-turbo"`

### Boolean variables

- Examples: `KASEKI_CACHE_ENABLED`, `KASEKI_DRY_RUN`
- Accepted values: `true`, `false`, `1`, `0`
- In `.env` files: Use `true`/`false`
- Example: `KASEKI_CACHE_ENABLED=true`

### Number variables

- Examples: `KASEKI_MAX_DIFF_BYTES`, `KASEKI_API_PORT`
- Must be positive integers
- Example: `KASEKI_MAX_DIFF_BYTES=400000`

### Enum variables

- Examples: `KASEKI_GIT_CACHE_MODE` (off|mirror)
- Only specific values are accepted
- See specific variable documentation for options
- Example: `KASEKI_GIT_CACHE_MODE=mirror`

### File path variables

- Examples: `OPENROUTER_API_KEY_FILE`, `KASEKI_LOG_DIR`
- Absolute paths recommended
- Tilde expansion (`~`) is supported
- Example: `OPENROUTER_API_KEY_FILE=$HOME/.kaseki/secrets.json`

---

## See Also

- [QUICK_START.md](QUICK_START.md) — Get started in 5 minutes
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Error diagnosis
- [docs/](.) — Full documentation index
