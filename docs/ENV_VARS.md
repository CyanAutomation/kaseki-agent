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
| `KASEKI_MODEL` | `openrouter/free` | string | Pi model identifier (see [OpenRouter catalog](https://openrouter.ai/models)) |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `1200` | integer | Agent reasoning timeout in seconds (max 86400) |

### API Keys & Credentials

| Variable | File-based Alternative | Type | Purpose |
|----------|---|---|---|
| `OPENROUTER_API_KEY` | `OPENROUTER_API_KEY_FILE` | string | OpenRouter.ai API key (required) |
| `KASEKI_API_KEYS` | `KASEKI_API_KEYS_FILE` | string | Newline-separated API keys for Kaseki service |
| `GITHUB_TOKEN` | (env var only) | string | GitHub API token for PR creation |
| `GITHUB_APP_ID` | `GITHUB_APP_ID_FILE` | string | GitHub App ID (numeric) |
| `GITHUB_APP_CLIENT_ID` | `GITHUB_APP_CLIENT_ID_FILE` | string | GitHub OAuth Client ID |
| `GITHUB_APP_PRIVATE_KEY` | `GITHUB_APP_PRIVATE_KEY_FILE` | string | GitHub App private key (PEM format) |

**Note:** Prefer file-based credential variables (with `_FILE` suffix) for security. Files are resolved from:

| Priority | Path |
|----------|------|
| 1 | `/agents/secrets/{name}` (preferred) |
| 2 | `~/.secrets/{name}` (fallback) |

### GitHub App Configuration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `GITHUB_APP_ENABLED` | `1` (if credentials available) | boolean | Enable/disable GitHub operations (PR creation, branch push) |
| `KASEKI_PUBLISH_MODE` | `auto` | string | Worker/CLI GitHub operations mode: `auto` (enabled if credentials found), `none` (always skip), `branch` (require credentials), `pr` (require credentials, creates normal PR), `draft_pr` (require credentials, creates draft PR). Controller API runs pass `pr` when request `publishMode` is omitted, or pass explicit `auto` through to the worker for graceful auto publishing. |
| `KASEKI_GITHUB_PR_RETRIES` | `3` | integer | Retry attempts for GitHub PR creation (exponential backoff: 2s, 4s, 8s) |

**GitHub App Credential Auto-Detection:**

When `GITHUB_APP_ENABLED=1` and credentials are not explicitly provided, kaseki-agent automatically searches for credentials in:

| Priority | Source | Details |
|----------|--------|---------|
| 1 | **Environment variables** | `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY` |
| 2 | **Secret files** | `/agents/secrets/github_app_*`, `~/.secrets/github_app_*` |
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
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | string | Semicolon-separated validation commands for the post-agent final-diff phase |

**Behavior:**

- Pre-agent commands run after clone/dependency setup and before Pi. A failure means the selected repo/ref was already failing; inspect `pre-validation.log`, `pre-validation-raw.log`, `pre-validation-env.log`, and `pre-validation-timings.tsv`.
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
| `NPM_CONFIG_CACHE` | `${KASEKI_CACHE_DIR}/npm-cache` | string | npm internal cache |

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

## OpenRouter Configuration

### Model Selection

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `KASEKI_MODEL` | `openrouter/free` | string | AI model identifier (see [OpenRouter catalog](https://openrouter.ai/models)) |

**Common Models:**

- `openrouter/free` — Free tier (varied models)
- `openai/gpt-4-turbo` — GPT-4 Turbo
- `anthropic/claude-3-opus` — Claude 3 Opus
- `google/gemini-pro` — Google Gemini

### API Configuration

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `OPENROUTER_API_KEY` | — | string | OpenRouter API key (required) |
| `OPENROUTER_API_KEY_FILE` | `/agents/secrets/openrouter_api_key` | string | Path to API key file (preferred) |
| `OPENROUTER_API_URL` | `https://openrouter.ai/api/v1` | string | OpenRouter API endpoint |
| `OPENROUTER_REFERER` | `kaseki-agent` | string | Referer header for OpenRouter |

### Request Options

| Variable | Default | Type | Purpose |
|----------|---------|------|---------|
| `OPENROUTER_TEMPERATURE` | (model default) | float | Model temperature (0-1; higher = more creative) |
| `OPENROUTER_MAX_TOKENS` | (model default) | integer | Max output tokens per response |

---

## Kaseki Secrets & Authentication

### File-Based Secrets

All secrets support **two-path resolution**:

```
Primary:   /agents/secrets/{secret-name}
Fallback:  ~/.secrets/{secret-name}
```

**Secret Files:**

| Secret Name | File Path | Content | Required |
|---|---|---|---|
| `openrouter_api_key` | `/agents/secrets/openrouter_api_key` | API key starting with `sk-or-` | ✓ |
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
export OPENROUTER_API_KEY="sk-or-your-key-here"

kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Production Setup (API Service)

```bash
# API server configuration
export KASEKI_API_KEYS_FILE="/agents/secrets/kaseki_api_keys"
export OPENROUTER_API_KEY_FILE="/agents/secrets/openrouter_api_key"
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

kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
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

1. **Explicit env var** (e.g., `OPENROUTER_API_KEY=...`)
2. **File-based env var** (e.g., `OPENROUTER_API_KEY_FILE=...`)
3. **Default location** (e.g., `/agents/secrets/openrouter_api_key`)
4. **Fallback location** (e.g., `~/.secrets/openrouter_api_key`)
5. **Compiled default** (e.g., `openrouter/free` for `KASEKI_MODEL`)

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
test -s "${OPENROUTER_API_KEY_FILE:-$HOME/.secrets/openrouter_api_key}" && \
  echo "✓ OpenRouter key found" || \
  echo "✗ OpenRouter key missing"

test -s "${KASEKI_API_KEYS_FILE:-$HOME/.secrets/kaseki_api_keys}" && \
  echo "✓ Kaseki API keys found" || \
  echo "✗ Kaseki API keys missing"
```

---

## See Also

- [DEPLOYMENT.md](DEPLOYMENT.md) — Service setup with env vars
- [QUALITY_GATES.md](QUALITY_GATES.md) — Quality gate configuration details
- [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) — Tuning env vars for performance
