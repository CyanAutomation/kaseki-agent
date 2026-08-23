# Kaseki Agent CLI Reference

The **Kaseki Agent CLI** (`kaseki-agent`) is a unified command-line interface for managing task runs, inspecting results, configuring the system, and maintaining health. It is distributed as a single compiled binary (`dist/cli.js`) installed via `npm install -g @cyanautomation/kaseki-agent`.

## Installation

```bash
npm install -g @cyanautomation/kaseki-agent
```

This provides the `kaseki-agent` command on your PATH. Run `kaseki-agent --help` to verify installation.

## Architecture

The CLI is a single binary built from TypeScript sources. All commands are dispatched through a central router (`src/cli/KasekiCLI.ts`) with lazy-loaded handlers per subcommand. There is no dual-file split; everything ships in one `dist/cli.js`.

---

## Command Index

| Command | Description | API Required |
|---------|-------------|:---:|
| `quickstart` | One-command production setup | No |
| `init` | Unified setup wizard (recommended) | No |
| `setup` | DEPRECATED — delegates to `init` | No |
| `run` | Submit a task run | Yes |
| `doctor` | Health checks and diagnostics | No |
| `serve` | Start local REST API service | N/A |
| `config` | Manage configuration files | No |
| `list` | List task runs | Yes |
| `report` | Generate a run report | Yes / Disk |
| `status` | Poll task status | Yes |
| `cancel` | Cancel a queued or running task | Yes |
| `stop` | Alias for `cancel` | Yes |
| `secrets` | Manage stored secrets | No |
| `host` | Prepare Docker Compose API hosts | No |
| `cleanup` | Retention management for run artifacts | No |

---

## Commands

### `quickstart`

One-command setup for the production API mode. Runs seven steps: environment detection, secret discovery, config writing, `/agents` bootstrapping, container launch, readiness wait, and auth smoke test.

```bash
USAGE
  kaseki-agent quickstart [--dry-run]

OPTIONS
  --dry-run    Detect and plan without making any changes

WHAT IT DOES
  1. Detects Docker, Node.js, sudo access
  2. Discovers secrets at ~/.kaseki/secrets/, ~/secrets/, or $ENV_VAR
  3. Writes ~/.kaseki/config.json with resolved secret paths
  4. Creates /agents/{kaseki-results,kaseki-runs,kaseki-cache} owned by UID 10000
  5. Starts the kaseki-api container via docker run
  6. Waits for http://localhost:8080/ready body to confirm ready status
  7. Smoke-tests authenticated access to /api/runs

EXAMPLES
  kaseki-agent quickstart                          # Full setup
  kaseki-agent quickstart --dry-run                # Validate without changes
```

---

### `init`

Unified setup wizard for all execution paths (single-run, local API, production). Recommended over `setup`.

```bash
USAGE
  kaseki-agent init [OPTIONS]

OPTIONS
  --dry-run              Validate setup without saving configuration
  --import-legacy        Migrate configuration from old setup paths
  --skip-secrets-setup   Skip automatic secrets directory setup
  --force                Skip permission validation (advanced users only)
  --help, -h             Show this help message

EXAMPLES
  kaseki-agent init                                    # Interactive wizard
  kaseki-agent init --dry-run                          # Dry-run validation
  kaseki-agent init --import-legacy                    # Migrate from legacy setup
```

---

### `setup` (DEPRECATED)

Interactive first-time configuration wizard. Deprecated in favor of `init`; prints a deprecation notice then delegates to the same SetupWizard.

```bash
USAGE
  kaseki-agent setup

NOTE
  This command is deprecated. Use "kaseki-agent init" instead.
```

---

### `run`

Submit a task run through the configured Kaseki API. Requires a local API service (`http://localhost:8080/api`) or `KASEKI_API_URL`. Set `KASEKI_API_KEY` when the API requires bearer-token authentication.

