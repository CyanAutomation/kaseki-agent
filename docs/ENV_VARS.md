# Environment Variables Reference

Complete reference for all environment variables used by kaseki-agent.

---

## Agent Execution

### Core Configuration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `REPO_URL` | `CyanAutomation/crudmapper` | string | Target repository URL ([https://github.com/owner/repo](https://github.com/owner/repo)) |
| `GIT_REF` | `main` | string | Branch, tag, or commit hash |
| `TASK_PROMPT` | (code fix task) | string | Agent instruction/task description |
| `KASEKI_MODEL` | `dynamic/kaseki-agent` | string | LLM model identifier (for gateway production deployments, use `dynamic/kaseki-agent`; other providers may use their native model IDs) |
| `KASEKI_PROVIDER` | `gateway` | string | Primary LLM provider. Options: `gateway` (default, uses LLM Gateway), `openrouter` (uses OpenRouter). OpenRouter is always validated during startup as a fallback option. |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `1200` | integer | Agent reasoning timeout in seconds (max 86400) |
| `KASEKI_GOAL_CHECK` | `KASEKI_SCOUTING` | boolean | Enable the post-validation goal-check Pi evaluator when scouting artifacts are available |
| `KASEKI_GOAL_CHECK_MAX_RETRIES` | `1` | integer | Number of coding-agent retries after goal-check misses |
| `KASEKI_GOAL_CHECK_MODEL` | `KASEKI_SCOUTING_MODEL` | string | Pi model identifier for the goal-check evaluator |
| `KASEKI_GOAL_CHECK_TIMEOUT_SECONDS` | `KASEKI_SCOUTING_TIMEOUT_SECONDS` | integer | Goal-check evaluator timeout in seconds |

### Provider Selection

**Kaseki uses a two-tier LLM provider system:**

- **Primary Provider** (selected via `KASEKI_PROVIDER`):
  - `gateway` (default): Uses LLM Gateway for all agent runs
  - `openrouter`: Uses OpenRouter for all agent runs
  
- **Fallback Provider** (always available):
  - OpenRouter is always validated during startup as a fallback, regardless of primary provider selection
  - This ensures you have a backup execution path if the primary provider has issues

**Startup Behavior:**

- On startup, kaseki-agent logs the active LLM provider (e.g., "Active LLM provider: gateway")
- Checks are organized by category: primary provider, fallback provider (OpenRouter), GitHub integration
- If you've configured both providers, you'll see validation output for both (primary section + fallback section)
- If you have unused provider secrets mounted (e.g., OpenRouter key configured but gateway is primary), a warning will appear during startup

**Configuration Guide:**

1. **Using Gateway (recommended, default):**

   ```bash
   export KASEKI_PROVIDER=gateway
   export LLM_GATEWAY_URL=https://gateway.example.com/v1
   export LLM_GATEWAY_API_KEY_FILE=/path/to/key
   # Optional: configure OpenRouter as fallback
   export OPENROUTER_API_KEY_FILE=/path/to/openrouter/key
   ```

2. **Using OpenRouter:**

   ```bash
   export KASEKI_PROVIDER=openrouter
   export OPENROUTER_API_KEY_FILE=/path/to/key
   # Optional: keep gateway configured for fallback (logs will warn about unused if not set)
   export LLM_GATEWAY_URL=https://gateway.example.com/v1
   export LLM_GATEWAY_API_KEY_FILE=/path/to/gateway/key
   ```

For the gateway path, worker preflight checks verify gateway URL/key configuration, worker secret mounting, and Pi provider registration before agent phases start. For OpenRouter, the API key availability is confirmed.

### API Keys & Credentials

