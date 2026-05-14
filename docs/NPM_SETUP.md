# NPM Package Setup Guide

This guide covers installing and using `@cyanautomation/kaseki-agent` as an npm package. The npm CLI is primarily an admin/helper toolbox (`doctor`, `setup`, `config`, and `secrets`) plus a client for API-backed task workflows.

## Installation

### Global install (recommended)

```bash
npm install -g @cyanautomation/kaseki-agent
kaseki-agent --help
```

### Local project install

```bash
npm install @cyanautomation/kaseki-agent
npx kaseki-agent --help
```

Use the same commands through `npx` when you do not want a global install:

```bash
npx kaseki-agent doctor
npx kaseki-agent setup
npx kaseki-agent config show
npx kaseki-agent secrets list
```

## Requirements

| Requirement | Needed for | Description |
|-------------|------------|-------------|
| **Node.js v24 or higher** | All npm workflows | JavaScript runtime for the CLI |
| **npm** | Install and `npx` usage | Package manager |
| **git** | Setup checks and agent service runs | Repository access |
| **Docker** | Local API service / worker execution | Required by the Kaseki API service when it launches agent containers; not required to print command help |
| **Kaseki API service** | `run`, `list`, `report`, `status`, `stop`, `cancel` | Local service from `kaseki-agent serve` or a remote controller configured with `KASEKI_API_URL` |
| **OpenRouter credentials** | Agent execution | Used by workers that run coding-agent tasks |

## Primary npm workflows

### 1. `doctor` — verify the host and configuration

Run this after install and any time the host changes:

```bash
kaseki-agent doctor
```

Use help or JSON output in automation without starting Docker containers:

```bash
kaseki-agent doctor --help
kaseki-agent doctor --json
```

`doctor` validates the local host dependencies, configuration files, auth files, Docker availability, image status, and disk space. It is the fastest way to confirm whether this machine can host Kaseki services or workers.

### 2. `setup` — first-time interactive configuration

```bash
kaseki-agent setup
```

The setup wizard validates the environment, prompts for key settings, stores credentials, writes config in the selected scope, and suggests follow-up checks.

### 3. `config` — inspect and edit configuration

```bash
# Show effective configuration
kaseki-agent config show

# Store a user-global API controller URL for task commands
kaseki-agent config set api.base_url http://localhost:8080/api --global

# Store a bearer token for an authenticated controller
kaseki-agent config set api.key sk-your-kaseki-api-key --global

# Inspect locations that can provide config
kaseki-agent config locations
```

Project config can live in `kaseki-agent.json`; user-global config lives under `~/.kaseki/`.

### 4. `secrets` — manage local secret material

```bash
# Initialize the secret backend when needed
kaseki-agent secrets init

# Store an OpenRouter key for local worker execution
kaseki-agent secrets set openrouter-api-key sk-or-...

# Store a Kaseki API client key for an authenticated controller
kaseki-agent secrets set kaseki-api-key sk-your-kaseki-api-key

# List and inspect stored secret names
kaseki-agent secrets list
kaseki-agent secrets get openrouter-api-key

# Explicitly print a value when you really need it
kaseki-agent secrets get openrouter-api-key --show
```

On headless Linux hosts, secrets can fall back to files under `~/.kaseki/secrets/` with restrictive permissions.

## API-backed task commands

The following commands are API clients. They do **not** run the agent directly from the npm process. They require either:

1. a local API service listening at the default `http://localhost:8080/api`, or
2. `KASEKI_API_URL` / `api.base_url` pointing at an existing Kaseki controller API.

Start a local API service when this host should execute work:

```bash
# For local-only unauthenticated development on localhost
kaseki-agent serve --port 8080

# For authenticated or network-exposed service mode
KASEKI_API_KEYS=sk-dev kaseki-agent serve --port 8080
```

Point the CLI at a controller API when the service is elsewhere:

```bash
export KASEKI_API_URL=https://controller.example.com/api
export KASEKI_API_KEY=sk-your-kaseki-api-key
```

### `run` — submit a task

```bash
kaseki-agent run https://github.com/your-org/your-repo main \
  "Fix the TypeScript errors in src/"
```

`run` submits `repoUrl`, `gitRef`, and `taskPrompt` to `POST /api/runs`, then prints the returned run ID and status URL.

