# Kaseki Agent

Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run is a numbered, disposable container instance such as `kaseki-1` or `kaseki-2`. This package provides a complete CLI and REST API for orchestrating the Pi coding-agent with OpenRouter.

## Quick Start

### Installation (Recommended)

```bash
# Global install (recommended)
npm install -g @cyanautomation/kaseki-agent

# One-command setup: detects Docker/Node, discovers secrets, creates /agents,
# starts the API container, and smoke-tests your bearer token
kaseki-agent quickstart
```

`quickstart` does everything in one pass. Use `--dry-run` to preview without making changes:

```bash
kaseki-agent quickstart --dry-run
```

After setup, verify and submit your first task:

```bash
kaseki-agent doctor
export KASEKI_API_KEY=<your-bearer-token>
kaseki-agent run https://github.com/CyanAutomation/crudmapper main "Add input validation to all POST endpoints"
kaseki-agent list
kaseki-agent status kaseki-1
kaseki-agent report kaseki-1
```

For a step-by-step interactive wizard instead of `quickstart`:

```bash
kaseki-agent init
```

### Without Global Install

```bash
npm install @cyanautomation/kaseki-agent
npx kaseki-agent quickstart
KASEKI_API_URL=http://localhost:8080/api npx kaseki-agent run https://github.com/CyanAutomation/crudmapper main
```

### Using Docker (Alternative)

If you prefer to avoid installing Node.js globally:

```bash
# Setup API key
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup

# Run agent
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run https://github.com/CyanAutomation/crudmapper main
```

## Overview

**Kaseki** orchestrates three deployment patterns:

1. **NPM CLI** — admin/helper workflows plus API-backed task clients (this package)
2. **Docker** — containerized setup and service execution without host Node.js
3. **REST API** — `kaseki-agent serve` for local or distributed orchestration

Task execution produces a numbered instance (kaseki-1, kaseki-2, …) with isolated workspace and results.

---

## Getting Started

### Installation & Setup

#### Option A: Global NPM

```bash
npm install -g @cyanautomation/kaseki-agent
kaseki-agent setup
```

#### Option B: Local NPM

```bash
npm install @cyanautomation/kaseki-agent
npx kaseki-agent setup
```

#### Option C: Docker

```bash
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup
```

### Verify Installation

```bash
kaseki-agent doctor
```

### Configure Authentication

Kaseki needs three sets of credentials. Choose your preferred setup method:

#### Option A: Config File (Recommended)

Create `~/.kaseki/config.json`:

```json
{
  "auth": {
    "openrouter_api_key_file": "/home/pi/secrets/openrouter_api_key",
    "github_app_id_file": "/home/pi/secrets/github_app_id",
    "github_app_client_id_file": "/home/pi/secrets/github_app_client_id",
    "github_app_private_key_file": "/home/pi/secrets/github_app_private_key"
  }
}
```

**Advantages:** Persistent, no `sudo -E` needed, works across runs.

#### Option B: Environment Variables

```bash
export OPENROUTER_API_KEY_FILE=/path/to/openrouter_key
export GITHUB_APP_ID_FILE=/path/to/github_app_id
export GITHUB_APP_CLIENT_ID_FILE=/path/to/github_app_client_id
export GITHUB_APP_PRIVATE_KEY_FILE=/path/to/github_app_private_key

# If using sudo, preserve env vars with -E flag
sudo -E env KASEKI_API_URL=http://localhost:8080/api kaseki-agent run ...
```

**Advantages:** Works for one-off runs, CI/CD pipelines.

#### Option C: Docker Compose

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for setting up the kaseki-api service with Docker Compose (recommended for production).

**👉 Full guide:** [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md)

### Run Your First API-Backed Task

Start or select a Kaseki API controller before using task commands:

```bash
# Local controller
KASEKI_API_KEYS=sk-dev kaseki-agent serve --port 8080

# Or remote controller
export KASEKI_API_URL=https://controller.example.com/api
export KASEKI_API_KEY=sk-your-kaseki-api-key
```

Then submit work through the API client:

```bash
# Simple example
KASEKI_API_KEY=sk-dev kaseki-agent run https://github.com/CyanAutomation/crudmapper main

# With custom task prompt
KASEKI_API_KEY=sk-dev kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Fix the TypeScript errors in src/"
```

### View API Results

```bash
# List all API-known instances
KASEKI_API_KEY=sk-dev kaseki-agent list

# View a specific API-backed instance
KASEKI_API_KEY=sk-dev kaseki-agent report kaseki-1
```

---

## CLI Commands

#### `setup` — Interactive Configuration Wizard

First-time setup to validate environment and store API credentials securely.

```bash
kaseki-agent setup
```

**What it does:**