| Variable | Default / Alternative | Type | Purpose |
|----------|---|---|---|
| `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY_FILE` | string | OpenRouter API key used when `KASEKI_PROVIDER=openrouter` is selected as the fallback/secondary path. |
| `LLM_GATEWAY_URL` | — | string | OpenAI-compatible gateway endpoint (CloudFlare AI Workers, Azure OpenAI, Ollama, etc.). Required for the default `KASEKI_PROVIDER=gateway` path. Example: `https://gateway.ai.cloudflare.com/v1/{account_id}/{namespace}/compat` or `https://api.openai.com/v1`. |
| `LLM_GATEWAY_API_KEY` | `LLM_GATEWAY_API_KEY_FILE` | string | LLM Gateway API key. Required for the default `KASEKI_PROVIDER=gateway` path. |
| `KASEKI_GATEWAY_RESPONSE_SMOKE` | production: `true`, test/dev: `false` | boolean | Controls whether `/api/gateway-test` performs a real OpenAI Responses API smoke request with the configured gateway model (default `dynamic/kaseki-agent`). Set `0`, `false`, `off`, or `no` to disable in production; set `1`, `true`, `on`, or `yes` to force-enable in test/dev. |
| `KASEKI_ALLOW_DEV_PI_PROVIDER_SMOKE` | `false` | boolean | Enables Pi provider smoke in non-production environments. In production, Pi provider smoke runs automatically with `/api/gateway-test?stage=2&responseSmoke=true` (no query parameter needed). In development/test, set to `1`, `true`, `on`, or `yes` to enable for controlled testing. Consuming LLM gateway tokens; only enable if you need to test the Pi provider adapter in development. |
| `KASEKI_PI_PROVIDER_SMOKE_TIMEOUT_MS` | `60000` | integer | Timeout for the opt-in Pi gateway provider smoke test. |
| `KASEKI_API_URL` | `http://localhost:8080/api` | string | Client-side base URL used by npm API-backed commands (`run`, `list`, `report`, `status`, `stop`/`cancel`) |
| `KASEKI_API_KEY` | — | string | Client-side bearer token for authenticated Kaseki API services |
| `KASEKI_API_KEYS` | `/agents/secrets/kaseki_api_keys`, `~/secrets/kaseki_api_keys` | string | Newline-separated API keys accepted by the Kaseki service |
| `GITHUB_TOKEN` | (env var only) | string | GitHub API token for PR creation |
| `GITHUB_APP_ID` | `GITHUB_APP_ID_FILE` | string | GitHub App ID (numeric) |
| `GITHUB_APP_CLIENT_ID` | `GITHUB_APP_CLIENT_ID_FILE` | string | GitHub OAuth Client ID |
| `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_PRIVATE_KEY_FILE` | string | GitHub App private key (PEM format) |

**Note:** Prefer host-secret files for security. Most credentials also support explicit `_FILE` variables; Kaseki API keys use the fixed host-secret files listed above instead of a path environment variable. Files are resolved from:

| Priority | Path |
|----------|------|
| 1 | `/agents/secrets/{name}` (preferred) |
| 2 | `~/secrets/{name}` (fallback) |

### GitHub App Configuration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `GITHUB_APP_ENABLED` | `1` (if credentials available) | boolean | Enable/disable GitHub operations (PR creation, branch push) |
| `KASEKI_PUBLISH_MODE` | `pr` | string | GitHub operations mode: `pr` (creates normal PR, default), `draft_pr` (creates draft PR), `branch` (push without PR), `auto` (creates PR if credentials found, legacy), `none` (always skip). All modes require GitHub App credentials to function. |
| `KASEKI_GITHUB_PR_RETRIES` | `3` | integer | Retry attempts for GitHub PR creation (exponential backoff: 2s, 4s, 8s) |

**GitHub App Credential Auto-Detection:**

When `GITHUB_APP_ENABLED=1` and credentials are not explicitly provided, kaseki-agent automatically searches for credentials in:

| Priority | Source | Details |
|----------|--------|---------|
| 1 | **Environment variables** | `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY` |
| 2 | **Secret files** | `/agents/secrets/github_app_*`, `~/secrets/github_app_*` |
| 3 | **Auto-detected paths** | `~/.ssh/github-app-private-key`, `$PWD/.github-app-secrets/private-key`, `/etc/kaseki-secrets/github_app_private_key` (private key only) |

**Behavior by `KASEKI_PUBLISH_MODE`:**

