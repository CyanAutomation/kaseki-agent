# Advanced Configuration Reference

Complete documentation of all 60+ kaseki-agent configuration variables.

> **New to kaseki-agent?** Start with [docs/QUICK_START.md](QUICK_START.md) instead.  
> **Looking for a quick reference?** See [.env.template](../.env.template) for Essential 8 variables.

---

## Table of Contents

1. [Essential 8 Variables](#essential-8-variables)
2. [Execution Zone](#execution-zone)
3. [Validation & Quality Gates Zone](#validation--quality-gates-zone)
4. [Caching & Performance Zone](#caching--performance-zone)
5. [Logging & Debugging Zone](#logging--debugging-zone)
6. [Infrastructure Zone (API Service)](#infrastructure-zone-api-service-only)
7. [GitHub Integration Zone](#github-integration-zone)
8. [Advanced & Experimental Zone](#advanced--experimental-zone)
9. [Configuration Precedence](#configuration-precedence)
10. [Variable Types & Validation](#variable-types--validation)

---

## Essential 8 Variables

These are the minimum variables needed for any setup path. All other variables have intelligent defaults.

### `OPENROUTER_API_KEY_FILE`

- **Type**: `string` (file path)
- **Default**: `~/.kaseki/secrets.json`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Path to file containing OpenRouter API key
- **Security**: File must have mode `0600` (owner read/write only)
- **Example**:

  ```bash
  OPENROUTER_API_KEY_FILE=$HOME/.kaseki/secrets.json
  ```

### `KASEKI_MODEL`

- **Type**: `string`
- **Default**: `openrouter/free`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: AI model to use for code generation
- **Options**:
  - `openrouter/free` — Free tier (limited, but good for testing)
  - `openrouter/openai/gpt-4-turbo` — Higher quality, costs more
  - `openrouter/anthropic/claude-3-opus` — Excellent quality, most expensive
  - See [OpenRouter docs](https://openrouter.ai/docs/models) for full list
- **Example**:

  ```bash
  KASEKI_MODEL=openrouter/openai/gpt-4-turbo
  ```

### `KASEKI_VALIDATION_COMMANDS`

- **Type**: `string` (semicolon-separated command list)
- **Default**: `npm run check;npm run test`
- **Required**: Yes
- **Paths**: Single-run, Local API, Production API
- **Description**: Commands to run after agent completes to validate changes
- **Behavior**:
  - Commands are run sequentially in the target repository
  - If a command doesn't exist (not defined in package.json), it's skipped (non-fatal by default)
  - Set `KASEKI_VALIDATION_ALLOW_MISSING_SCRIPTS=false` to fail on missing scripts
- **Examples**:

  ```bash
  # Node.js/npm projects
  KASEKI_VALIDATION_COMMANDS=npm run check;npm run test

  # Python projects
  KASEKI_VALIDATION_COMMANDS=pytest;mypy .

  # Rust projects
  KASEKI_VALIDATION_COMMANDS=cargo test;cargo fmt --check

  # Go projects
  KASEKI_VALIDATION_COMMANDS=go test ./...;go fmt ./...

  # Multi-language
  KASEKI_VALIDATION_COMMANDS=npm run test;python -m pytest;cargo test
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
  - `draft_pr` — Create a draft PR for review before merge
  - `branch` — Push changes to new branch without creating a PR
  - `auto` — Create PR if credentials found, otherwise skip (legacy)
  - `none` — Don't publish, keep results local
- **Note**: Requires GitHub App credentials in `GITHUB_APP_*` variables to function
- **Example**:

  ```bash
  # Create normal PR (default)
  KASEKI_PUBLISH_MODE=pr

  # Create draft PR instead
  KASEKI_PUBLISH_MODE=draft_pr
  ```

---

## Validation & Quality Gates Zone

Variables controlling validation and quality gates.

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
- `/results/metadata.jsonl` → Log entry for allowlist merge decision

### Goal Check Agent Loop

When scouting is enabled, Kaseki also enables a post-validation goal-check Pi evaluator by default. The evaluator compares the original task, `/results/scouting.json`, the current diff, changed files, validation output, and coding-agent event summary. If it reports that the goal was not met, Kaseki retries only the coding phase in the same workspace, using the evaluator's `retry_prompt`.

Configuration:

```bash
export KASEKI_GOAL_CHECK=1
export KASEKI_GOAL_CHECK_MAX_RETRIES=1
export KASEKI_GOAL_CHECK_MODEL="$KASEKI_SCOUTING_MODEL"
export KASEKI_GOAL_CHECK_TIMEOUT_SECONDS="$KASEKI_SCOUTING_TIMEOUT_SECONDS"
```

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
  - `auto` — Hardlink when cache and workspace share a filesystem, otherwise copy
  - `copy` — Copy from cache (disk intensive but isolated)
  - `hardlink` — Hardlink from cache when possible, copy fallback otherwise
  - `symlink` — Symlink `node_modules` to the cache (experimental)
- **Example**:

  ```bash
  KASEKI_DEPENDENCY_RESTORE_MODE=auto  # Recommended when cache/workspace may be separate mounts
  # KASEKI_DEPENDENCY_RESTORE_MODE=copy  # Use for fixed cross-device layouts
  # KASEKI_DEPENDENCY_RESTORE_MODE=hardlink  # Only when cache/workspace are same filesystem
  ```

### Dependency Cache Pruning

- `KASEKI_DEPENDENCY_CACHE_MAX_BYTES` defaults to `5368709120` (5 GiB). Set `0` to disable size pruning.
- `KASEKI_DEPENDENCY_CACHE_MAX_AGE_DAYS` defaults to `30`. Set `0` to disable age pruning.
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
- **Description**: Host-level log directory for API service
- **Requirements**:
  - Must be writable by Docker container (UID 10000)
  - Recommend persistent volume mount
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
- [TROUBLESHOOTING_FLOW.md](TROUBLESHOOTING_FLOW.md) — Error diagnosis
- [docs/](.) — Full documentation index
