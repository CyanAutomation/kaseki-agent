# Kaseki Agent

[![CI](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml)
[![Create A Release](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/release.yml)
[![Publish Docker Image](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/build-docker-image.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/build-docker-image.yml)


Kaseki is a proof-of-concept ephemeral coding-agent runner. Each run creates a numbered, disposable container instance (kaseki-1, kaseki-2, etc.) that orchestrates the Pi coding-agent via a generic LLM gateway (Manifest, OpenAI, Ollama, etc.).

## Quick Start

### 1. Install Setup

```bash
# Global install (recommended)
npm install -g @cyanautomation/kaseki-agent

# One-command setup with auto-detection
kaseki-agent init
```

Or use Docker:

```bash
docker run -it docker.io/cyanautomation/kaseki-agent:latest init
```

### 2. Configure Authentication

The setup wizard will guide you through providing:

- **LLM Gateway URL** (required): Your LLM provider endpoint (e.g., `https://llmgateway.local.xyz/v1/responses`)
- **LLM Gateway API Key** (required): Authentication token for your provider
- **GitHub App Credentials** (optional): App ID, Client ID, Private Key


### CloudFlare Gateway Live Probe

The Jest suite uses deterministic unit/contract coverage for CloudFlare gateway behavior and mocks `fetch`; it does not perform live network calls or consume gateway tokens. To run the live CloudFlare probe explicitly, use:

```bash
CLOUDFLARE_GATEWAY_TEST=1 \
LLM_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat \
LLM_GATEWAY_API_KEY=<token> \
npm run test:integration:cloudflare-gateway
```

The live probe requires `CLOUDFLARE_GATEWAY_TEST=1`, a configured `LLM_GATEWAY_URL`, either `LLM_GATEWAY_API_KEY` or `LLM_GATEWAY_API_KEY_FILE`, and working token/network access to CloudFlare. `LLM_GATEWAY_MODEL` is optional and defaults to `dynamic/kaseki-agent`.

### 3. Run Your First Task

```bash
# Start API service (Docker Compose recommended)
docker-compose up -d

# Submit a task
kaseki-agent run https://github.com/CyanAutomation/crudmapper main \
  "Add input validation to all POST endpoints"
```

### 4. Monitor Results

```bash
# List all instances
kaseki-agent list

# Get detailed report
kaseki-agent report kaseki-1

# Live monitoring
kaseki-agent status kaseki-1
```

### 5. Run API Locally

```bash
# Start local API on port 8080
kaseki-agent serve --port 8080 &

# Health check (no auth required)
curl http://localhost:8080/health

# Authenticated endpoint
KASEKI_API_KEYS=sk-local-secret \
  curl -H "Authorization: Bearer sk-local-secret" \
  http://localhost:8080/api/preflight

# Override default URL
KASEKI_API_URL=http://localhost:9090 kaseki-agent serve --port 9090
```

---

## Overview

Kaseki provides three deployment patterns:

- **NPM CLI**: Admin/helper workflows and task clients
- **Docker**: Containerized execution without host Node.js
- **REST API**: Local/distributed orchestration via `kaseki-agent serve`

Each task execution produces isolated workspace and results for reproducible AI coding workflows.

---

## Development

- Node.js >= 24 required
- Install dependencies: `npm ci`
- Run validation: `npm run check`

Structural summaries are available for TypeScript and JavaScript files. Go files and unsupported languages are read in full.

---

## Troubleshooting

### Node.js 24+ Runtime Required

Kaseki requires Node.js version 24 or later. Earlier versions will fail during module resolution or syntax parsing. Verify your Node.js version before running:

```bash
node -v
```

Upgrade using your system package manager or nvm if the version is below 24.

### GET /health Endpoint Usage

The API service exposes an unauthenticated health check endpoint for monitoring:

```bash
# Basic health check (no authentication required)
curl http://localhost:8080/health
```

A 200 OK response confirms the Kaseki API service is running. Non-200 responses indicate the service is unavailable or not yet started.

### GET /api/preflight Endpoint with Authentication

The preflight endpoint validates controller configuration (Docker, image, GitHub App) and requires Bearer token authentication:

```bash
# Preflight with Bearer token
curl -H "Authorization: Bearer sk-kaseki-secret-key" \
  http://localhost:8080/api/preflight
```

The endpoint returns diagnostic information about container state, image availability, and provider readiness. Requests require a valid API key configured in `KASEKI_API_KEYS`. Without valid credentials, the endpoint returns 401 Unauthorized.

## Installation

### Global NPM (Recommended)

```bash
npm install -g @cyanautomation/kaseki-agent
```

### Local NPM

```bash
npm install @cyanautomation/kaseki-agent
npx kaseki-agent init
```

### Docker

```bash
docker run -it docker.io/cyanautomation/kaseki-agent:latest init
```

---

## Basic Usage

### CLI Commands

All 15 commands registered by `src/cli/KasekiCLI.ts`:

- `kaseki-agent quickstart` - One-command setup: detect, bootstrap /agents, start API, smoke-test
- `kaseki-agent init` - Unified setup wizard (single-run, local API, or production)
- `kaseki-agent setup` - (DEPRECATED: use `init` instead) Interactive setup wizard
- `kaseki-agent run [repo] [ref] [prompt]` - Submit a task run through the local Kaseki API
- `kaseki-agent doctor` - Health checks and dependency validation
- `kaseki-agent serve` - Start the local REST API service for async task execution
- `kaseki-agent config` - Manage configuration
- `kaseki-agent list` - List task runs through the local Kaseki API
- `kaseki-agent report [instance]` - Generate a task report through the local Kaseki API
- `kaseki-agent status [instance]` - Poll task status through the local Kaseki API
- `kaseki-agent cancel [run-id]` - Cancel a queued or running task through the local Kaseki API
- `kaseki-agent stop [run-id]` - Alias for `cancel`; stops a task through the local Kaseki API
- `kaseki-agent secrets` - Manage stored secrets (keyring/file)
- `kaseki-agent host` - Prepare or recover a Docker Compose API host
- `kaseki-agent cleanup` - Manage retention of kaseki run artifacts (keep last N runs)

See [docs/CLI.md](docs/CLI.md) for command usage details and the live monitoring CLI.

### Task Execution

```bash
# Basic task
kaseki-agent run https://github.com/owner/repo main "Fix TypeScript errors"

# With custom API URL
KASEKI_API_URL=http://localhost:8080/api \
  kaseki-agent run https://github.com/owner/repo main "Add unit tests"

# Monitor progress
kaseki-agent status kaseki-1 --follow
```

> **Docker volume mounts:** Direct `docker run` invocations must mount `/results` read-write. A missing or `:ro` mount fails scouting/validation with exit code 86.

```bash
# Correct: /results mounted read-write
docker run -v /path/to/results:/results:rw docker.io/cyanautomation/kaseki-agent:latest
```

---

## Configuration

### Authentication

- **Config file** (recommended): `~/.kaseki/config.json`
- **Environment variables**: `LLM_GATEWAY_API_KEY_FILE`, `GITHUB_APP_*_FILE`
- **Docker secrets**: Mount `/secrets` volume

### Environment Variables

See [docs/ENV_VARS.md](docs/ENV_VARS.md) for complete configuration reference.

#### Key Environment Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_GATEWAY_URL` | `https://llmgateway.local.xyz/v1` | Required; Pi CLI appends endpoint path |
| `LLM_GATEWAY_API_KEY_FILE` | `~/.kaseki/secrets.json` | Required; secret file (mode 0600) |
| `KASEKI_MODEL` | `dynamic/kaseki-agent` | Pi model string |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Semicolon-separated |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `10800` | Agent timeout (3 hours) |
| `KASEKI_MAX_DIFF_BYTES` | `400000` | Max diff size (400 KB) |
| `KASEKI_RETENTION_RUNS` | `5` | Runs kept between executions |
| `REPO_URL` | https://github.com/CyanAutomation/crudmapper | Target repo (single-run) |
| `GIT_REF` | `main` | Branch/tag/commit (single-run) |
| `TASK_PROMPT` | *(code fix task)* | Agent instruction (single-run) |

See [docs/ENV_VARS.md](docs/ENV_VARS.md) for the complete reference.

#### Quality Gates and Exit Codes

Quality gates run after the agent completes, before reporting success:

| Gate | Exit Code | Variable |
| --- | --- | --- |
| Missing API key / config | 2 | — |
| Empty git diff | 3 | — |
| Diff exceeds max bytes | 4 | `KASEKI_MAX_DIFF_BYTES` |
| Changed file outside allowlist | 5 | `KASEKI_CHANGED_FILES_ALLOWLIST` |
| Secret scan hit (sk-or-* leak NOT in allowlist) | 6 | `.kaseki-secret-allowlist` |
| Validation phase files outside allowlist | 7 | `KASEKI_VALIDATION_ALLOWLIST` |
| Provider/model error (non-retryable after retry) | 88 | — |
| Pi agent timeout | 124 | `KASEKI_AGENT_TIMEOUT_SECONDS` |

### Deployment Options

- **Docker Compose**: Production deployment with persistent API
- **Single-run**: Ephemeral execution for CI/CD
- **Local API**: Development and testing

---

## API Reference

### REST API

Start local API service:

```bash
kaseki-agent serve --port 8080
```

### Kaseki Task Console

Web UI served at `/ui` (and `/`) by `kaseki-agent serve`. Use it to monitor health, browse GitHub issues, and submit tasks.

**Base URL:** `http://<host>:<port>/ui` (default `http://localhost:8080/ui`).
Override host/port with `KASEKI_API_URL` env var (e.g., `KASEKI_API_URL=http://localhost:9090`).

**Authentication:** Bearer token. Enter token in the header input field or set `KASEKI_API_KEY` env var. Requests to authenticated endpoints include `Authorization: Bearer <token>`.
Server validates tokens listed in `KASEKI_API_KEYS` config (comma-separated).

**Usage examples:**

```bash
# Health check (no auth required)
curl http://localhost:8080/health

# Health check with bearer token
curl -H "Authorization: Bearer sk-kaseki-..." http://localhost:8080/api/preflight

# Submit a task run via the API
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-kaseki-..." \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "https://github.com/org/repo",
    "ref": "main",
    "prompt": "Fix the failing test"
  }'

# Access the Task Console in browser
open http://localhost:8080/ui
```

**Tabs:**

- **Health** — Preflight checks and recent run status
- **Issues** — Browse GitHub issues
- **Submit Task** — Submit a coding task with repo, ref, and prompt

Swagger API documentation available at `/docs`.

### Programmatic Usage

- **Live monitoring**: Query running instances
- **Error detection**: Identify failures and anomalies
- **Post-run analysis**: Detailed result summaries
- **Log streaming**: Real-time log consumption
- **Automatic review requests**: PRs on personal repositories automatically request the owner as a reviewer

See [docs/API.md](docs/API.md) and [docs/CLI.md](docs/CLI.md) for complete API and CLI documentation.

---

## Architecture

Kaseki orchestrates ephemeral coding-agent instances with:

- **Host layer**: Workspace management, credential resolution, Docker runtime
- **Container layer**: Git cloning, dependency caching, Pi agent invocation
- **Result layer**: Artifact collection, validation gates, quality metrics
- **API layer**: REST service for external orchestration

Each run produces isolated workspace with:

- Repository clone at target ref
- Node.js dependency cache
- Pi agent execution
- Validation and quality gates
- Comprehensive result artifacts

---

## Resources

### Documentation

- [Quick Start Guide](docs/QUICK_START.md) - Step-by-step setup
- [CLI Reference](docs/CLI.md) - Command-line monitoring tools
- [API Documentation](docs/API.md) - REST API specification
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Environment Variables](docs/ENV_VARS.md) - Configuration reference
- [Advanced Configuration](docs/ADVANCED_CONFIG.md) - Detailed setup options
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

### Community

- **Issues**: [GitHub Issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- **Discussions**: GitHub Discussions
- **Updates**: Follow for releases and announcements

---

## License

MIT License - see [LICENSE](LICENSE) for details.

**CyanAutomation** - Building reliable AI coding workflows
