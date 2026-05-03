# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run is a numbered, disposable container instance such as `kaseki-1` or `kaseki-2`. This template uses the Pi coding-agent CLI with OpenRouter.

## Quick Summary

**Kaseki** orchestrates three deployment patterns:

1. **Direct CLI** — `run-kaseki.sh` on a local/remote host (traditional)
2. **Remote Activation** — `kaseki-activate.sh` for SSH/controller-driven setup and execution
3. **REST API Service** — Long-running `kaseki-api` service for distributed orchestration (ideal for OpenClaw and similar controllers)

Each produces a numbered instance (kaseki-1, kaseki-2, …) with isolated workspace and results.

---

## Key Infrastructure (May 2026)

- **Node.js**: v24 (bookworm-slim base image)
- **Docker Build**: Optimized multi-stage with consolidated RUN layers  
- **CI/CD**: Parallelized pipeline with GHA caching (80-90% hit rate)
- **Security**: Trivy scanning with SBOM generation
- **Deployment**: Docker Compose (preferred) with systemd and Node.js fallbacks

## Architecture: Host-Container Separation

**Host layer** — Management and orchestration:

- `run-kaseki.sh` — Direct runner (creates workspace, launches container, cleans up)
- `kaseki-activate.sh` — Remote activation entrypoint (install, deploy, run, status, clean)
- `kaseki-healthcheck.sh` — Host heartbeat and container status check

**Container layer** — Agent execution:

- `kaseki-agent.sh` — Inside the container (clones repo, installs deps, invokes Pi, validates, stores results)
- `entrypoint.sh` — Container startup orchestrator

**Supporting utilities (Node.js):**

- `pi-event-filter.js` — Filters raw Pi JSONL, strips thinking blocks, emits `pi-events.jsonl` + `pi-summary.json`
- `kaseki-report.js` — Reads a results directory and prints diagnostic report
- `kaseki-cli.js` + `kaseki-cli-lib.js` — Live monitoring CLI for external agents
- `kaseki-api-service.js` — REST API service for remote runs
- `kaseki-api-client.ts` — TypeScript client for integration

**Directory layout at runtime:**

```
/agents/kaseki-template/          # Dockerfile, scripts (this repo)
/agents/kaseki-agent/             # Checkout (source of truth for controllers)
/agents/kaseki-runs/kaseki-N/     # Per-run workspace (cloned repo, node_modules)
/agents/kaseki-results/kaseki-N/  # Artifacts (logs, diff, metadata, summary)
/agents/kaseki-cache/             # Optional host-level dependency cache
```

---

## Deployment Modes

### 1. Direct CLI (run-kaseki.sh)

Simplest single-run invocation on a host:

```bash
# Set API key via environment or file
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/org/repo main
```

**When to use:** Local development, one-off tasks, testing on a Pi.

---

### 2. Remote Activation (kaseki-activate.sh)

For SSH/controller-driven setup and execution. Used by OpenClaw and similar orchestrators.

#### Bootstrap a Remote Host

```bash
# Single SSH command to bootstrap a Pi (install, deploy, doctor)
ssh pi@192.168.1.100 'curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh | \
  KASEKI_CONTROLLER_MODE=1 \
  OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  sh'
```

#### Local Activation (No SSH)

```bash
cd /agents/kaseki-agent

# Bootstrap: install, deploy, doctor
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./scripts/kaseki-activate.sh --controller bootstrap

# Install checkout only
KASEKI_REPO_URL=https://github.com/org/repo \
  ./scripts/kaseki-activate.sh install

# Deploy template
./scripts/kaseki-activate.sh deploy

# Health check
./scripts/kaseki-activate.sh doctor

# Run a task
TASK_PROMPT='Fix the bug in parser.ts' \
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./scripts/kaseki-activate.sh run https://github.com/org/repo main
```

#### Machine-Readable Output

For controller integration, use `--json` or `--jsonl`:

```bash
./scripts/kaseki-activate.sh --json doctor

./scripts/kaseki-activate.sh --json run https://github.com/org/repo main
```