- Validates Docker installation and daemon
- Checks Node.js v24+ availability
- Validates git installation
- Prompts for OpenRouter API key (securely stored in keyring)
- Saves configuration (project-local or user-global)
- Runs doctor checks to verify everything works

#### `run` — Submit Agent Task Through the API

```bash
kaseki-agent run <REPO_URL> [GIT_REF] [TASK_PROMPT]
```

`run` is an API-backed client command. Start `kaseki-agent serve` locally first, or set `KASEKI_API_URL` to an existing controller. Set `KASEKI_API_KEY` when the service requires bearer authentication.

**Examples:**

```bash
# Local API service in another terminal
KASEKI_API_KEYS=sk-dev kaseki-agent serve --port 8080

# Simple API submission (uses main branch)
KASEKI_API_KEY=sk-dev kaseki-agent run https://github.com/CyanAutomation/crudmapper

# Remote controller
KASEKI_API_URL=https://controller.example.com/api \
KASEKI_API_KEY=sk-your-kaseki-api-key \
kaseki-agent run https://github.com/CyanAutomation/crudmapper develop

# With custom task prompt
KASEKI_API_KEY=sk-dev kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Fix all TypeScript errors in src/"
```

**API Flow:**

1. Resolve the API base URL from `KASEKI_API_URL`, config `api.base_url`, or `http://localhost:8080/api`.
2. Include `Authorization: Bearer $KASEKI_API_KEY` when configured.
3. Submit the task to `POST /api/runs`.
4. Print the controller-provided run ID and status URL.
5. Use `status`, `list`, or `report` to inspect the API-backed run.

#### `doctor` — Health Check & Validation

```bash
kaseki-agent doctor [--json] [--fix]
```

**Checks:**

- Docker daemon availability
- Node.js v24+ validation
- npm availability
- git installation
- OpenRouter API key configuration
- Docker image status
- Disk space availability

**Options:**

- `--json` — JSON output (useful for scripts)
- `--fix` — Attempt auto-remediation (pull image, show install hints)

#### `list` — Show API-Known Instances

```bash
kaseki-agent list [--status STATE]
```

`list` reads the configured Kaseki API. It requires a local API service or `KASEKI_API_URL`; it does not scan local result directories.

**Filter by status:**

```bash
kaseki-agent list --status completed
kaseki-agent list --status failed
kaseki-agent list --status running
```

**Output:**

- Instance ID
- Status (running/completed/failed)
- Creation date
- Execution duration

#### `report` — View API-Backed Instance Results

```bash
kaseki-agent report <INSTANCE_ID>
```

By default, `report` reads status, analysis, artifact, and log endpoints from the configured API. Use `kaseki-agent report <INSTANCE_ID> --from-disk` only when intentionally inspecting local result files without an API.

**Shows:**

- Instance metadata (repo, branch, model, status)
- Execution stages with timing
- Final status and exit code
- Detailed summary (if available)

#### `status` — Poll API Run Status

```bash
kaseki-agent status <INSTANCE_ID> [--json]
```

`status` requires a local API service or configured `KASEKI_API_URL`.

#### `stop` / `cancel` — Cancel API-Backed Work

```bash
kaseki-agent stop <INSTANCE_ID>
kaseki-agent cancel <INSTANCE_ID>
```

Both commands call the configured API to cancel queued or running work.

#### `config` — Manage Configuration

```bash
kaseki-agent config <SUBCOMMAND> [OPTIONS]
```

**Subcommands:**

```bash
# Get a value
kaseki-agent config get agent.timeout_seconds

# Set a value (project-local)
kaseki-agent config set agent.timeout_seconds 1800

# Set globally
kaseki-agent config set agent.timeout_seconds 1800 --global

# Show active configuration
kaseki-agent config show

# Show available locations
kaseki-agent config locations
```

#### `secrets` — Manage Credentials

```bash
kaseki-agent secrets <SUBCOMMAND>
```

**Subcommands:**

```bash
# Initialize keyring
kaseki-agent secrets init

# Store a secret
kaseki-agent secrets set openrouter-api-key sk-or-...

# Retrieve (hidden by default)
kaseki-agent secrets get openrouter-api-key

# Show secret value
kaseki-agent secrets get openrouter-api-key --show

# Delete
kaseki-agent secrets delete openrouter-api-key

# List all keys
kaseki-agent secrets list
```

**Storage:**

- Linux: Uses `pass` (password-store) keyring
- Headless: Falls back to `~/.kaseki/secrets/` (0600 permissions)

#### `serve` — Start REST API Service

```bash
kaseki-agent serve [--port PORT]
```

**Default port:** 8080

```bash
# Start on default port
kaseki-agent serve

# Custom port
kaseki-agent serve --port 9000
```

**Interactive API Documentation:**

When the API service is running, access the interactive Swagger UI for exploring and testing all endpoints:

