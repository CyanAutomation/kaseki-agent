# Kaseki Agent

[![CI](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/codeql.yml)
[![Create A Release](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/release.yml)
[![Publish Docker Image](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/build-docker-image.yml/badge.svg?branch=main)](https://github.com/CyanAutomation/kaseki-agent/actions/workflows/build-docker-image.yml)


Kaseki Agent is a Docker-based coding-agent runner with a REST API, a command-line client, and a browser console. The API schedules tasks in disposable worker containers; each worker checks out a target repository, runs the Pi coding agent through an OpenAI-compatible gateway, validates changes, and collects results.

Kaseki Agent is currently presented as a proof of concept. Its documented guided API deployment supports Debian 12/13 and 64-bit Raspberry Pi OS. The `/ready` check confirms API startup; it does not validate gateway credentials or model availability by making an inference request.

## Choose your path

| Goal | Start here | Requirements |
| --- | --- | --- |
| Deploy an API host | [Raspberry Pi quick start](docs/QUICK_START.md) | Debian 12/13 or 64-bit Raspberry Pi OS; the guide installs Docker if needed |
| Install the CLI client | [Quick start below](#quick-start-api-host-and-cli-client) and [npm setup](docs/NPM_SETUP.md) | Linux, Node.js 24 or later, npm |
| Develop Kaseki Agent | [Development guide](docs/DEVELOPMENT.md) and [contribution guide](CONTRIBUTING.md) | Linux, Node.js 24 or later, npm |

The published Docker image runs API or worker workloads; it is not an npm CLI installation. For container deployment, follow the [deployment guide](docs/DEPLOYMENT.md).

## Quick start: API host and CLI client

### 1. Set up the API host

On the API host, follow the [Pi quick-start guide](docs/QUICK_START.md) to install and configure the service. The guided setup configures the gateway URL, stores credentials in files, pins the image digest, and starts the API. The API binds to loopback by default. Its bearer token controls Docker-backed task execution, so treat it like an administrator credential.

### 2. Connect a Linux workstation

The examples below use an SSH tunnel, which works with the API's default loopback bind. Keep the tunnel open in one terminal:

```bash
ssh -N -L 8080:127.0.0.1:8080 pi@your-pi-host
```

In another terminal on the workstation, copy the API token file from the host. The CLI discovers this file at `~/.kaseki/secrets/kaseki_api_keys` and reads its first non-empty line. Restrict local access to the copied credential:

```bash
mkdir -p ~/.kaseki/secrets
chmod 700 ~/.kaseki/secrets
scp pi@your-pi-host:~/secrets/kaseki_api_keys ~/.kaseki/secrets/kaseki_api_keys
chmod 600 ~/.kaseki/secrets/kaseki_api_keys
```

Install the CLI and submit a task through the tunnel:

```bash
npm install -g @cyanautomation/kaseki-agent
KASEKI_API_URL=http://localhost:8080/api/v1 \
  kaseki-agent run https://github.com/owner/repo main "Fix the failing tests"
```

The CLI prints the run ID. Use it to monitor the task and retrieve its report:

```bash
KASEKI_API_URL=http://localhost:8080/api/v1 kaseki-agent status kaseki-1
KASEKI_API_URL=http://localhost:8080/api/v1 kaseki-agent report kaseki-1
```

Replace `kaseki-1` with the ID returned by `run`. `status` prints one snapshot; run it again to refresh while a task is active. For other API access patterns, secret locations, or local development, see the [npm setup guide](docs/NPM_SETUP.md) and [API reference](docs/API.md).

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
- `kaseki-agent cleanup` - Manage retention of run artifacts and matching host logs (keep last N runs)

See [docs/CLI.md](docs/CLI.md) for command usage details and the live monitoring CLI.

### Direct worker containers

When running a worker container directly, mount `/results` read-write. A missing or read-only mount fails scouting or validation with exit code 86. For complete container invocation and deployment requirements, use the [deployment guide](docs/DEPLOYMENT.md).

---

## Configuration

### Authentication

- **Config file** (recommended): `~/.kaseki/config.json`
- **Environment variables**: `LLM_GATEWAY_API_KEY_FILE`, `GITHUB_APP_*_FILE`
- **Pi Compose secrets**: host files under `~/secrets`, mounted read-only at `/run/secrets/kaseki/`

### Environment Variables

See [docs/ENV_VARS.md](docs/ENV_VARS.md) for complete configuration reference.

#### Key Environment Variables

| Variable | Default | Notes |
| --- | --- | --- |
| `LLM_GATEWAY_URL` | *(required)* | OpenAI-compatible gateway base URL |
| `LLM_GATEWAY_API_KEY_FILE` | `/run/secrets/kaseki/llm_gateway_api_key` in Docker | Required; keep the key in a host file with mode 0640 and group 10000 |
| `KASEKI_MODEL` | `dynamic/kaseki-agent` | Pi model string |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test` | Semicolon-separated |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `10800` | Agent timeout (3 hours) |
| `KASEKI_MAX_DIFF_BYTES` | `400000` | Max diff size (400 KB) |
| `KASEKI_RETENTION_RUNS` | `5` | Runs kept between executions |
| `REPO_URL` | https://github.com/CyanAutomation/crudmapper | Target repo (single-run) |
| `GIT_REF` | `main` | Branch/tag/commit (single-run) |
| `TASK_PROMPT` | *(code fix task)* | Agent instruction (single-run) |

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

**Base URL:** `http://<host>:<port>/ui` (default `http://localhost:8080/ui`). Set the server bind port with `kaseki-agent serve --port PORT`; `KASEKI_API_URL` configures the CLI client target, not the server bind address.

**Authentication:** Enter a bearer token in the console's header field. API requests include `Authorization: Bearer <token>`. The server accepts keys from `KASEKI_API_KEYS` or its configured key file; see the [API authentication reference](docs/API.md#authentication).

**Usage examples:**

```bash
# Health check (no auth required)
curl http://localhost:8080/health

# Health check with bearer token
curl -H "Authorization: Bearer sk-kaseki-..." http://localhost:8080/api/v1/preflight

# Submit a task run via the API
# Generate a fresh UUID v4 for each new request; reuse it only for retries.
curl -X POST http://localhost:8080/api/v1/runs \
  -H "Authorization: Bearer sk-kaseki-..." \
  -H "Idempotency-Key: 123e4567-e89b-42d3-a456-426614174000" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/org/repo",
    "ref": "main",
    "taskPrompt": "Fix the failing test",
    "publishMode": "none"
  }'

# Access the Task Console in browser
open http://localhost:8080/ui
```

The submit endpoint responds with HTTP `202 Accepted` and a run object. A successful response looks like this:

```json
{
  "id": "kaseki-123",
  "status": "queued",
  "createdAt": "2026-10-12T12:00:00.000Z"
}
```

Use the returned `id` with the status and report commands above. This example sets `publishMode` to `none`, so it does not require GitHub App credentials. See [authentication setup](docs/AUTH_SETUP.md) to configure credentials for pull-request publishing.

**Tabs:**

- **Health** — Preflight checks and recent run status
- **Issues** — Browse GitHub issues
- **Submit Task** — Submit a coding task with repo, ref, and prompt

The local API operation index is available at `/docs`; the full OpenAPI specification is at `/api/v1/openapi.json`.

### Programmatic Usage

For integrations, query `GET /api/v1/runs/{id}/status` for the current state, `GET /api/v1/runs/{id}/events` for structured progress, or `GET /api/v1/runs/{id}/events/stream` for live updates. The [API reference](docs/API.md) documents authentication, response schemas, analysis, artifacts, and webhook behavior.

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

## Local development

The npm package targets Linux. Development requires Node.js 24 or later, npm, and ShellCheck (used by `npm run check`). From a checkout:

```bash
npm ci
npm run check
npm test
```

`npm test` builds the project before running the unit suite. See [development](docs/DEVELOPMENT.md) and [contributing](CONTRIBUTING.md) for additional workflows.

For an optional live Cloudflare gateway probe, configure `LLM_GATEWAY_URL` and `LLM_GATEWAY_API_KEY` in your shell, then run `npm run test:integration:cloudflare-gateway`. This makes a live network request and may use gateway tokens; see [gateway testing](docs/GATEWAY_TEST.md).

## Troubleshooting

- Check `node -v` if the CLI reports a runtime or module error; Node.js 24 or later is required.
- Check `curl http://localhost:8080/health` to confirm that the API responds. This unauthenticated endpoint reports service health, not gateway inference readiness.
- Use the authenticated `GET /api/v1/preflight` endpoint for controller diagnostics. See [API documentation](docs/API.md#authentication) and the [troubleshooting guide](docs/TROUBLESHOOTING.md).

---

## Resources

### Documentation

- [Quick Start Guide](docs/QUICK_START.md) - Step-by-step setup
- [NPM Setup](docs/NPM_SETUP.md) - CLI installation, configuration, and API client setup
- [CLI Reference](docs/CLI.md) - Command-line monitoring tools
- [API Documentation](docs/API.md) - REST API specification
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment
- [Environment Variables](docs/ENV_VARS.md) - Configuration reference
- [Development Guide](docs/DEVELOPMENT.md) - Architecture and developer workflows
- [Contribution Guide](CONTRIBUTING.md) - Contribution process and standards
- [Exit Codes](docs/EXIT_CODES.md) - Run outcomes and diagnostic codes
- [Soyuz Host Integration](docs/SOYUZ_INTEGRATION.md) - Queue adapter setup, recovery, and operations
- [Advanced Configuration](docs/ADVANCED_CONFIG.md) - Detailed setup options
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues and solutions

### Community

- **Issues**: [GitHub Issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- **Releases**: [GitHub Releases](https://github.com/CyanAutomation/kaseki-agent/releases)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

**CyanAutomation** - Building reliable AI coding workflows