Returns newline-delimited JSON for each major step.

**When to use:** Controller-driven setup, multi-host management, integration with orchestrators.

**Key Features:**
- Idempotent installation and deployment
- Machine-readable JSON output for parsing
- Automatic image pull/build with caching
- Dirty-checkout detection with `--replace-stale` option
- Comprehensive logging to `$KASEKI_LOG_DIR`

---

### 3. REST API Service (kaseki-api)

Long-running async orchestration service. Ideal for:
- **OpenClaw** and similar AI orchestrators
- **Distributed agents** that need to queue and poll runs
- **Multi-user environments** with authentication
- **Webhook integration** and external monitoring

#### Quick Start

```bash
# Option A: Docker Compose (Recommended)
cd /agents/kaseki-template
export KASEKI_API_KEYS=sk-your-secret-key
docker build -t kaseki-agent:latest .
docker-compose up -d

# Option B: Node.js Process
npm install
KASEKI_API_KEYS=sk-your-secret-key npm run kaseki-api

# Option C: systemd Service
sudo cp scripts/kaseki-api.service /etc/systemd/system/
sudo systemctl start kaseki-api
```

#### Trigger a Run

```bash
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/org/repo",
    "taskPrompt": "Fix the parser bug",
    "changedFilesAllowlist": ["src/lib/parser.ts"],
    "validationCommands": ["npm run test", "npm run build"]
  }'

# Returns: {"id":"kaseki-42","status":"queued","createdAt":"2026-05-02T..."}
```

#### Poll Status

```bash
curl -H "Authorization: Bearer sk-your-secret-key" \
  http://localhost:8080/api/runs/kaseki-42/status

# Returns: {"id":"kaseki-42","status":"running","elapsedSeconds":45,"timeoutRiskPercent":4,...}
```

#### Download Results

```bash
curl -H "Authorization: Bearer sk-your-secret-key" \
  http://localhost:8080/api/results/kaseki-42/git.diff -o patch.diff

curl -H "Authorization: Bearer sk-your-secret-key" \
  http://localhost:8080/api/runs/kaseki-42/analysis | jq '.'
```

#### Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/health` | No-auth health check |
| `POST` | `/api/runs` | Submit a new task |
| `GET` | `/api/runs` | List recent runs |
| `GET` | `/api/runs/:id/status` | Poll run status |
| `GET` | `/api/runs/:id/progress` | Fetch progress events |
| `POST` | `/api/runs/:id/cancel` | Cancel queued/running job |
| `GET` | `/api/runs/:id/analysis` | Comprehensive summary |
| `GET` | `/api/results/:id/:file` | Download artifact (diff, metadata) |

**Full API documentation:** See [docs/API.md](docs/API.md)  
**Deployment guide:** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

**When to use:** Distributed orchestration, external controller integration, multi-user scenarios.

---

## Common Commands

### Direct CLI

```bash
# Basic run (auto-generates kaseki-N)
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh

# Explicit instance and repo
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh https://github.com/org/repo feature/branch kaseki-7

# API key via secret file
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key ./run-kaseki.sh

# Health/sanity check
./run-kaseki.sh --doctor

# Build image locally
docker build -t kaseki-template:latest .

# Generate diagnostic report
docker run --rm --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-4:/results:ro \
  kaseki-template:latest /results
```

### Remote Activation

```bash
cd /agents/kaseki-agent

# Bootstrap remote host via SSH
ssh pi@host 'curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh | KASEKI_CONTROLLER_MODE=1 sh'

# Or locally after cloning
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./scripts/kaseki-activate.sh --controller bootstrap

# Status check
./scripts/kaseki-activate.sh status

# Run with task
TASK_PROMPT='Make the requested change' \
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./scripts/kaseki-activate.sh run https://github.com/org/repo main

# Inspect mode (no diff required)
KASEKI_TASK_MODE=inspect \
TASK_PROMPT='Analyze the repo' \
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./scripts/kaseki-activate.sh --json run https://github.com/org/repo main
```

### REST API Service