- `auto` (default for direct worker/CLI execution) — Attempt GitHub ops if credentials found; gracefully skip if missing
- `none` — Always skip GitHub operations (ignore credentials)
- `branch` — Require GitHub credentials; fail with exit code 7 if missing
- `pr` — Require GitHub credentials; fail with exit code 7 if missing (creates normal PR)
- `draft_pr` — Require GitHub credentials; fail with exit code 7 if missing (creates draft PR)

Controller API requests with omitted `publishMode` default to normal PR mode
(`pr`); the scheduler therefore sends `KASEKI_PUBLISH_MODE=pr` to the worker unless the request
explicitly sets `publishMode` to `auto`, `none`, `branch`, or `draft_pr`. Explicit API
`publishMode: "auto"` keeps the worker/CLI graceful auto behavior. Because
`branch`, `pr`, and `draft_pr` are strict publishing modes, API submission fails before
queueing when GitHub App credentials are not ready.

To disable GitHub operations: `export GITHUB_APP_ENABLED=0`

### Quality Gates

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_MAX_DIFF_BYTES` | `200000` | integer | Maximum diff size in bytes (gates exit code 4) |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | `` (none) | string | Space-separated glob patterns for allowed file changes (gates exit code 5) |
| `KASEKI_VALIDATION_ALLOWLIST` | `` (none) | string | Space-separated glob patterns for validation-phase file restrictions (gates exit code 7) |
| `KASEKI_STARTUP_CHECK_MODE` | `boot` | enum | Dry-run startup check depth: `boot` or `baseline-validation` |
| `KASEKI_BASELINE_VALIDATION_DRY_RUN` | `0` | boolean | Run pre-agent validation during a dry-run startup check while still skipping Pi |

### Validation Commands

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_PRE_AGENT_VALIDATION` | `1` | boolean | Run validation before Pi so existing baseline failures are caught before agent work starts |
| `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` | same as `KASEKI_VALIDATION_COMMANDS` | string | Semicolon-separated validation commands for the pre-agent baseline phase |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test` | string | Semicolon-separated validation commands for the post-agent final-diff phase |

**Behavior:**

- Pre-agent commands run after clone/dependency setup and before Pi. A failure means the selected repo/ref was already failing; inspect `pre-validation.log`, `pre-validation-raw.log`, `pre-validation-env.log`, and `pre-validation-timings.tsv`.
- **Baseline caching**: Pre-agent validation results are cached per `GIT_REF` + `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` combination with a 24-hour default TTL. On subsequent runs with the same repo/commands, cached results restore instantly, avoiding redundant checkout + validation. Disable with `KASEKI_BASELINE_CACHE_DISABLED=1` for testing or cost-sensitive deployments.
- Post-agent commands run after Pi, allowlist restoration, and quality gates. A failure means the final agent output failed validation; inspect `validation.log`, `validation-raw.log`, `validation-env.log`, and `validation-timings.tsv`.
- Commands are executed sequentially within each phase.
- Missing npm scripts are skipped (non-fatal).
- First failure stops that validation phase and exits with code 7.
- Empty or `none` post-agent commands (`KASEKI_VALIDATION_COMMANDS=""` or `KASEKI_VALIDATION_COMMANDS=none`) skip post-agent validation.
- Set `KASEKI_PRE_AGENT_VALIDATION=0` to skip the baseline phase; otherwise `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` defaults to the post-agent command list.

### Startup Check Dry-Run Modes

- `KASEKI_DRY_RUN=1 KASEKI_STARTUP_CHECK_MODE=boot` is boot-only. `run-kaseki.sh` uses a minimal `/bin/bash` container path to verify Node, Git, Pi CLI availability, secret/mount readability, and writable workspace/results/cache paths. It does not clone the target repository or install dependencies.
- `KASEKI_DRY_RUN=1 KASEKI_STARTUP_CHECK_MODE=baseline-validation` is a baseline validation dry-run. `run-kaseki.sh` invokes `/usr/local/bin/kaseki-agent`, which clones the repository, installs dependencies, runs the pre-agent validation commands from `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` (defaulting to `KASEKI_VALIDATION_COMMANDS`), then skips Pi agent execution.
- API startup checks with `startupCheckMode: "baseline-validation"` or explicit validation commands set `KASEKI_BASELINE_VALIDATION_DRY_RUN=1` automatically so pre-agent validation is not treated as a no-op dry-run preview.

### Caching

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_CACHE_ENABLED` | `0` | boolean | Enable dependency caching for npm install |
| `KASEKI_CACHE_DIR` | `/cache` | string | Root cache directory (container mount point) |
| `KASEKI_DEPENDENCY_CACHE_DIR` | `${KASEKI_CACHE_DIR}/dependencies` | string | npm packages cache |
| `KASEKI_DEPENDENCY_RESTORE_MODE` | `auto` | enum | Restore `node_modules` from cache with `auto`, `copy`, `hardlink`, or `symlink` |
| `KASEKI_DEPENDENCY_CACHE_MAX_BYTES` | `5368709120` | integer | Maximum dependency cache size before worker pruning; `0` disables size pruning |
| `KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS` | `30` | integer | Maximum dependency cache entry age before worker pruning; `0` disables age pruning |
| `KASEKI_DEPENDENCY_CACHE_PRUNE` | `1` | boolean | Enable dependency cache pruning after dependency preparation |
| `KASEKI_DEPENDENCY_CACHE_METRICS_FILE` | `${KASEKI_DEPENDENCY_CACHE_DIR}/.kaseki-cache-metrics` | string | Worker-written cache size/count file read by `/api/metrics` |
| `NPM_CONFIG_CACHE` | `${KASEKI_CACHE_DIR}/npm-cache` | string | npm internal cache |
| `KASEKI_BASELINE_CACHE_ROOT` | `/cache/kaseki-baseline` | string | Baseline validation results cache directory |
| `KASEKI_BASELINE_CACHE_MAX_AGE_HOURS` | `24` | integer | Maximum baseline cache entry age in hours before expiration; `0` disables age-based invalidation |
| `KASEKI_BASELINE_CACHE_DISABLED` | `0` | boolean | Disable baseline validation caching (useful for testing or cost-sensitive deployments) |