```bash
USAGE
  kaseki-agent run <REPO_URL> [GIT_REF] [TASK_PROMPT] [--dry-run]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.
  Set KASEKI_API_KEY when the API requires bearer-token authentication.

OPTIONS
  --dry-run                  Submit a startup-check run without Pi agent work.
  --baseline-validation      With --dry-run, clone and run baseline validation before exiting.

EXAMPLES
  kaseki-agent run https://github.com/org/repo main "Fix lint errors"
  kaseki-agent run https://github.com/org/repo feature/branch --dry-run
```

---

### `doctor`

Health checks and dependency validation. Checks Docker, Node.js version, npm, git, authentication files, Docker image availability, and disk space. Returns exit code 0 if all checks pass.

```bash
USAGE
  kaseki-agent doctor [--json] [--fix] [--verbose]

OPTIONS
  --json       Emit machine-readable check results
  --fix        Attempt safe auto-remediation for fixable checks
  --verbose    Include more diagnostic context where available

EXAMPLES
  kaseki-agent doctor                                     # Human-readable output
  kaseki-agent doctor --json                              # Machine-readable JSON
  kaseki-agent doctor --fix                               # Auto-fix issues then re-check
```

---

### `serve`

Start the local REST API service for async task execution. Binds to port 8080 by default. Reads `KASEKI_API_KEYS` from environment or config. Runs until interrupted (SIGINT/SIGTERM).

```bash
USAGE
  kaseki-agent serve [--port PORT]

OPTIONS
  --port PORT    Port to bind (default: 8080)

EXAMPLES
  kaseki-agent serve                                    # Default port 8080
  kaseki-agent serve --port 9090                        # Custom port
```

---

### `config`

Manage Kaseki configuration stored in `~/.kaseki/config.json` (global) or `kaseki-agent.json` (project-local). Supports dot-notation keys and nested values.

```bash
USAGE
  kaseki-agent config get <KEY> [--global]
  kaseki-agent config set <KEY> <VALUE> [--global]
  kaseki-agent config show [--global]
  kaseki-agent config locations

OPTIONS
  --global   Use global config (~/.kaseki/config.json) instead of project-local

CONFIGURATION PRECEDENCE
  1. CLI flags (--key=value)
  2. kaseki-agent.json (project-local)
  3. ~/.kaseki/config.json (user-global)
  4. Environment variables (KASEKI_*, OPENROUTER_*)
  5. Built-in defaults

EXAMPLES
  kaseki-agent config get agent.timeout_seconds
  kaseki-agent config set agent.timeout_seconds 1800 --global
  kaseki-agent config show
  kaseki-agent config locations
```

---

### `list`

List task runs through the configured Kaseki API. Shows ID, status, creation time, and duration in table format. Can filter by status.

```bash
USAGE
  kaseki-agent list [--status queued|running|completed|failed]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.

EXAMPLES
  kaseki-agent list                                              # All instances
  kaseki-agent list --status running                             # Running only
  kaseki-agent list --status completed                           # Completed only
```

---

### `report`

Generate a detailed run report showing instance info, changes, validation results, artifact availability, and summary text. Defaults to API mode; use `--from-disk` to read local result files directly.

```bash
USAGE
  kaseki-agent report <RUN_ID> [--from-disk]

REQUIRES
  API mode requires a local API service or KASEKI_API_URL. Use --from-disk to inspect local result files without API access.

EXAMPLES
  kaseki-agent report kaseki-1                              # Via API
  kaseki-agent report kaseki-1 --from-disk                  # From disk
```

---

### `status`

Poll task status through the configured Kaseki API. Returns human-readable output by default; use `--json` for structured output.

```bash
USAGE
  kaseki-agent status <RUN_ID> [--json]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.

STATUS OUTPUT
  State:     current status (queued, running, completed, failed)
  Progress:  stage name with percentage and optional message
  Elapsed:   seconds since run start
  Timeout:   risk percentage (based on elapsed vs timeoutSeconds)
  Exit Code: final exit code after completion
  Failure:   failure class category (validation, timeout, empty-diff, quality, etc.)

FLAGS
  --json    Emit JSON output matching StatusResponse schema

EXAMPLES
  kaseki-agent status kaseki-1                     # Human-readable
  kaseki-agent status kaseki-1 --json              # Structured JSON
```

---

### `cancel`