```
http://localhost:8080/docs
```

This provides an interactive interface to:

- Browse all endpoints organized by category
- View request/response schemas
- Test endpoints with "Try it out" feature
- Authorize with your API key
- Access the raw OpenAPI specification at `/api/openapi.json`

**API Endpoints:**

- `GET /health` — Service health check
- `GET /api/runs` — List instances
- `POST /api/runs` — Start new run
- `GET /api/runs/:id` — Get instance status
- `GET /api/runs/:id/logs` — Stream logs
- `GET /api/runs/:id/results` — Get results

For complete endpoint documentation, see [docs/API.md](docs/API.md).

---

## Configuration

Configuration is loaded from (in order of precedence):

1. **CLI flags** (highest precedence)
2. **`kaseki-agent.json`** (project-local)
3. **`~/.kaseki/config.json`** (user-global)
4. **Environment variables** (`KASEKI_*`, `OPENROUTER_*`, `GITHUB_*`)
5. **Built-in defaults**

### Example Configuration

**Example `kaseki-agent.json`:**

```json
{
  "agent": {
    "model": "openrouter/free",
    "timeout_seconds": 1200
  },
  "validation": {
    "allowlist": ["src/lib/", "tests/"],
    "max_diff_bytes": 200000
  },
  "docker": {
    "auto_pull": true
  }
}
```

### Common Environment Variables

```bash
# Required
OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key

# API-client commands
KASEKI_API_URL=http://localhost:8080/api  # Controller API base URL
KASEKI_API_KEY=sk-your-kaseki-api-key     # Bearer token for authenticated APIs

# Optional worker/service settings
KASEKI_ROOT=/agents                    # Base directory
KASEKI_MODEL=openrouter/free           # AI model
KASEKI_AGENT_TIMEOUT_SECONDS=1200      # Timeout
KASEKI_PRE_AGENT_VALIDATION=1          # Validate baseline before Pi
KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build" # Validate final diff after Pi
KASEKI_STARTUP_CHECK_MODE=boot          # boot or baseline-validation for dry-run startup checks
```

---

## Architecture

### Deployment Patterns

#### npm CLI (Admin Toolbox + API Client)

```bash
kaseki-agent doctor
kaseki-agent setup
kaseki-agent config show
kaseki-agent run <repo> <ref>
```

- Primary workflows: `doctor`, `setup`, `config`, and `secrets`
- Task workflows: `run`, `list`, `report`, `status`, and `stop`/`cancel` call the Kaseki API
- Best for: host setup, diagnostics, and submitting work to a local or remote controller

#### REST API (Distributed)

```bash
kaseki-agent serve --port 8080
# Then: POST /api/runs with repo/ref
```

- Long-running service
- Async execution
- Best for: Controllers, distributed systems

#### Docker (Self-Contained)

```bash
docker run docker.io/cyanautomation/kaseki-agent:latest run <repo> <ref>
```

- No host dependencies
- Full isolation
- Best for: Clean environments, CI/CD containers

### Host and Container Layers

**Host layer** — Management and orchestration:

- `run-kaseki.sh` — Direct runner (creates workspace, launches container, cleans up)
- `kaseki-activate.sh` — Remote activation entrypoint (install, deploy, run, status, clean)
- `kaseki-healthcheck.sh` — Host heartbeat and container status check

**Container layer** — Agent execution:

- `kaseki-agent.sh` — Inside the container (clones repo, installs deps, runs pre-agent validation, invokes Pi, runs post-agent validation, stores results)
- `entrypoint.sh` — Container startup orchestrator

### Validation Lifecycle

1. Clone the target repo/ref and install dependencies.
2. Run **pre-agent validation** when `KASEKI_PRE_AGENT_VALIDATION=1` (default). These commands default to `KASEKI_VALIDATION_COMMANDS` through `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` and execute before Pi so Kaseki can detect an already-failing baseline. Inspect `/agents/kaseki-results/kaseki-N/pre-validation.log`, `/agents/kaseki-results/kaseki-N/pre-validation-raw.log`, `/agents/kaseki-results/kaseki-N/pre-validation-env.log`, and `/agents/kaseki-results/kaseki-N/pre-validation-timings.tsv`.
3. Invoke Pi only if the baseline validation succeeds (or pre-agent validation is disabled).
4. Restore disallowed changes, run quality gates, then run **post-agent validation** with `KASEKI_VALIDATION_COMMANDS` against the final diff. Inspect `/agents/kaseki-results/kaseki-N/validation.log`, `/agents/kaseki-results/kaseki-N/validation-raw.log`, `/agents/kaseki-results/kaseki-N/validation-env.log`, and `/agents/kaseki-results/kaseki-N/validation-timings.tsv`.
5. Record phase exit codes and failure reasons in `/agents/kaseki-results/kaseki-N/metadata.json`; `stage-timings.tsv` shows whether the failing phase was `pre-agent validation` or `validation`.