#### `KASEKI_DEPENDENCY_RESTORE_MODE` decision guide

- **Runtime default is `auto`**. The worker sets `KASEKI_DEPENDENCY_RESTORE_MODE="${KASEKI_DEPENDENCY_RESTORE_MODE:-auto}"`, so it is **not** force-overridden to `hardlink` by bootstrap/runtime wiring.
- **Use `auto` for most container deployments**, especially when `/cache` and workspace paths (for example `/agents/kaseki-runs`) can be separate mounts/devices.
  - In `auto`, restore prefers hardlinks only when same-filesystem linking works; otherwise it falls back to copy behavior.
- **Use `copy`** when your mount topology is fixed and you want deterministic behavior without any hardlink attempts.
- **Use `hardlink`** only when cache + workspace are known to be on the same filesystem and you want maximum speed/lowest extra disk usage.
  - If they are on different devices, Linux returns **EXDEV** for cross-device link attempts; the worker normalizes this by falling back to copy and logging a cross-device fallback reason.
- **Tradeoff summary**
  - `hardlink`: fastest, lowest disk amplification, but sensitive to mount topology.
  - `copy`: most predictable across devices, but higher I/O and disk duplication.
  - `auto`: safest default in mixed/unknown environments; good balance for most operators.
  - `symlink`: experimental, highest coupling between cache and active workspace.

#### Operator runbook: EXDEV during dependency restore

If dependency restore logs show EXDEV/cross-device hardlink failures:

1. Set `KASEKI_DEPENDENCY_RESTORE_MODE=auto` (recommended) or `KASEKI_DEPENDENCY_RESTORE_MODE=copy`.
2. Re-run the workload.
3. Verify recovery by checking dependency cache status events/logs (for example `dependency-cache.log`) and confirm restore method reports copy/auto fallback rather than repeated hardlink failure.