```bash
# Start service
KASEKI_API_KEYS=sk-dev npm run kaseki-api

# In another terminal:
curl http://localhost:8080/health

curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-dev" \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/org/repo","taskPrompt":"Fix bug"}'
```

---

## Deploying the Kaseki API Service

### ✅ Recommended: Docker Compose

```bash
cd /agents/kaseki-template

# Build image
docker build -t kaseki-agent:latest .

# Set API key and start
export KASEKI_API_KEYS=sk-your-secret-key
docker-compose up -d

# Monitor logs
docker-compose logs -f kaseki-api

# Stop services
docker-compose down
```

**Features:**
- Health checks included
- Log aggregation
- Volume management for results
- Automatic restart on host reboot

### Alternative: systemd Service

```bash
# 1. Install service file
sudo cp scripts/kaseki-api.service /etc/systemd/system/

# 2. Create environment file
sudo mkdir -p /etc/kaseki-api
sudo tee /etc/kaseki-api/kaseki-api.env << EOF
KASEKI_API_KEYS=sk-your-secret-key
KASEKI_API_PORT=8080
KASEKI_RESULTS_DIR=/agents/kaseki-results
EOF
sudo chmod 600 /etc/kaseki-api/kaseki-api.env

# 3. Start service
sudo systemctl enable kaseki-api
sudo systemctl start kaseki-api

# 4. Monitor
sudo journalctl -u kaseki-api -f
```

### Fallback: Node.js Process

```bash
npm install
KASEKI_API_KEYS=sk-your-secret-key npm run kaseki-api
```

**Full deployment options:** See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## TypeScript Debt Status

Full-project TypeScript checks (`npm run type-check` / `npm run type-check:full`) may surface known unrelated errors while debt burn-down is in progress.

For pull requests, `npm run type-check:changed` is the blocking gate.

Track and prioritize debt items in [docs/BACKLOG.md](docs/BACKLOG.md).

---

## Required Host Dependencies

`run-kaseki.sh` and `kaseki-activate.sh` validate host binaries via preflight check.

**Required:**
- `docker`

**Optional (validated and reported in `--doctor`):**
- `wget`
- `sshpass`
- `git`
- `node`
- `npm`

### Installation

**Debian/Ubuntu/Raspberry Pi OS:**
```bash
sudo apt update
sudo apt install -y wget sshpass docker.io git nodejs npm
sudo usermod -aG docker $USER && newgrp docker
```

**Fedora/RHEL/CentOS Stream:**
```bash
sudo dnf install -y wget sshpass docker git nodejs npm
sudo usermod -aG docker $USER && newgrp docker
```

**Arch Linux:**
```bash
sudo pacman -S --needed wget sshpass docker git nodejs npm
sudo usermod -aG docker $USER && newgrp docker
```

---

## Host Logging and Log Rotation

Kaseki scripts support mirrored host logs via `KASEKI_LOG_DIR` (default: `/var/log/kaseki`):

- `run-kaseki.sh` writes `run-kaseki-<instance>-<timestamp>.log`
- `kaseki-activate.sh` writes `kaseki-activate-<timestamp>.log`
- `deploy-pi-template.sh` writes `deploy-pi-template-<timestamp>.log`
- `cleanup-kaseki.sh` writes `cleanup-kaseki-<timestamp>.log`
- `kaseki-healthcheck.sh` writes a JSON heartbeat file (`/var/log/kaseki/heartbeat.json`)
- `kaseki-agent.sh` keeps `/results/stdout.log` and `/results/stderr.log` in container artifacts

### Recommended Host Setup

```bash
sudo mkdir -p /var/log/kaseki
sudo chown root:adm /var/log/kaseki
sudo chmod 0750 /var/log/kaseki
```

### Strict Mode

Set `KASEKI_STRICT_HOST_LOGGING=1` to fail fast when `KASEKI_LOG_DIR` cannot be created or written. Leave unset (or `0`) for graceful degradation.

### Log Rotation

```bash
sudo install -m 0644 /agents/kaseki-template/ops/logrotate/kaseki /etc/logrotate.d/kaseki
sudo logrotate -d /etc/logrotate.d/kaseki
```