Cancel a queued or running task through the configured Kaseki API. Sends cancellation request and returns updated status.

```bash
USAGE
  kaseki-agent cancel <RUN_ID> [--json]

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.

FLAGS
  --json    Emit cancellation response as JSON

EXAMPLES
  kaseki-agent cancel kaseki-1                         # Cancel with text output
  kaseki-agent cancel kaseki-1 --json                  # Cancel with JSON output
```

---

### `stop`

Alias for `cancel`. Same behavior, different command name.

```bash
USAGE
  kaseki-agent stop <RUN_ID>

REQUIRES
  A local API service at http://localhost:8080/api or KASEKI_API_URL pointing to a controller API.

EXAMPLES
  kaseki-agent stop kaseki-1
```

---

### `secrets`

Manage stored secrets (API keys, credentials) using filesystem secret files. Keys are never exposed via environment variables. Supports initialization, CRUD operations, permissions auditing, and automated fixes.

```bash
USAGE
  kaseki-agent secrets init
  kaseki-agent secrets set <NAME> <VALUE>
  kaseki-agent secrets get <NAME> [--show]
  kaseki-agent secrets list
  kaseki-agent secrets delete <NAME>
  kaseki-agent secrets doctor
  kaseki-agent secrets fix-permissions
  kaseki-agent secrets help

OPTIONS
  --show    Display the secret value alongside existence confirmation

STORAGE LOCATIONS
  - Local runs:          ~/.kaseki/secrets/ (files 0600)
  - Docker hosts:        KASEKI_HOST_SECRETS_DIR, usually /home/pi/secrets
  - Host contract:       dir 0750, files 0640, group id KASEKI_CONTAINER_GID

REQUIRED HOST SECRETS
  openrouter_api_key      OpenRouter LLM gateway API key
  github_app_id           GitHub App numeric ID
  github_app_client_id    GitHub App client identifier
  github_app_private_key  GitHub App PEM private key
  kaseki_api_keys         Bearer tokens for the API service

EXAMPLES
  kaseki-agent secrets init                                          # Create directories
  kaseki-agent secrets set openrouter_api_key sk-or-...             # Store a key
  kaseki-agent secrets get openrouter_api_key                       # Check existence
  kaseki-agent secrets get openrouter_api_key --show                # Display value
  kaseki-agent secrets list                                         # All stored keys
  kaseki-agent secrets delete my_secret                             # Remove a key
  kaseki-agent secrets doctor                                       # Audit permissions
  kaseki-agent secrets fix-permissions                              # Repair permissions
```

---

### `host`

Prepare or recover a Docker Compose API host. Provides two subcommands: `setup` runs a shell script to bootstrap `/agents`, normalize secrets, and start the container; `preflight` validates connectivity to an existing API.

```bash
USAGE
  kaseki-agent host setup [--fix] [--recreate-api] [--wait-ready]
  kaseki-agent host preflight [--url URL]

OPTIONS (setup)
  --fix            Create/fix /agents, normalize secrets, and bootstrap the template
  --recreate-api   Recreate the kaseki-api container after host paths are fixed
  --wait-ready     Wait for http://127.0.0.1:8080/ready before returning

OPTIONS (preflight)
  --url URL        Preflight endpoint URL (default: http://127.0.0.1:8080/api/preflight)

EXAMPLES
  kaseki-agent host setup                                        # Standard setup
  sudo kaseki-agent host setup --fix --recreate-api --wait-ready # Full recovery
  sudo kaseki-agent host preflight                               # Verify API
  sudo KASEKI_HOST_SECRETS_DIR=/home/pi/secrets kaseki-agent host setup --fix
```

---

### `cleanup`

Manage retention of kaseki run artifacts. Keeps the most recent N runs and deletes older ones. Supports dry-run mode for safety verification. Consults a scheduler-owned durable job index to avoid deleting active jobs.