### Directories & Paths

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_RUNS_DIR` | `/agents/kaseki-runs` | string | Per-run workspace root (cloned repo, node_modules) |
| `KASEKI_RESULTS_DIR` | `/agents/kaseki-results` | string | Persistent run artifacts directory |
| `KASEKI_CACHE_DIR` | `/cache` | string | Optional dependency cache directory |

### Debug & Logging

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_DEBUG_RAW_EVENTS` | `0` | boolean | Keep raw Pi agent JSONL output (unfiltered) |
| `KASEKI_KEEP_WORKSPACE` | `0` | boolean | Keep per-run workspace after completion (for debugging) |
| `KASEKI_STREAM_PROGRESS` | `1` | boolean | Stream sanitized progress events to stdout |

---

## API Service Configuration

### Server Settings

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_API_PORT` | `8080` | integer | HTTP listen port |
| `KASEKI_API_HOST` | loopback when unauthenticated | string | Optional bind host; unauthenticated empty-key mode is restricted to `localhost`, `127.0.0.1`, or `::1` |
| `KASEKI_API_LOG_LEVEL` | `info` | string | Log verbosity (debug/info/warn/error) |
| `NODE_ENV` | `production` | string | Node.js environment mode |

### Concurrency & Performance

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_API_MAX_CONCURRENT_RUNS` | `3` | integer | Max parallel kaseki-agent jobs |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `1200` | integer | Timeout for agent execution (same as CLI) |
| `KASEKI_MAX_DIFF_BYTES` | `200000` | integer | Quality gate limit (same as CLI) |

### Docker Integration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_API_IMAGE` | `kaseki-agent:node24-local` | string | Container image to invoke for worker runs |
| `DOCKER_HOST` | (system default) | string | Docker daemon socket/URL (usually /var/run/docker.sock) |
| `KASEKI_CONTAINER_USER` | `10000:10000` | string | UID:GID for worker containers |

### Logging & Artifacts

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_API_LOG_DIR` | `/var/log/kaseki-api` | string | Directory for API service logs |
| `KASEKI_RESULTS_DIR` | `/agents/kaseki-results` | string | Results storage (same as worker) |

### Advanced Options

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_WEBHOOK_URL` | `` (none) | string | Optional webhook for run completion events |
| `KASEKI_REDIS_URL` | `` (none) | string | Redis connection for distributed queue (future) |

---

## Docker & Container Settings

### Base Image

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `DOCKER_BUILDKIT` | `1` | boolean | Enable BuildKit for faster, more efficient builds |
| `BUILDKIT_PROGRESS` | `plain` | string | Build output format (plain/auto/tty) |

### Runtime Configuration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_CONTAINER_USER` | `10000:10000` | string | User ID for running containers (non-root) |
| `DOCKER_GID` | `(auto-detected)` | integer | Docker socket GID (for group access) |

---

## LLM Gateway Configuration

### Gateway Endpoint

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `LLM_GATEWAY_URL` | — | string | Gateway API endpoint URL (required; e.g., `https://llmgateway.local.xyz/v1`). Pi CLI automatically appends `/responses` for OpenAI Responses API. |

**Examples:**

- `https://llmgateway.local.xyz/v1` — Manifest Gateway (Pi appends `/responses`)
- `https://api.openai.com/v1` — OpenAI (Pi appends `/chat/completions`)
- `http://localhost:11434/v1/chat/completions` — Ollama (self-hosted)
- `https://api.anthropic.com/v1/messages` — Anthropic

### API Authentication

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `LLM_GATEWAY_API_KEY` | — | string | Gateway API key (required if using inline auth) |
| `LLM_GATEWAY_API_KEY_FILE` | `$HOME/.kaseki/secrets.json` | string | Path to file containing API key (preferred) |
| `LLM_GATEWAY_MODEL` | `$KASEKI_MODEL` (default `dynamic/kaseki-agent`) | string | Optional gateway-specific model override. If omitted, gateway checks and Pi provider smoke use `KASEKI_MODEL`, whose compiled default is `dynamic/kaseki-agent`. |