### `list` — list API-known runs

```bash
kaseki-agent list
kaseki-agent list --status completed
kaseki-agent list --status failed
```

`list` reads the controller's run index from `GET /api/runs`. It does not scan local result directories.

### `report` — retrieve API-backed run diagnostics

```bash
kaseki-agent report kaseki-1
```

By default, `report` calls API status, analysis, artifact, and log endpoints. For legacy local-result inspection without an API, opt in explicitly:

```bash
kaseki-agent report kaseki-1 --from-disk
```

### `status` — poll one run

```bash
kaseki-agent status kaseki-1
kaseki-agent status kaseki-1 --json
```

`status` reads `GET /api/runs/:id/status` and exits non-zero only when a terminal API result reports failure.

### `stop` / `cancel` — cancel queued or running work

```bash
kaseki-agent stop kaseki-1
# equivalent:
kaseki-agent cancel kaseki-1
```

Both commands call the controller API cancel endpoint and require the same API URL/auth configuration as `run` and `status`.

## Environment and config keys

| Key | Type | Used by | Description |
|-----|------|---------|-------------|
| `KASEKI_API_URL` | Environment | npm API-client commands | Base URL for task commands, for example `http://localhost:8080/api` or `https://controller.example.com/api`. Overrides config. |
| `KASEKI_API_BASE_URL` | Environment | npm API-client commands | Backward-compatible alias for `KASEKI_API_URL`. |
| `KASEKI_API_KEY` | Environment | npm API-client commands | Bearer token sent to an authenticated API service. Overrides config. |
| `api.base_url` | Config | npm API-client commands | Persistent base URL used when `KASEKI_API_URL` is unset. |
| `api.key` | Config | npm API-client commands | Persistent bearer token used when `KASEKI_API_KEY` is unset. |
| `api.keys` | Config | npm API-client commands | Legacy list; the first key is used as the client bearer token if `api.key` is unset. |
| `KASEKI_API_KEYS` | Environment | API service | Comma- or newline-separated bearer tokens accepted by `kaseki-agent serve`. Required before exposing the service on non-localhost interfaces. |
| `OPENROUTER_API_KEY_FILE` | Environment/config auth | Worker execution | Path to an OpenRouter API key file used by agent workers. |
| `KASEKI_ROOT` | Environment | Host/service paths | Base directory for Kaseki run and result data. |
| `KASEKI_RUNS_DIR` | Environment | Host/service paths | Per-run workspace root. |
| `KASEKI_RESULTS_DIR` | Environment | Host/service paths | Persistent run artifact directory. |
| `KASEKI_MODEL` | Environment | Worker execution | Model identifier passed to the coding agent. |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | Environment | Worker execution | Agent execution timeout. |
| `KASEKI_VALIDATION_COMMANDS` | Environment | Worker validation | Semicolon-separated validation commands run after agent changes. |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | Environment | Quality gates | Space-separated file patterns allowed in the final diff. |

## Minimal local development flow

```bash
npm install -g @cyanautomation/kaseki-agent
kaseki-agent doctor --help
kaseki-agent setup
kaseki-agent config set api.base_url http://localhost:8080/api --global

# Start the API service in one terminal.
KASEKI_API_KEYS=sk-dev kaseki-agent serve --port 8080

# Use the API-backed client commands in another terminal.
KASEKI_API_KEY=sk-dev kaseki-agent run https://github.com/your-org/your-repo main "Make the requested change"
KASEKI_API_KEY=sk-dev kaseki-agent status kaseki-1
KASEKI_API_KEY=sk-dev kaseki-agent report kaseki-1
```

## Troubleshooting

- Use `kaseki-agent --help` and `<command> --help` to verify CLI installation without Docker or an API service.
- If `run`, `list`, `report`, `status`, `stop`, or `cancel` fail with a connection error, start `kaseki-agent serve` locally or set `KASEKI_API_URL` to a reachable controller.
- If the API returns `401`, set `KASEKI_API_KEY` or `api.key` to one of the service-side `KASEKI_API_KEYS` values.
- If `doctor` reports Docker failures, the admin workflows still work, but local task execution through `kaseki-agent serve` will not launch workers successfully until Docker is installed and running.