---

## Heartbeat Healthcheck

Use `kaseki-healthcheck.sh` to write a single JSON heartbeat object per run:

```bash
# Write to default target
/agents/kaseki-template/kaseki-healthcheck.sh

# Custom file
KASEKI_HEARTBEAT_FILE=/tmp/kaseki-heartbeat.json /agents/kaseki-template/kaseki-healthcheck.sh

# Disable container status check
KASEKI_HEALTHCHECK_CONTAINERS=0 /agents/kaseki-template/kaseki-healthcheck.sh
```

### Cron Setup

```cron
*/5 * * * * /agents/kaseki-template/kaseki-healthcheck.sh >/dev/null 2>&1
```

### systemd Timer

```ini
# /etc/systemd/system/kaseki-healthcheck.service
[Unit]
Description=Kaseki heartbeat healthcheck

[Service]
Type=oneshot
ExecStart=/agents/kaseki-template/kaseki-healthcheck.sh
```

```ini
# /etc/systemd/system/kaseki-healthcheck.timer
[Unit]
Description=Run Kaseki heartbeat healthcheck every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=kaseki-healthcheck.service

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kaseki-healthcheck.timer
```

---

## Image Registries

**Docker Hub** (recommended):
```bash
docker pull docker.io/cyanautomation/kaseki-agent:latest
```

**GitHub Container Registry**:
```bash
docker pull ghcr.io/cyanautomation/kaseki-agent:latest
```

Both are equivalent and receive identical multi-architecture builds for `linux/amd64` and `linux/arm64`.

### Tag Publishing Schedule

- **Stable version tags** (e.g., `0.1.0`): Published once via version tag push; never overwritten
- **`latest` tag**: Updated on every merge to `main`, every version push, and weekly Sunday 00:00 UTC
- **Commit tags** (e.g., `main-3278b67abcd1`): Published on every merge to `main`

**Production guidance:** Pin a stable tag once verified, or use a `main-<sha>` tag for reproducibility.

### Local Fallback Build

```bash
cd /agents/kaseki-template
docker build -t kaseki-template:latest .
KASEKI_IMAGE=kaseki-template:latest OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key ./run-kaseki.sh --doctor
```

For readable logs over SSH on a Pi:
```bash
docker build --progress=plain -t kaseki-template:latest .
```

---

## Deployment and Installation

### Deploy to Host Template Directory

Use `scripts/deploy-pi-template.sh` to idempotently install Kaseki on a host:

```bash
cd /path/to/kaseki-agent
sudo ./scripts/deploy-pi-template.sh

# Optional: override destination (must match guardrails: under /agents/ or $HOME/)
sudo KASEKI_TEMPLATE_DIR=~/kaseki-template ./scripts/deploy-pi-template.sh
```

**Guardrails:**
- Destination must end with `kaseki-template` and be under `/agents/` or `$HOME/`
- Existing `run`, `result`, `cache`, and `secrets` directories are preserved
- Destination root is deleted and recreated before install

**Workflow:**
1. Pulls `KASEKI_IMAGE` by default
2. Verifies image contains `/app` template
3. Falls back to building from current checkout if registry image is stale or unavailable
4. Records selected image and digest in `.kaseki-image` and `.kaseki-image-digest`

**Offline deployment:**
```bash
# For Raspberry Pi (avoid builds)
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING=0 sudo ./scripts/deploy-pi-template.sh

# Reuse existing local image
KASEKI_IMAGE_PULL_POLICY=missing sudo ./scripts/deploy-pi-template.sh

# Offline only
KASEKI_IMAGE_PULL_POLICY=never sudo ./scripts/deploy-pi-template.sh
```

---

## Monitoring Kaseki Runs

### Live CLI (No Host Node.js Required)

```bash
# List all runs
/agents/kaseki-template/kaseki list

# Get status of specific run
/agents/kaseki-template/kaseki status kaseki-1

# Get comprehensive analysis
/agents/kaseki-template/kaseki analysis kaseki-1

# Follow progress logs
/agents/kaseki-template/kaseki follow kaseki-4 --tail=50

# Show sanitized progress
/agents/kaseki-template/kaseki progress kaseki-4 --tail=25
```