### Model Selection

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_MODEL` | `dynamic/kaseki-agent` | string | Model identifier. Gateway production deployments should use the default `dynamic/kaseki-agent` unless a specific gateway model is intentionally configured. |
| `KASEKI_PROVIDER_FALLBACK` | — | string | Reserved opt-in extension point. The current runtime does not switch from the gateway to OpenRouter after retry exhaustion; an empty value explicitly disables provider switching. |
| `KASEKI_PROVIDER_FALLBACK_MODEL` | — | string | Reserved opt-in extension point for a future fallback model. The current runtime leaves fallback telemetry unset when gateway retries fail. |

**Common Model Values:**

- `dynamic/kaseki-agent` — Default gateway model ID for production deployments (recommended)
- Provider-specific IDs — Use only when intentionally bypassing the gateway default routing model
- `gpt-4-turbo` — OpenAI GPT-4 Turbo (if using OpenAI gateway)
- `claude-3-opus-20240229` — Anthropic Claude 3 Opus (if using Anthropic gateway)
- Gateway-specific IDs — Check your gateway's model list for available options; for current Cloudflare/gateway production behavior, prefer `dynamic/kaseki-agent`

### Multi-Phase Model Overrides

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_SCOUTING_MODEL` | `$KASEKI_MODEL` | string | Model override for scouting phase |
| `KASEKI_GOAL_SETTING_MODEL` | `$KASEKI_SCOUTING_MODEL` | string | Model override for goal-setting phase |
| `KASEKI_GOAL_CHECK_MODEL` | `$KASEKI_SCOUTING_MODEL` | string | Model override for goal-check phase |
| `KASEKI_RUN_EVALUATION_MODEL` | (derived) | string | Model override for run-evaluation phase |

---

## Kaseki Secrets & Authentication

### File-Based Secrets

All secrets support **two-path resolution**:

```
Primary:   /agents/secrets/{secret-name}
Fallback:  ~/secrets/{secret-name}
```

**Secret Files:**

| Secret Name | File Path | Content | Required |
|---|---|---|---|
| `llm_gateway_api_key` | `/agents/secrets/llm_gateway_api_key` | API key for your LLM gateway | ✓ |
| `kaseki_api_keys` | `/agents/secrets/kaseki_api_keys` | Newline-separated keys | ✓ (for API service) |
| `github_app_id` | `/agents/secrets/github_app_id` | Numeric ID | — |
| `github_app_client_id` | `/agents/secrets/github_app_client_id` | OAuth Client ID | — |
| `github_app_private_key` | `/agents/secrets/github_app_private_key` | PEM-format private key | — |

**File Permissions:**

```bash
# Recommended permissions
chmod 600 /agents/secrets/*
chown 10000:10000 /agents/secrets/*
```

---

## Example Configurations

### Minimal Setup (CLI)

```bash
export REPO_URL="https://github.com/myorg/myrepo"
export GIT_REF="main"
export TASK_PROMPT="Fix the null pointer bug in src/parser.ts"
export LLM_GATEWAY_URL="https://llmgateway.local.xyz/v1"
export LLM_GATEWAY_API_KEY="your-api-key-here"

KASEKI_API_URL=http://localhost:8080/api kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Production Setup (API Service)

```bash
# API server configuration
# Put one API key per line in /agents/secrets/kaseki_api_keys or ~/secrets/kaseki_api_keys
export LLM_GATEWAY_URL="https://llmgateway.local.xyz/v1"
export LLM_GATEWAY_API_KEY_FILE="/agents/secrets/llm_gateway_api_key"
export KASEKI_API_PORT=8080
export KASEKI_API_LOG_LEVEL=info
export KASEKI_API_MAX_CONCURRENT_RUNS=5

# Agent defaults
export KASEKI_AGENT_TIMEOUT_SECONDS=1800
export KASEKI_MAX_DIFF_BYTES=200000
export KASEKI_CACHE_ENABLED=1

# Paths
export KASEKI_RESULTS_DIR=/agents/kaseki-results
export KASEKI_CACHE_DIR=/agents/kaseki-cache