> **Important:** `kaseki-agent.sh` runs from the Docker image (`/usr/local/bin/kaseki-agent`) and is **not** host-mounted during runs.
> For Direct CLI mode, the host needs `run-kaseki.sh` (plus `scripts/kaseki-preflight.sh`) and Docker access; the agent script itself stays inside the image.

### Supporting Utilities (Node.js)

- `pi-event-filter.js` — Filters raw Pi JSONL, strips thinking blocks, emits `pi-events.jsonl` + `pi-summary.json`
- `kaseki-report.js` — Reads a results directory and prints diagnostic report
- `kaseki-cli.js` + `kaseki-cli-lib.js` — Live monitoring CLI for external agents
- `kaseki-api-service.js` — REST API service for remote runs
- `kaseki-api-client.ts` — TypeScript client for integration

### Directory Layout at Runtime

```
/agents/kaseki-template/          # Dockerfile, scripts (this repo)
/agents/kaseki-agent/             # Checkout (source of truth for controllers)
/agents/kaseki-runs/kaseki-N/     # Per-run workspace (cloned repo, node_modules)
/agents/kaseki-results/kaseki-N/  # Artifacts (logs, diff, metadata, summary)
/agents/kaseki-cache/             # Optional host-level dependency cache (lockfile-first npm keys)
/cache/git/                       # Optional host-mounted bare Git mirrors for target repos
```

---

## Deployment Modes

### Direct CLI (run-kaseki.sh)

Simplest single-run invocation on a host:

```bash
# Set API key via environment or file
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/org/repo main
```

**When to use:** Local development, one-off tasks, testing on a Pi.

**Host file requirements (Direct CLI):**

- Required on host: `run-kaseki.sh`, `scripts/kaseki-preflight.sh`
- Required in image/container: `kaseki-agent.sh` (invoked by container entrypoint as `/usr/local/bin/kaseki-agent`)
- Runtime mounts are workspace/results/cache/secrets; host script files are not mounted into `/app` at run time

---

### Remote Activation (kaseki-activate.sh)

For SSH/controller-driven setup and execution. Used by OpenClaw and similar orchestrators.

#### Bootstrap a Remote Host

```bash
# Single SSH command to bootstrap a Pi (install, deploy, doctor)
ssh pi@192.168.1.100 'tmp=$(mktemp) && \
  curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh -o "$tmp" && \
  KASEKI_CONTROLLER_MODE=1 sh "$tmp"'
```

Controller bootstrap can install, deploy, and run host diagnostics without an
OpenRouter key. Actual `run` commands still require `OPENROUTER_API_KEY` or
`OPENROUTER_API_KEY_FILE`, unless the API container provides the key for
HTTP-triggered runs.

If the host has never run Kaseki before, run the host setup helper first. It
creates the expected `/agents` directories, verifies writable results storage,
and bootstraps the template when the checkout is present:

```bash
ssh pi@192.168.1.100 'tmp=$(mktemp) && curl -fsSL https://raw.githubusercontent.com/CyanAutomation/kaseki-agent/main/scripts/kaseki-install.sh -o "$tmp" && KASEKI_CONTROLLER_MODE=1 sh "$tmp"'
ssh pi@192.168.1.100 '/agents/kaseki-agent/scripts/kaseki-setup-host.sh --fix'
```

#### Local Activation (No SSH)

```bash
cd /agents/kaseki-agent

# Bootstrap: install, deploy, doctor
./scripts/kaseki-activate.sh --controller bootstrap

# Install checkout only
KASEKI_REPO_URL=https://github.com/org/repo \
  ./scripts/kaseki-activate.sh install

# Deploy template
./scripts/kaseki-activate.sh deploy

# Health check
./scripts/kaseki-activate.sh doctor

# First-run host setup/repair
./scripts/kaseki-setup-host.sh --fix

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

### REST API Service (kaseki-api)

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

# Option C: Docker directly
docker run -d --name kaseki-api \
  -p 8080:8080 \
  -e KASEKI_API_KEYS=sk-your-secret-key \
  -v /agents:/agents:rw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/:latest api

# Option D: systemd Service
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
    "allowlist": { "include": ["src/lib/parser.ts"] },
    "validationCommands": ["npm run test", "npm run build"],
    "validation": { "commands": ["npm run test", "npm run build"] }
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

# Health/sanity check after deploying the host template
/agents/kaseki-template/run-kaseki.sh --doctor

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
ssh pi@host 'curl -fsSL https://raw.githubusercontent.com//main/scripts/kaseki-install.sh | KASEKI_CONTROLLER_MODE=1 sh'

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

curl -H "Authorization: Bearer sk-dev" \
  http://localhost:8080/api/preflight

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
- Authenticated `/api/preflight` controller readiness diagnostics
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
docker pull docker.io/:latest
```