The `kaseki` wrapper runs the Node-based CLI inside the configured Kaseki Docker image and mounts `/agents/kaseki-results` read-only.

### Diagnostic Report

```bash
docker run --rm --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-4:/results:ro \
  kaseki-template:latest \
  /results
```

Includes:
- Status and exit code
- Failed command and detail
- Model and duration
- Stage timings and validation timings
- Dependency cache status
- Changed files and secret-scan status
- Recommended next diagnostic artifact to inspect

---

## Metrics Export

`run-kaseki.sh` writes a stable metrics artifact at the end of each run:

- `$RESULT_DIR/metrics.json` (schema `kaseki.metrics.v1`)
- Optional centralized stream: `/var/log/kaseki/metrics.jsonl`

### Generate Metrics Manually

```bash
./kaseki-metrics.sh /agents/kaseki-results/kaseki-4/stage-timings.tsv \
                    /agents/kaseki-results/kaseki-4/metadata.json \
                    /agents/kaseki-results/kaseki-4/metrics.json
```

### Aggregation Examples

```bash
# Inspect one run
jq . /agents/kaseki-results/kaseki-4/metrics.json

# Aggregate JSONL by repo
jq -s 'group_by(.repo_url) | map({repo_url: .[0].repo_url, runs: length, total_runtime_seconds: (map(.total_runtime_seconds // 0) | add)})' /var/log/kaseki/metrics.jsonl

# Prometheus textfile bridge
jq -r '"kaseki_total_runtime_seconds{instance=\"" + (.instance // "unknown") + "\"} " + ((.total_runtime_seconds // 0)|tostring)' /agents/kaseki-results/kaseki-4/metrics.json > /var/lib/node_exporter/textfile_collector/kaseki.prom
```

---

## Host Readiness Check

Run the doctor command before first use or after host changes:

```bash
/agents/kaseki-template/run-kaseki.sh --doctor
```

Checks:
- Docker availability and daemon accessibility
- Writable run/result directories
- Image presence and readiness
- OpenRouter key availability
- Host script/image parity

### Verify API Key (Non-Exposing)

```bash
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  KASEKI_VERIFY_OPENROUTER_AUTH=1 \
  /agents/kaseki-template/run-kaseki.sh --doctor
```

---

## GitHub App Integration (Optional)

Kaseki can automatically push changes and create draft pull requests using a GitHub App.

### Prerequisites

1. Create a GitHub App with:
   - `contents: read & write`
   - `pull_requests: read & write`
   - `workflows: read` (optional)

2. Generate a private key and save locally

3. Install the app on the target repository

### Setup

```bash
mkdir -p ~/secrets
chmod 0700 ~/secrets

echo "YOUR_APP_ID" > ~/secrets/github_app_id
echo "YOUR_CLIENT_ID" > ~/secrets/github_app_client_id
cp ~/path/to/private-key.pem ~/secrets/github_app_private_key
chmod 0600 ~/secrets/github_app_*
```

### Usage

```bash
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
GITHUB_APP_ID_FILE=~/secrets/github_app_id \
GITHUB_APP_CLIENT_ID_FILE=~/secrets/github_app_client_id \
GITHUB_APP_PRIVATE_KEY_FILE=~/secrets/github_app_private_key \
  /agents/kaseki-template/run-kaseki.sh https://github.com/org/repo
```

### Behavior

When credentials are configured:
1. After validation passes and diff is non-empty, Kaseki generates a GitHub App installation token
2. Creates a feature branch `kaseki/<instance-name>`
3. Commits and pushes changes to remote
4. Creates a draft PR against the target branch with:
   - Title: `Kaseki: <instance-name>`
   - Body: Model, duration, validation result, quality checks
   - Draft: `true` for safety; review before merging

### Result Artifacts