docker-compose up -d
```

### Scoped Task with Allowlist

```bash
export REPO_URL="https://github.com/myorg/myrepo"
export GIT_REF="main"
export TASK_PROMPT="Add tests for calculateDiscount() in src/pricing/"
export KASEKI_CHANGED_FILES_ALLOWLIST="tests/pricing/*.test.ts"
export KASEKI_MAX_DIFF_BYTES=50000
export KASEKI_AGENT_TIMEOUT_SECONDS=900
export KASEKI_CACHE_ENABLED=1

KASEKI_API_URL=http://localhost:8080/api kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### High-Performance Setup

```bash
# Tight scope for fast execution
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/lib/parser.test.ts"

# Short timeout (less cost)
export KASEKI_AGENT_TIMEOUT_SECONDS=300

# Small diff limit (focused changes)
export KASEKI_MAX_DIFF_BYTES=50000

# Enable caching
export KASEKI_CACHE_ENABLED=1

# Strict validation
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run lint;npm run build"
```

---

## Environment Variable Precedence

Configuration is resolved in this order (first match wins):

1. **Explicit env var** (e.g., `LLM_GATEWAY_API_KEY=...`)
2. **File-based env var** (e.g., `LLM_GATEWAY_API_KEY_FILE=...`)
3. **Default location** (e.g., `/agents/secrets/llm_gateway_api_key`)
4. **Fallback location** (e.g., `~/secrets/llm_gateway_api_key`)
5. **Compiled default** (e.g., `dynamic/kaseki-agent` for `KASEKI_MODEL`)

---

## Validation

Check all required variables before running:

```bash
#!/bin/bash
# validate-env.sh

REQUIRED=(
  "REPO_URL"
  "GIT_REF"
  "TASK_PROMPT"
)

for var in "${REQUIRED[@]}"; do
  [ -z "${!var}" ] && echo "✗ Missing: $var" || echo "✓ $var"
done

# Check credentials
test -s "${LLM_GATEWAY_API_KEY_FILE:-$HOME/secrets/llm_gateway_api_key}" && \
  echo "✓ LLM Gateway key found" || \
  echo "✗ LLM Gateway key missing"

{ test -s /agents/secrets/kaseki_api_keys || test -s "$HOME/secrets/kaseki_api_keys"; } && \
  echo "✓ Kaseki API keys found" || \
  echo "✗ Kaseki API keys missing"
```

---

## API Endpoint Query Parameters

The following query parameters are supported on gateway testing endpoints:

### `/api/gateway-test` Query Parameters

| Parameter | Values | Purpose | Example |
|---|---|---|---|
| `stage` | `1`, `2`, `0` | Test stage: 1=connectivity only, 2=full test, 0=auto-detect | `?stage=2` |
| `piProvider` | `true`, `false` | Enable Pi provider adapter smoke test | `?piProvider=true` |
| `responseSmoke` | `true`, `false` | Enable response parsing smoke test (included in stage 2) | `?responseSmoke=true` |
| `debug` | `true`, `false` | Enable debug mode with full response diagnostics | `?debug=true` |

**Examples:**

```bash
# Basic connectivity test (stage 1)
curl http://localhost:3000/api/gateway-test?stage=1

# Full inference test (stage 2)
curl http://localhost:3000/api/gateway-test?stage=2

# Full test with Pi provider adapter check
curl http://localhost:3000/api/gateway-test?stage=2&piProvider=true

# Full test with debug diagnostics
curl "http://localhost:3000/api/gateway-test?stage=2&piProvider=true&debug=true"
```

**Response with debug mode:** When `?debug=true` is used with a Pi provider adapter error, the response includes detailed diagnostics:

- `fieldsSearched` — All field patterns the text extractor checks
- `fieldsFound` — Actual fields present in the gateway response
- `eventsByType` — Count of each event type in Pi JSONL response
- `suggestedPatterns` — Recommended field patterns to try
- `sampleEventStructure` — Sanitized structure of first few events

See [GATEWAY_TEST.md](GATEWAY_TEST.md) for comprehensive gateway testing documentation.

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) — Service setup with env vars
- [QUALITY_GATES.md](QUALITY_GATES.md) — Quality gate configuration details
- [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) — Tuning env vars for performance
- [GATEWAY_TEST.md](GATEWAY_TEST.md) — Gateway testing and diagnostics