```bash
USAGE
  kaseki-agent cleanup [--dry-run] [--force] [--count N]

OPTIONS
  --dry-run     Show what would be deleted without actually deleting
  --force       Skip confirmation prompt (for automation)
  --count N     Override KASEKI_RETENTION_RUNS (e.g., --count 5)

ENVIRONMENT VARIABLES
  KASEKI_RETENTION_RUNS  Number of recent runs to keep (default: 5)
  KASEKI_RESULTS_DIR     Path to results directory (default: /agents/kaseki-results)
  KASEKI_CACHE_DIR       Path to cache directory (default: /agents/kaseki-cache)

EXAMPLES
  kaseki-agent cleanup --dry-run          # Preview what would be deleted
  kaseki-agent cleanup --force --count 3  # Keep only 3 recent runs
  kaseki-agent cleanup --force            # Delete according to KASEKI_RETENTION_RUNS
```

---

## External AI Agent Integration

All examples below use shell-based subprocess calls to `kaseki-agent`. No library imports are needed; the CLI emits structured output (JSON or plain text) that external agents can parse.

### Pattern 1: Polling Status

Poll an instance at regular intervals until completion. Watch for timeout risk exceeding 85% and log the outcome.

```bash
#!/bin/bash
# Monitor a kaseki run from an external agent

INSTANCE=$1
POLL_INTERVAL=${2:-5}
MAX_ATTEMPTS=${3:-240}

ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  STATUS=$(kaseki-agent status "$INSTANCE")

  TIMEOUT_RISK=$(echo "$STATUS" | grep 'Timeout:' | awk '{print $2}' | tr -d '%')

  # Alert on timeout risk
  if [ -n "$TIMEOUT_RISK" ] && (( $(echo "$TIMEOUT_RISK >= 85" | bc -l 2>/dev/null || echo 0) )); then
    echo "WARNING: Timeout approaching: ${TIMEOUT_RISK}%"
  fi

  # Check if completed
  if echo "$STATUS" | grep -q 'State:     completed'; then
    EXIT_CODE=$(echo "$STATUS" | grep 'Exit Code:' | awk '{print $3}')
    echo "Completed: exit code $EXIT_CODE"
    break
  fi

  sleep $POLL_INTERVAL
  ATTEMPT=$((ATTEMPT + 1))
done

# Final report
kaseki-agent report "$INSTANCE"
```

### Pattern 2: Error Detection

Check an instance for errors and escalate critical failures.

```bash
#!/bin/bash
# Detect and react to errors on a kaseki instance

INSTANCE=$1

# Check overall status
STATUS=$(kaseki-agent status "$INSTANCE" --json)
FAILURE_CLASS=$(echo "$STATUS" | jq -r '.failureClass // "none"')
ERROR_MSG=$(echo "$STATUS" | jq -r '.error // ""')

if [ "$FAILURE_CLASS" != "none" ] && [ "$FAILURE_CLASS" != "null" ]; then
  echo "CRITICAL: Instance $INSTANCE failed with failure class: $FAILURE_CLASS"
  [ "$ERROR_MSG" != "null" ] && echo "Detail: $ERROR_MSG"
fi

# Run a full report for analysis
kaseki-agent report "$INSTANCE"

# Alternatively, check with a non-JSON status call
kaseki-agent status "$INSTANCE"
```

### Pattern 3: Post-Run Analysis

After a run completes, gather comprehensive analysis using `report` and `list`.

```bash
#!/bin/bash
# Gather post-run analysis for a batch of completed runs

for INSTANCE in $(kaseki-agent list --status completed | tail -n +3 | awk '{print $1}'); do
  echo "=== Analyzing $INSTANCE ==="
  kaseki-agent report "$INSTANCE"
  echo ""
done
```

### Pattern 4: Combined Status + Report

Fetch both status and a detailed report together for complete visibilityand context about a run's health.

```bash
#!/bin/bash
# Combined status and report for quick diagnostics

INSTANCE=$1

echo "=== Status ==="
kaseki-agent status "$INSTANCE"

echo ""
echo "=== Report ==="
kaseki-agent report "$INSTANCE"
```

---

## Output Formats

### Status Response (JSON)

When using `--json`, `status` returns an object matching the StatusResponse schema:

```json
{
  "id": "kaseki-42",
  "status": "completed",
  "progress": { "stage": "Collecting artifacts", "percentComplete": 100 },
  "elapsedSeconds": 360,
  "timeoutRiskPercent": 8.9,
  "exitCode": 0,
  "failureClass": null,
  "error": null
}
```