- `git-push.log`: Detailed log of push and PR creation
- `metadata.json` includes:
  - `github_pr_url`: URL of created PR (if successful)
  - `github_push_exit_code`: Push operation status
  - `github_pr_exit_code`: PR creation status

---

## Environment Variables Reference

### Core Configuration

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required (or use file) |
| `OPENROUTER_API_KEY_FILE` | `/run/secrets/openrouter_api_key` | Preferred; mounted read-only |
| `REPO_URL` | CyanAutomation/crudmapper | Target repository |
| `GIT_REF` | main | Branch/tag/commit |

### Model and Execution

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_MODEL` | openrouter/free | Pi model string |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | 1200 | Agent timeout (20 min) |
| `TASK_PROMPT` | *(code fix task)* | Agent instructions |
| `KASEKI_TASK_MODE` | patch | `patch` (require diff) or `inspect` (no diff) |

### Validation and Quality Gates

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Semicolon-separated; set to `none` to skip |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | `src/lib/parser.ts tests/parser.validation.ts` | Space-separated patterns |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_ALLOW_EMPTY_DIFF` | 0 | Set to `1` to allow empty diff with `KASEKI_TASK_MODE=patch` |

### Paths and Caching

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_ROOT` | `/agents` | Base directory for runs, results, cache |
| `KASEKI_DEPENDENCY_CACHE_DIR` | `/workspace/.kaseki-cache` | Workspace cache for deps |
| `KASEKI_IMAGE_DEPENDENCY_CACHE_DIR` | `/opt/kaseki/workspace-cache` | Image-provided seed cache |

### Docker and Images

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_IMAGE` | `docker.io/cyanautomation/kaseki-agent:0.1.0` | Docker image to use |
| `KASEKI_CONTAINER_USER` | `$(id -u):$(id -g)` | UID:GID for container process |
| `KASEKI_PROVIDER` | `openrouter` | LLM provider |

### Debugging and Logging

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_DEBUG_RAW_EVENTS` | 0 | Keep raw Pi JSONL as `pi-events.raw.jsonl` |
| `KASEKI_STREAM_PROGRESS` | 1 | Stream sanitized progress lines |
| `KASEKI_LOG_DIR` | `/var/log/kaseki` | Host log mirror directory |
| `KASEKI_STRICT_HOST_LOGGING` | 0 | Fail fast if logs can't be written |
| `KASEKI_KEEP_WORKSPACE` | 0 | Keep workspace after run (set `1` for debugging) |
| `KASEKI_VALIDATE_AFTER_AGENT_FAILURE` | 0 | Run validation even if agent fails |

### API Service

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_API_KEYS` | — | Comma-separated API keys (required for service) |
| `KASEKI_API_PORT` | 8080 | HTTP listen port |
| `KASEKI_API_LOG_LEVEL` | info | Log verbosity: debug/info/warn/error |
| `KASEKI_API_MAX_CONCURRENT_RUNS` | 3 | Max concurrent jobs |
| `KASEKI_RESULTS_DIR` | `/agents/kaseki-results` | Results artifact directory |

### Metrics

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_APPEND_METRICS_JSONL` | 1 | Append metrics to centralized JSONL stream |
| `KASEKI_METRICS_JSONL_PATH` | `/var/log/kaseki/metrics.jsonl` | Centralized metrics stream |

---

## Exit Codes

Kaseki uses specific non-zero exit codes for diagnostic purposes:

| Code | Reason |
|---|---|
| 0 | Success |
| 2 | Missing required configuration (e.g., `OPENROUTER_API_KEY`) or invalid instance format |
| 3 | Empty git diff (no changes made by agent). Set `KASEKI_TASK_MODE=inspect` or `KASEKI_ALLOW_EMPTY_DIFF=1` when expected |
| 4 | Diff exceeds `KASEKI_MAX_DIFF_BYTES` |
| 5 | Changed file outside `KASEKI_CHANGED_FILES_ALLOWLIST` |
| 6 | Secret scan detected credential-like content |
| 7 | GitHub push/PR setup failed (missing credentials, invalid key, etc.) |
| 8 | Failed to push branch to GitHub |
| 9 | Push succeeded but PR creation failed (non-blocking; push result retained) |
| 124 | Agent timeout (SIGTERM after `KASEKI_AGENT_TIMEOUT_SECONDS`) |

Other non-zero codes may propagate from failed steps (clone, install, agent run, validation). Check `/results/metadata.json` for `failed_command` and details.

---

## Container Healthcheck

The image defines a `HEALTHCHECK`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD test -f /results/stdout.log && test -f /results/stderr.log
```