**GitHub Container Registry**:

```bash
docker pull ghcr.io/:latest
```

Both are equivalent and receive identical multi-architecture builds for `linux/amd64` and `linux/arm64`.

### Releasing a New Version

Releases are fully automated using **semantic-release** and **conventional commits**. Versions are determined automatically based on commit messages.

**Prerequisites:**

- All recent commits on `main` follow [conventional commit](CONTRIBUTING.md#6-release-process-and-conventional-commits) format (`feat:`, `fix:`, `chore:`, etc.)
- CI/CD checks are passing on `main`

**Release via GitHub Actions (Recommended):**

1. Go to the [Actions](https://github.com/CyanAutomation/kaseki-agent/actions) tab → **Release** workflow
2. Click **Run workflow**
3. Optionally check "Dry-run" to preview without creating tags
4. Click **Run workflow**
5. The workflow automatically:
   - Analyzes commits since last release
   - Determines version bump (major/minor/patch)
   - Updates `package.json` and `CHANGELOG.md`
   - Creates GitHub Release with release notes
   - Triggers Docker multi-arch builds and publishes to registries
6. Monitor in Actions tab; verify in [Releases](https://github.com/CyanAutomation/kaseki-agent/releases)

**Release via Local Command (Alternative):**

```bash
npm run release:dry    # Preview (optional)
npm run release        # Create release
```

See [CONTRIBUTING.md § Release Process](CONTRIBUTING.md#6-release-process-and-conventional-commits) for detailed commit format guidelines and options.

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

Use `scripts/deploy-pi-template.sh` to idempotently install the runnable Kaseki template on a host:

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
   `.kaseki-image` preserves the configured ref such as `docker.io/cyanautomation/kaseki-agent:latest`,
   while `.kaseki-image-digest` records the resolved local digest when Docker provides one.

**Offline deployment:**

```bash
# For Raspberry Pi (avoid builds)
KASEKI_BUILD_IMAGE_IF_TEMPLATE_MISSING=0 sudo ./scripts/deploy-pi-template.sh

# Reuse existing local image
KASEKI_IMAGE_PULL_POLICY=missing sudo ./scripts/deploy-pi-template.sh

# Offline only
KASEKI_IMAGE_PULL_POLICY=never sudo ./scripts/deploy-pi-template.sh

# Dockhand / Portainer style
KASEKI_IMAGE=docker.io/cyanautomation/kaseki-agent:latest \
KASEKI_IMAGE_PULL_POLICY=always sudo ./scripts/deploy-pi-template.sh
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

Run doctor from the deployed template directory, not directly from a source-only
checkout. The deployed template includes generated `lib/*.js` helper payloads
extracted from the Docker image.

For a brand-new host, prefer the setup helper:

```bash
/agents/kaseki-agent/scripts/kaseki-setup-host.sh --fix
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

Kaseki can automatically push changes and create pull requests using a GitHub App.
Use file-mounted secrets for the private key. It is acceptable to provide the App ID
and Client ID as environment variables, but production deployments should keep all
three values in files or Docker secrets and pass only `*_FILE` paths through the
container environment.

### Prerequisites

1. Create a GitHub App with:
   - `contents: read & write`
   - `pull_requests: read & write`
   - `workflows: read` (optional)

2. Generate a private key and save locally

3. Install the app on the target repository

### Single-line/text PEM private keys

The preferred approach is to paste the GitHub App private key text into a
secret file, then reference that file with `GITHUB_APP_PRIVATE_KEY_FILE`. For
example, store the value at `/agents/secrets/github_app_private_key` for
container or service deployments, or at `~/secrets/github_app_private_key` for
local CLI runs.

Kaseki normalizes the private key after reading it, so the file may contain the
original multi-line PEM, a PEM where newlines are escaped as `\n`, a base64-
encoded PEM, or a single-line PEM where spaces are used in place of PEM
newlines.

`GITHUB_APP_PRIVATE_KEY` is only for local `run-kaseki.sh` experiments. Config
and API service flows may reject inline private keys because they enforce
file-based secrets; use `GITHUB_APP_PRIVATE_KEY_FILE` for those flows.

> **Security warning:** Never paste real private keys into tickets, prompts,
> logs, `.env` files, or source control. If a GitHub App private key is exposed,
> regenerate the private key in the GitHub App settings and replace the secret
> file everywhere it is used.

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

For Docker Compose or Dockhand deployments, mount the secret files under `/agents`
and pass paths rather than embedding the PEM in `.env`:

```yaml
environment:
  GITHUB_APP_ID_FILE: /agents/secrets/github_app_id
  GITHUB_APP_CLIENT_ID_FILE: /agents/secrets/github_app_client_id
  GITHUB_APP_PRIVATE_KEY_FILE: /agents/secrets/github_app_private_key
volumes:
  - /agents:/agents:rw
```

`GITHUB_APP_PRIVATE_KEY` is still accepted as a fallback for local
`run-kaseki.sh` experiments, including escaped `\n`, base64 PEM, or
single-line PEM values after normalization. Avoid inline private keys for shared
hosts: environment variables are easier to leak through process inspection,
logs, and orchestration UIs, and config/API service flows may reject inline
secrets in favor of file-based secret paths.

### Behavior

When credentials are configured and publishing is enabled:

1. After validation passes and diff is non-empty, Kaseki generates a GitHub App installation token
2. Creates a feature branch `kaseki/<instance-name>`
3. Commits and pushes changes to remote
4. Creates a PR against the target branch when `KASEKI_PUBLISH_MODE=pr` or API `publishMode` is `pr` (normal PR), when `KASEKI_PUBLISH_MODE=auto` finds worker credentials (normal PR), or when `KASEKI_PUBLISH_MODE=draft_pr` or API `publishMode` is `draft_pr` (explicit draft PR), with:
   - Title: `Kaseki: <instance-name>`
   - Body: Model, duration, validation result, quality checks
   - Draft: `true` only for explicit `draft_pr` mode; otherwise `false`

Publishing modes are `auto`, `none`, `branch`, `pr`, and `draft_pr`. Controller
requests with omitted `publishMode` default to `pr`, so the normal controller path
pushes a branch and creates a normal pull request after validation. The `draft_pr`
mode remains available for explicit draft PR creation. Explicit API `publishMode: "auto"`
is accepted for graceful worker auto publishing: the worker publishes when
credentials are available and skips GitHub operations when they are not. Requests
that resolve to `branch`, `pr`, or `draft_pr` fail before queueing unless GitHub
App credentials are readable, so orchestrators can surface a clear setup error
instead of waiting for a run that cannot publish. Set `publishMode` to `none`
to opt out of GitHub publishing for a specific API run.

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
| `KASEKI_PUBLISH_MODE` | auto | `auto`, `none`, `branch`, `pr`, or `draft_pr`; controller API requests with omitted `publishMode` default to `pr`, while explicit API `publishMode: "auto"` passes graceful auto publishing to workers; direct worker/CLI execution defaults to `auto` if unchanged |
| `KASEKI_STARTUP_CHECK_MODE` | boot | Dry-run startup check depth: `boot` or `baseline-validation` |

### Validation and Quality Gates

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_PRE_AGENT_VALIDATION` | `1` | Run validation before Pi to detect a failing baseline repo/ref. Set to `0` only when you intentionally want to skip baseline validation. |
| `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` | same as `KASEKI_VALIDATION_COMMANDS` | Semicolon-separated pre-agent validation commands. Logs: `pre-validation.log`, `pre-validation-raw.log`, `pre-validation-env.log`, `pre-validation-timings.tsv`. |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Semicolon-separated post-agent validation commands for the final diff; set to `none` or empty to skip post-agent validation. Missing npm scripts are skipped with a warning (non-fatal). Logs: `validation.log`, `validation-raw.log`, `validation-env.log`, `validation-timings.tsv`. |
| `KASEKI_STARTUP_CHECK_MODE` | `boot` | For `KASEKI_DRY_RUN=1`, `boot` performs a container smoke test through `/bin/bash`; `baseline-validation` runs `/usr/local/bin/kaseki-agent` to clone, install dependencies, run pre-agent validation, and skip Pi. |
| `KASEKI_BASELINE_VALIDATION_DRY_RUN` | `0` | Internal/API switch set with `baseline-validation` so pre-agent validation runs even though Pi remains disabled. |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | `src/lib/parser.ts tests/parser.validation.ts` | Space-separated patterns |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_ALLOW_EMPTY_DIFF` | 0 | Set to `1` to allow empty diff with `KASEKI_TASK_MODE=patch` |
| `KASEKI_AGENT_GUARDRAILS` | 1 | Prepend safety instructions that reserve commit/push/PR actions for Kaseki |
| `KASEKI_RESTORE_DISALLOWED_CHANGES` | 1 | Restore changes outside `KASEKI_CHANGED_FILES_ALLOWLIST` before validation and GitHub publishing |
| `KASEKI_NPM_OMIT_DEV` | 0 | Set to `1` to omit dev dependencies during `npm ci`; default keeps test/build tools available |

`KASEKI_CHANGED_FILES_ALLOWLIST` patterns are repo-relative globs. Exact paths match only that path; `*` and `?` match within a single path segment; `**` can span directory separators. A `**/` segment may match zero or more directories, so `src/**/*.ts` matches both `src/index.ts` and nested files such as `src/lib/file-storage.ts`.

API controllers may send either the direct fields (`changedFilesAllowlist`, `validationCommands`) or the structured aliases (`allowlist.include`, `validation.commands`). The scheduler normalizes both forms before launching the worker.

Startup checks have two depths. Boot-only startup checks (`startupCheck: true`, `startupCheckMode: "boot"`, or `KASEKI_DRY_RUN=1 KASEKI_STARTUP_CHECK_MODE=boot`) use the minimal container boot path to verify runtime tools, mounts, and secrets without cloning the repository. Baseline validation startup checks (`startupCheckMode: "baseline-validation"`, or a startup check with validation commands) keep dry-run/Pi-skipping behavior but invoke `/usr/local/bin/kaseki-agent` far enough to clone the repository, prepare dependencies, and execute the pre-agent validation commands. A failure in this mode means the requested baseline already failed before any Pi-authored changes existed; inspect `pre-validation.log` and `pre-validation-timings.tsv`.

### Paths and Caching

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_ROOT` | `/agents` | Base directory for runs, results, cache |
| `KASEKI_DEPENDENCY_CACHE_DIR` | `/workspace/.kaseki-cache` | Workspace dependency cache, keyed as `npm/<lock_hash>/node-<major>/flags-<flags_hash>` |
| `KASEKI_IMAGE_DEPENDENCY_CACHE_DIR` | `/opt/kaseki/workspace-cache` | Image-provided seed cache using the same lockfile-first key layout |
| `KASEKI_GIT_CACHE_MODE` | `mirror` | Git object cache mode: `mirror` uses host-mounted bare mirrors under `/cache/git`; `off` keeps the direct shallow clone path |
| `KASEKI_REPO_MEMORY_MODE` | `off` | Opt-in repository prompt memory: `off` disables it; `summary` appends a compact prior-context summary when fresh |
| `KASEKI_REPO_MEMORY_TTL_DAYS` | `30` | Maximum age for a repository memory summary before it is ignored |
| `KASEKI_REPO_MEMORY_MAX_BYTES` | `8000` | Maximum bytes to read/write for the repository memory prompt section |
| `KASEKI_REPO_MEMORY_ROOT` | `/cache/repo-memory` | Directory root for repository memory summaries |

### Docker and Images

| Variable | Default | Notes |
|---|---|---|
| `KASEKI_IMAGE` | `docker.io/cyanautomation/kaseki-agent:latest` | Docker image to use |
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
| `KASEKI_API_URL` | `http://localhost:8080/api` | Client-side API base URL for npm task commands |
| `KASEKI_API_KEY` | — | Client-side bearer token for npm task commands |
| `KASEKI_API_KEYS` | — | Comma-separated API keys accepted by the service |
| `KASEKI_API_PORT` | 8080 | HTTP listen port |
| `KASEKI_API_LOG_LEVEL` | info | Log verbosity: debug/info/warn/error |
| `KASEKI_API_MAX_CONCURRENT_RUNS` | 3 | Max concurrent jobs |
| `KASEKI_RESULTS_DIR` | `/agents/kaseki-results` | Results artifact directory |
| `GITHUB_APP_ID_FILE` | — | Path to file containing GitHub App ID for PR creation |
| `GITHUB_APP_CLIENT_ID_FILE` | — | Path to file containing GitHub App Client ID |
| `GITHUB_APP_PRIVATE_KEY_FILE` | — | Path to GitHub App private key file; preferred over inline private key env |

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

## Git Object Cache Behavior

`kaseki-agent.sh` can reuse host-mounted Git object caches before dependency installation:

1. Build a safe cache key from `REPO_URL` and store the bare mirror at `/cache/git/<repo-key>.git`.
2. Serialize mirror population and updates with `flock` on a per-repository lock file.
3. On cache hit, refresh the mirror with `git -C <mirror> fetch --prune --tags origin` under a timeout.
4. Clone `/workspace/repo` with `git clone --reference-if-able <mirror> --depth 1 --branch "$GIT_REF" "$REPO_URL" /workspace/repo`.
5. If the reference clone cannot be used, try cloning from the mirror and then reset the workspace origin back to `REPO_URL`.
6. If the mirror is disabled, unavailable, corrupt, or cannot be refreshed/populated, fall back to the existing direct shallow clone.

Set `KASEKI_GIT_CACHE_MODE=off` to disable Git mirror caching. Clone duration plus cache mode/status/hit/key/strategy data are emitted to `stage-timings.tsv`, `progress.jsonl`, and `metadata.json`.

### Repository Memory Cache

Repository memory is disabled by default. Set `KASEKI_REPO_MEMORY_MODE=summary` to opt in to a compact prompt-context cache for the target repository and ref. Kaseki stores this summary at `${KASEKI_REPO_MEMORY_ROOT}/<repo-key>/summary.md`, where `KASEKI_REPO_MEMORY_ROOT` defaults to `/cache/repo-memory` and `<repo-key>` is derived from the repository URL and default ref. Before invoking the agent, Kaseki appends a clearly labeled “Prior repository context” section only when the summary exists, is within `KASEKI_REPO_MEMORY_TTL_DAYS`, and is no larger than `KASEKI_REPO_MEMORY_MAX_BYTES`.

After a successful run, or an inspect-mode run where the agent completed and the secret scan passed, Kaseki rewrites the summary from bounded, sanitized artifacts: `result-summary.md`, `analysis.md`, `changed-files.txt`, and validation timing/status outcomes. The summary records the repo URL, default ref, commit SHA, and timestamp so stale context is visible to the next agent. Kaseki does not blindly persist raw logs or user prompts, and lines resembling secrets, credentials, API keys, tokens, or prompt text are filtered out before writing memory.

This memory is an efficiency feature, not an authoritative source of truth. Agents should use it only as hints and must inspect the current repository state before relying on prior context.

---

## Dependency Install Behavior

`kaseki-agent.sh` prepares dependencies in this order:

1. Skip if no `package.json`
2. Skip if `node_modules` exists and the external dependency stamp matches the lock hash
3. Try workspace cache hit at `$KASEKI_DEPENDENCY_CACHE_DIR/npm/<lock_hash>/node-<major>/flags-<flags_hash>/node_modules`
4. Try image seed cache hit at `$KASEKI_IMAGE_DEPENDENCY_CACHE_DIR/npm/<lock_hash>/node-<major>/flags-<flags_hash>/node_modules`
5. Refresh with `npm ci --prefer-offline` plus the active install-mode flags
6. Atomically publish `node_modules` back to the workspace cache for reuse

The primary cache boundary is lockfile-first: `npm/<lock_hash>/node-<major>/flags-<flags_hash>`. The `flags_hash` covers install-mode switches such as `KASEKI_NPM_OMIT_DEV` and `KASEKI_INSTALL_IGNORE_SCRIPTS`, so incompatible installs do not share `node_modules`. Repo/ref information is recorded as metadata in cache logs and `repo-ref-metadata.tsv`, but it is not part of the reuse key; two refs with the same lockfile, Node major version, and install flags can reuse the same dependency cache path.

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

## Troubleshooting: Too Many Files Restored?

When you run kaseki with a targeted task, you might see many files being "restored" (reverted) because they fall outside the allowlist. This is expected behavior—but here's how to fix it:

### Symptoms

- Run completes but `restoration-report.md` shows 20+ files were restored
- Only a few files were kept in the allowlist
- `kaseki-report` shows "Allowlist coverage: 5/25 files (20%)"

### Quick Fix: Use a Better Template

1. **Check what type of task you're running:**
   - Fixing a UI component? Use `templates/allowlist-ui-component.txt`
   - Fixing an API endpoint? Use `templates/allowlist-api-route.txt`
   - Fixing a utility function? Use `templates/allowlist-utility.txt`

2. **Run with the template:**

   ```bash
   KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-ui-component.txt | tr '\n' ' ')" ./run-kaseki.sh
   ```

### Deep Dive: Understanding Restoration

1. **Look at the restoration report:**

   ```bash
   cat /agents/kaseki-results/kaseki-N/restoration-report.md
   ```

   This shows exactly which files were kept vs. restored.

2. **Auto-generate a better allowlist:**

   ```bash
   ./scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-N
   ```

   This analyzes what files were actually changed and suggests patterns.

3. **Preview before running:**

   ```bash
   ./scripts/dry-run-allowlist.sh --changed-files /agents/kaseki-results/kaseki-N/changed-files.txt \
     --allowlist "src/lib/** tests/**"
   ```

   This shows what WOULD be restored with a given allowlist.

### Root Causes

**Allowlist too narrow:**

- ❌ `KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts"` (single file only)
- ✅ `KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/**"` (file + tests)

**TASK_PROMPT too vague:**

- ❌ "Fix the bug"
- ✅ "Fix the null-reference bug in src/lib/parser.ts. Do not modify other files."

**Task affects multiple files:**

- Build a better allowlist by running suggest-allowlist.sh
- Or use a broader template (allowlist-comprehensive.txt)

### More Information

- Full guide: [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md)
- Prompt best practices: [docs/TASK_PROMPT_TEMPLATES.md](docs/TASK_PROMPT_TEMPLATES.md)
- Auto-generate patterns: `./scripts/suggest-allowlist.sh <results-dir>`
- Preview patterns: `./scripts/dry-run-allowlist.sh --help`

---

## License and Contributing

See the repository for contribution guidelines and license information.