Field source note: `repo` is read from `host-start.json.repo_url` with fallback to `host-start.json.repo`; `ref` is read from `host-start.json.git_ref` with fallback to `host-start.json.ref`. The `failureClass` field uses stable categories such as `validation`, `timeout`, `empty-diff`, `quality`, `secret-scan`, `github`, or `credentials`.

### Report Response

The `report` command prints structured sections: instance information, changes, validation results, artifact availability, and a detailed summary. Use `--from-disk` to read directly from result files without API access.

---

## Configuration

### Directory Structure

Run results are stored under:

- Results: `/agents/kaseki-results/kaseki-N/`
- Workspace: `/agents/kaseki-runs/kaseki-N/` (optional, for running instances)

Paths can be overridden via environment variables:

```bash
KASEKI_RESULTS_DIR=/custom/path/results kaseki-agent list
KASEKI_CACHE_DIR=/custom/path/cache kaseki-agent cleanup --dry-run
```

---

## Examples

### Example 1: Alert on Timeout Risk

Monitor all active runs and alert when timeout risk exceeds a threshold.

```bash
#!/bin/bash
while true; do
  for INSTANCE in $(kaseki-agent list --status running | tail -n +3 | awk '{print $1}'); do
    STATUS=$(kaseki-agent status "$INSTANCE")
    TIMEOUT=$(echo "$STATUS" | grep 'Timeout:' | awk '{print $2}' | tr -d '%')
    if [ -n "$TIMEOUT" ] && (( $(echo "$TIMEOUT > 85" | bc -l 2>/dev/null || echo 0) )); then
      echo "ALERT: $INSTANCE timeout risk ${TIMEOUT}%" | mail -s "Kaseki Alert" ops@team.com
    fi
  done
  sleep 10
done
```

### Example 2: Parse Changes from Completed Run

Extract changed files and diff size from a completed run's report.

```bash
REPORT=$(kaseki-agent report kaseki-1)
DIFF_SIZE=$(echo "$REPORT" | grep 'Diff Size:' | awk '{print $NF}')
echo "Diff size: ${DIFF_SIZE} bytes"
```

### Example 3: Verify Setup Before Running Tasks

Run doctor and host preflight before submitting work.

```bash
kaseki-agent doctor
kaseki-agent host preflight
kaseki-agent serve &
kaseki-agent run https://github.com/org/repo main "Task description"
```

---

## Troubleshooting

### "Command not found"

- Ensure `npm install -g @cyanautomation/kaseki-agent` completed successfully
- Check PATH: `which kaseki-agent`
- If installed inside Docker, use `docker exec kaseki-api kaseki-agent ...` instead

### "Unknown command"

Verify the subcommand exists. All 15 active commands plus `setup` (deprecated) are registered in `src/cli/KasekiCLI.ts`. Run `kaseki-agent --help` to see available top-level flags. For command-specific help, run `kaseki-agent <command> --help`.

### "Unable to list runs from local Kaseki API"

The `list`, `report`, `status`, `cancel`, and `stop` commands require a running API service. Start it with `kaseki-agent serve` or `docker-compose up -d kaseki-api`, or use `--from-disk` with the `report` command to inspect local files directly.

### "Instance not found on disk"

When using `--from-disk`, verify the instance directory exists:

```bash
ls -la /agents/kaseki-results/kaseki-N/
```

Check that the instance name matches the format `kaseki-N` where N is digits.

---

## Performance Notes

- **list**: Queries the API for the full runs list; O(n) where n = number of tracked runs
- **status**: Lightweight; reads small JSON files and parses stage from logs
- **report (API)**: Collects data from multiple endpoints; good for post-run analysis
- **report (disk)**: Reads metadata.json and result-summary.md directly; fastest option for local inspection
- **doctor**: Runs shell probes sequentially; ~1-2 seconds for a healthy system

Suitable for:

- Polling every 5-10 seconds during active runs
- On-demand health checks
- Post-run batch analysis of multiple instances