- `/results` is created in the image and again at runtime by `kaseki-agent.sh`
- Container is **healthy** after runner initializes result logs
- Run completion is tracked by `/results/exit_code`

---

## Cleanup

### Workspace Cleanup

Remove old per-run workspaces while keeping results:

```bash
KASEKI_CLEANUP_DAYS=1 /agents/kaseki-template/cleanup-kaseki.sh
```

### Docker Cleanup

Explicit and guarded. Use `--dry-run` first:

```bash
/agents/kaseki-template/cleanup-kaseki.sh --docker --dry-run
/agents/kaseki-template/cleanup-kaseki.sh --docker --force
```

Prunes old Docker build cache and dangling images.

---

## Help and Usage

View the full usage guide:

```bash
/agents/kaseki-template/run-kaseki.sh --help
```

Displays all invocation patterns, argument descriptions, environment variables, and examples.

---

## Dependency Install Behavior

`kaseki-agent.sh` prepares dependencies in this order:

1. Skip if no `package.json`
2. Skip if `node_modules` exists and lock hash matches
3. Try workspace cache hit at `$KASEKI_DEPENDENCY_CACHE_DIR/<hash>/node_modules`
4. Try image seed cache hit at `$KASEKI_IMAGE_DEPENDENCY_CACHE_DIR/<hash>/node_modules`
5. Refresh with `npm ci --prefer-offline` (fallback: `npm install`)
6. Write to workspace cache for reuse

The dependency stamp is stored outside the repo, so git status/diff remain focused on target changes.

---

## Running Against a Custom Repo

### Method 1: CLI Arguments (Recommended)

```bash
# Custom repo, auto git-ref
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/org/repo

# Custom repo and branch
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/org/repo feature/my-branch

# Custom repo, ref, and explicit instance
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/org/repo develop kaseki-42
```

Arguments are parsed intelligently:
- Strings with `/` or `.git` → repo URLs
- Short strings (`main`, `v1.0.0`) → Git refs
- Strings matching `kaseki-N` → explicit instance names
- Unspecified → auto-generated

### Method 2: Environment Variables (Legacy)

```bash
OPENROUTER_API_KEY=... REPO_URL=https://github.com/org/repo GIT_REF=feature/branch ./run-kaseki.sh
```

**Note:** CLI arguments take precedence over environment variables.

---

## Useful Links

- **[API Reference](docs/API.md)** — Complete REST endpoint specifications
- **[Deployment Guide](docs/DEPLOYMENT.md)** — systemd, Docker, docker-compose setup
- **[Integration Example](docs/INTEGRATION_EXAMPLE.md)** — Real-world usage with TypeScript client
- **[CLI Reference](docs/CLI.md)** — Live monitoring CLI (`kaseki` wrapper)
- **[Backlog](docs/BACKLOG.md)** — Known TypeScript debt and planned improvements

---

## Getting Help

### Run a Health Check

```bash
./run-kaseki.sh --doctor
```

### Inspect a Completed Run

```bash
docker run --rm --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-4:/results:ro \
  kaseki-template:latest \
  /results
```

### Check Script Permissions

If scripts aren't executable:

```bash
chmod +x run-kaseki.sh kaseki kaseki-agent.sh scripts/*.sh
```

### Verify Pi in Image

```bash
# Docker Hub
docker run --rm --entrypoint pi docker.io/cyanautomation/kaseki-agent:latest --version

# GitHub Container Registry
docker run --rm --entrypoint pi ghcr.io/cyanautomation/kaseki-agent:latest --version
```

---

## License and Contributing

See the repository for contribution guidelines and license information.
