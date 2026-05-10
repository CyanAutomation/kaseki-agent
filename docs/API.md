# Kaseki Agent REST API Reference

## Overview

The Kaseki API Service provides HTTP endpoints for remotely triggering, monitoring, and retrieving results from kaseki-agent runs. This allows external tools like OpenClaw to control kaseki without SSH/sshpass.

## Quick Start

### Start the API Service

```bash
# Set API keys and start
KASEKI_API_KEYS=sk-test-abc123 npm run kaseki-api

# Or with configuration file
KASEKI_API_KEYS_FILE=~/.kaseki-api-keys npm run kaseki-api

# Specify custom port
KASEKI_API_PORT=9000 KASEKI_API_KEYS=sk-test-abc123 npm run kaseki-api
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KASEKI_API_PORT` | 8080 | HTTP port for API server |
| `KASEKI_API_KEYS` | *(required)* | Comma-separated API keys for auth |
| `KASEKI_API_KEYS_FILE` | — | Path to file with newline-separated keys |
| `KASEKI_API_LOG_DIR` | /var/log/kaseki-api/ | Log file output directory |
| `KASEKI_API_MAX_CONCURRENT_RUNS` | 3 | Max concurrent kaseki jobs |
| `KASEKI_RESULTS_DIR` | /agents/kaseki-results | Directory for run artifacts |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | 5700 | Timeout for agent (95 min) |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_TASK_MODE` | patch | Default task mode: patch or inspect |
| `KASEKI_PUBLISH_MODE` | auto | Publish behavior: auto, none, branch, or draft_pr |
| `KASEKI_REPO_MEMORY_MODE` | off | Opt-in repository prompt memory: `off` or `summary` |
| `KASEKI_REPO_MEMORY_TTL_DAYS` | 30 | Maximum age of repository memory summaries |
| `KASEKI_REPO_MEMORY_MAX_BYTES` | 8000 | Maximum bytes read/written for repository memory summaries |
| `KASEKI_API_LOG_LEVEL` | info | Log verbosity: debug/info/warn/error |
| `GITHUB_APP_ID_FILE` | — | Path to file containing GitHub App ID for PR creation |
| `GITHUB_APP_CLIENT_ID_FILE` | — | Path to file containing GitHub App Client ID |
| `GITHUB_APP_PRIVATE_KEY_FILE` | — | Path to GitHub App private key file; preferred over inline private key env |

## Authentication

All endpoints (except `/health`, `/api/health`, `/ready`, and `/api/ready`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer sk-your-api-key" http://localhost:8080/api/runs
```

If the token is missing or invalid, the API returns `401 Unauthorized`.

## API Endpoints

### Health Check

**GET `/health`** or **GET `/api/health`**

No authentication required. Check service health and queue status.

**Response (200 OK):**

```json
{
  "status": "healthy",
  "timestamp": "2026-05-02T14:30:00Z",
  "queue": {
    "pending": 2,
    "running": 1,
    "maxConcurrent": 3
  }
}
```

`image` and `templateImage` reflect the configured image reference that the runner looks up locally, such as `docker.io/cyanautomation/kaseki-agent:latest`. `imageDigest` and `templateImageDigest` report the resolved local digest when available.

### Controller Preflight

**GET `/api/preflight`**

Requires authentication. Run this before submitting jobs from OpenClaw or another remote controller. It validates the runtime dependencies that the API needs in order to launch ephemeral Kaseki containers.

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/preflight
```

**Response (200 OK or 503 Service Unavailable):**

```json
{
  "status": "ok",
  "timestamp": "2026-05-03T21:30:00.000Z",
  "image": "docker.io/:latest",
  "imageDigest": "docker.io/@sha256:...",
  "templateImage": "docker.io/cyanautomation/kaseki-agent:latest",
  "templateImageDigest": "docker.io/cyanautomation/kaseki-agent:latest",
  "templateDir": "/agents/kaseki-template",
  "templateRef": "abc1234",
  "resultsDir": "/agents/kaseki-results",
  "runtime": {
    "nodeVersion": "v24.15.0",
    "uid": 1000,
    "gid": 1000,
    "groups": [1000, 985]
  },
  "docker": {
    "version": "20.10.24 -> 29.4.1",
    "clientVersion": "20.10.24",
    "serverVersion": "29.4.1"
  },
  "checks": [
    {
      "name": "docker-daemon",
      "ok": true,
      "detail": "20.10.24 -> 29.4.1"
    }
  ]
}
```

If Docker socket access is denied, the response includes remediation such as adding `group_add: ["${DOCKER_GID:-985}"]` to the API container.

When GitHub App settings are present, preflight also validates that the App ID,
Client ID, and private key are readable and structurally valid. A partial GitHub
configuration returns `503` so controllers can fail early before starting a run
that cannot publish its patch.

### Readiness Check

**GET `/ready`** or **GET `/api/ready`**

No authentication required. Returns readiness for queue/scheduler dependencies used to accept and execute runs.

- `200` when:
  - results directory is readable+writable,
  - scheduler queue status is available,
  - webhook manager loop is healthy.
- `503` when one or more dependencies are not ready.

**Response (200 OK):**

```json
{
  "status": "ready",
  "timestamp": "2026-05-05T12:00:00.000Z"
}
```

**Response (503 Service Unavailable):**

```json
{
  "status": "not_ready",
  "timestamp": "2026-05-05T12:00:00.000Z",
  "reasons": [
    "results_dir_unwritable:EACCES: permission denied, access '/agents/kaseki-results'"
  ]
}
```

### Prometheus Metrics

**GET `/api/metrics`**

Requires authentication. Returns Prometheus text exposition (`text/plain; version=0.0.4`) including:

- `kaseki_queue_pending` (gauge)
- `kaseki_running_jobs` (gauge)
- `kaseki_runs_total{result="success|failure"}` (counter)
- `kaseki_run_duration_seconds` (histogram)
- `kaseki_timeouts_total` (counter)
- `kaseki_timeout_rate` (gauge)

### Trigger a Run

**POST `/api/runs`**

Submit a new kaseki job to the queue. Returns immediately (async).

**Request:**

```bash
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/org/repo",
    "ref": "main",
    "taskPrompt": "Fix the parser bug in src/lib/parser.ts",
    "changedFilesAllowlist": ["src/lib/parser.ts", "tests/parser.test.ts"],
    "allowlist": { "include": ["src/lib/parser.ts", "tests/parser.test.ts"] },
    "maxDiffBytes": 150000,
    "validationCommands": ["npm run lint", "npm run test"],
    "validation": { "commands": ["npm run lint", "npm run test"] },
    "taskMode": "patch",
    "publishMode": "draft_pr"
  }'
```

**Request Schema:**

```typescript
{
  repoUrl: string;           // ✓ Required, must be valid URL
  ref?: string;              // Git branch/tag/commit (default: "main")
  taskPrompt?: string;       // Instructions for Pi agent
  changedFilesAllowlist?: string[];  // File patterns Pi must not modify outside
  allowlist?: { include?: string[] }; // Alias accepted for controllers
  maxDiffBytes?: number;     // Max diff size in bytes
  validationCommands?: string[];     // Commands to run after agent completes
  validation?: { commands?: string[] }; // Alias accepted for controllers
  taskMode?: "patch" | "inspect";    // "patch" (default) = require changes
  publishMode?: "none" | "branch" | "draft_pr"; // Optional publish behavior
  startupCheck?: boolean;     // Start worker, verify boot/runtime, then exit
  timeoutSeconds?: number;    // Optional per-run timeout (60-10800 seconds)
}
```

Set `publishMode` when a controller needs deterministic publish behavior:
`none` skips GitHub publishing, `branch` pushes a Kaseki branch after validation,
and `draft_pr` pushes a branch and opens a draft pull request. Requests with
`branch` or `draft_pr` fail before queueing unless GitHub App credentials are
readable; call `GET /api/preflight` first to verify that readiness.

For controller activation checks, submit `startupCheck: true` or call `POST /api/runs?dryRun=true`. This starts the same worker path as a normal run, verifies the cloned repo, OpenRouter secret mount, writable workspace/results/cache paths, Node, Git, and Pi CLI, then exits before spending a full agent run.

Dependency installation in worker runs is lockfile-enforced (`npm ci --omit=dev`, optionally with `--ignore-scripts`), and run artifacts expose cache/install observability. Controllers can read `progress.jsonl`, `stage-timings.tsv`, and `dependency-cache.log` for install elapsed time plus cache hit/miss and reuse source details.

**Response (202 Accepted):**

```json
{
  "id": "kaseki-42",
  "status": "queued",
  "createdAt": "2026-05-02T14:30:00Z"
}
```

Idempotency replays return `200 OK` with `cached: true` and the current job status when the original job is still known to the scheduler. This prevents controllers from seeing stale `running` or `queued` responses after a retry of a completed, failed, or cancelled run.

### List All Runs

**GET `/api/runs`**

List recent kaseki runs, newest first.

**Response (200 OK):**

```json
{
  "runs": [
    {
      "id": "kaseki-42",
      "status": "running",
      "createdAt": "2026-05-02T14:30:00Z"
    },
    {
      "id": "kaseki-41",
      "status": "completed",
      "createdAt": "2026-05-02T14:20:00Z",
      "completedAt": "2026-05-02T14:28:00Z"
    }
  ],
  "total": 2
}
```

### Get Run Status

**GET `/api/runs/:id/status`**

Poll the status of a specific run. Returns progress and timeout risk.

**Progress Object** (only present for running jobs):
The `progress` field contains a structured object describing the current execution stage with the following fields:

- `stage` (string, required) — Current execution stage name (e.g., "pi coding agent", "validation")
- `percentComplete` (number, optional) — Progress percentage (0-100)
- `message` (string, optional) — Detailed status message or stage name fallback
- `updatedAt` (ISO-8601 string, optional) — Timestamp when progress was last updated

For non-running jobs, `progress` is omitted.

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "running",
  "progress": {
    "stage": "pi coding agent",
    "percentComplete": 85,
    "message": "Refactoring implementation",
    "updatedAt": "2026-05-05T12:34:00.000Z"
  },
  "elapsedSeconds": 315,
  "timeoutRiskPercent": 26,
  "resultDir": "/agents/kaseki-results/kaseki-42"
}
```

**Response (Terminal Status - 200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "failed",
  "elapsedSeconds": 500,
  "timeoutRiskPercent": 41,
  "exitCode": 1,
  "failureClass": "validation",
  "resultDir": "/agents/kaseki-results/kaseki-42",
  "resultSummaryContent": "# Kaseki Result: kaseki-42\n\n- Status: failed\n- Failed command: npm run test\n- Requested model: openrouter/free\n- Validation: failed (1)\n- Quality checks: passed\n",
  "failureJsonContent": {
    "instance": "kaseki-42",
    "exit_code": 1,
    "failed_command": "npm run test",
    "validation_failure_reason": "Test timeout",
    "stage": "validation",
    "stderr_tail": "...",
    "artifacts_dir": "/agents/kaseki-results/kaseki-42",
    "metadata": "metadata.json",
    "summary": "result-summary.md"
  },
  "artifacts": {
    "metadataJson": true,
    "analysisMd": true,
    "resultSummaryMd": true,
    "failureJson": true,
    "stderrLog": true,
    "availableFiles": [
      "metadata.json",
      "analysis.md",
      "result-summary.md",
      "failure.json",
      "stderr.log"
    ]
  },
  "diagnosticEntryPoint": "failure.json"
}
```

**New Response Fields (Inline Diagnostic Content):**

- `resultSummaryContent` — Inline markdown summary (always for terminal jobs, ≤64 KB)
- `failureJsonContent` — Inline structured failure details (only for failed runs, ≤64 KB)

These optional fields eliminate the need for separate API calls to fetch critical diagnostic content. Controllers can immediately access failure reasons without calling `/api/results/:id/result-summary.md` and `/api/results/:id/failure.json`.

**Legacy Response Fields:**

For backward compatibility, the response still includes:

- `artifacts` — Hint object showing which artifacts are available
- `diagnosticEntryPoint` — Recommended artifact to examine first
- `availableFiles` — Array of file names available for download

**Status Values:**

- `queued` — Waiting in queue
- `running` — Currently executing
- `completed` — Finished successfully (check exitCode)
- `failed` — Failed validation, timeout, or quality gate

**Timeout Risk:** Percentage of agent timeout elapsed. Monitor for >85% and consider canceling if needed.

### Get Progress Events

**GET `/api/runs/:id/progress`**

Returns sanitized progress events from `progress.jsonl`. Assistant text, environment values, and secrets are not included.
For running jobs whose result directory has not been promoted yet, the API falls back to sanitized `[progress]` lines from the live Docker container logs.

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  "http://localhost:8080/api/runs/kaseki-42/progress?tail=25"
```

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "running",
  "events": [
    {
      "timestamp": "2026-05-02T14:31:00Z",
      "stage": "pi coding agent",
      "message": "working; events=65, tool starts=4, tool ends=3"
    }
  ],
  "total": 120
}
```

### Get Controller Events

**GET `/api/runs/:id/events`**

Returns a controller-friendly event snapshot. It reads promoted `progress.jsonl` events when available and appends sanitized live Docker progress events while the worker container is still running.

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  "http://localhost:8080/api/runs/kaseki-42/events?tail=50"
```

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "running",
  "events": [
    {
      "source": "docker-logs",
      "stage": "startup check",
      "message": "container booted"
    }
  ],
  "total": 1,
  "sources": ["docker-logs"]
}
```

### Cancel a Run

**POST `/api/runs/:id/cancel`**

Cancels a queued or running job. Completed jobs are returned unchanged.
Cancelled jobs get API-written fallback diagnostics when the worker exits before writing its own final artifacts. Guaranteed non-empty files on failure are: `analysis.md`, `metadata.json`, `stderr.log`, `failure.json`, and `result-summary.md` (kept for backward compatibility during migration).

```bash
curl -X POST -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/runs/kaseki-42/cancel
```

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "failed",
  "exitCode": 143,
  "failureClass": "cancelled",
  "error": "Job cancelled by API request"
}
```

### Get Logs

**GET `/api/runs/:id/logs/:logtype`**

Retrieve specific log files from a run.

**Log Types:**

- `stdout` — Standard output
- `stderr` — Standard error
- `validation` — Validation command output
- `progress` — Pi agent progress events
- `quality` — Quality gate results
- `secret-scan` — Secret detection results

**Example:**

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/runs/kaseki-42/logs/stdout
```

**Response (200 OK):**

```json
{
  "logType": "stdout",
  "content": "[kaseki-42] Cloning repo...\n[kaseki-42] Installing dependencies...\n...",
  "size": 45678
}
```

Note: Large logs (>100 KB) are truncated with a marker showing how much is hidden.

### Get Run Analysis

**GET `/api/runs/:id/analysis`**

Comprehensive post-run analysis including metadata, changes, and validation results.

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "status": "completed",
  "createdAt": "2026-05-02T14:30:00Z",
  "completedAt": "2026-05-02T14:40:00Z",
  "elapsedSeconds": 600,
  "exitCode": 0,
  "metadata": {
    "model": "openrouter/free",
    "instance": "kaseki-42",
    "repo": "https://github.com/org/repo",
    "ref": "main"
  },
  "changes": {
    "changedFiles": ["src/lib/parser.ts"],
    "diffSize": 2048
  },
  "validation": {
    "passed": true,
    "commandResults": [
      {
        "command": "npm run lint",
        "exitCode": 0,
        "elapsed": 15000
      },
      {
        "command": "npm run test",
        "exitCode": 0,
        "elapsed": 45000
      }
    ]
  }
}
```

### List Run Artifacts (Discovery Endpoint)

**GET `/api/runs/:id/artifacts`**

Comprehensively enumerate all available artifacts with metadata, descriptions, and availability status.
This endpoint exposes 25+ artifact types with detailed metadata to guide clients on triage priority and content selection.

Resolution logic:

- Uses `job.resultDir` when present.
- Falls back to `${KASEKI_RESULTS_DIR}/${runId}` when `job.resultDir` is not set.

**Example (failed run with comprehensive artifacts):**

```bash
curl -s -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/runs/kaseki-42/artifacts | jq '.'
```

**Response (200 OK):**

```json
{
  "id": "kaseki-42",
  "runStatus": "failed",
  "exitCode": 1,
  "artifactCount": 18,
  "downloadBaseUrl": "/api/results/kaseki-42/",
  "artifacts": [
    {
      "name": "failure.json",
      "size": 224,
      "contentType": "application/json",
      "available": true,
      "description": "Structured failure classification: exit code, stage, reason, stderr tail",
      "availability": "on-failure",
      "triageOrder": 1
    },
    {
      "name": "result-summary.md",
      "size": 1382,
      "contentType": "text/markdown",
      "available": true,
      "description": "Human-readable status summary with context and recommendations",
      "availability": "always",
      "triageOrder": 2
    },
    {
      "name": "analysis.md",
      "size": 2048,
      "contentType": "text/markdown",
      "available": true,
      "description": "Comprehensive failure analysis with recommendations",
      "availability": "always",
      "triageOrder": 3
    },
    {
      "name": "pi-events.jsonl",
      "size": 51024,
      "contentType": "application/x-jsonl",
      "available": true,
      "description": "Pi CLI structured events (sanitized, no thinking blocks)",
      "availability": "always",
      "triageOrder": 4
    },
    {
      "name": "changed-files.txt",
      "size": 142,
      "contentType": "text/plain",
      "available": true,
      "description": "One filename per line: files modified by the agent",
      "availability": "conditional",
      "triageOrder": 14
    }
  ],
  "recommended": ["failure.json", "result-summary.md", "analysis.md", "stderr.log", "stdout.log"]
}
```

**Response Fields:**

- `artifactCount` — Number of available artifacts
- `downloadBaseUrl` — Base URL for artifact downloads
- `artifacts` — Array of all artifacts with metadata
  - `availability` — `always`, `on-failure`, `on-success`, or `conditional`
  - `triageOrder` — Sort priority for diagnostic triage (lower = higher priority)
  - `description` — Human-readable artifact purpose
- `recommended` — Top 5 artifacts to examine first (status-aware triage order)

**All Available Artifact Types (25+):**

| Name | Availability | Type | Purpose |
|------|--------------|------|---------|
| `failure.json` | on-failure | JSON | Structured failure details |
| `result-summary.md` | always | Markdown | Human-readable status |
| `analysis.md` | always | Markdown | Comprehensive analysis |
| `pi-events.jsonl` | always | JSONL | Agent events |
| `pi-summary.json` | always | JSON | Agent statistics |
| `stderr.log` | on-failure | Text | Container errors |
| `stdout.log` | on-failure | Text | Container output |
| `validation.log` | on-failure | Text | Validation results |
| `validation-timings.tsv` | conditional | TSV | Per-command timing |
| `quality.log` | on-failure | Text | Quality gate results |
| `stage-timings.tsv` | conditional | TSV | Per-stage timing |
| `git.diff` | conditional | Diff | Repository changes |
| `git.status` | conditional | Text | Git status output |
| `changed-files.txt` | conditional | Text | Modified files list |
| `progress.log` | always | Text | Progress log |
| `progress.jsonl` | always | JSONL | Structured progress |
| `metadata.json` | always | JSON | Run metadata |
| `restoration-report.md` | conditional | Markdown | Allowlist restoration |
| `secret-scan.log` | always | Text | Credential scan |
| `git-push.log` | conditional | Text | GitHub push results |
| `dependency-cache.log` | conditional | Text | Dependency cache info |
| `exit_code` | always | Text | Exit code |
| ...and more | — | — | — |

### Download Artifact

**GET `/api/results/:id/:file`**

Download a specific artifact file. Now supports all 25+ artifact types enumerated by `/api/runs/:id/artifacts`.

**Example:**

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/results/kaseki-42/failure.json
```

**Availability Filtering:**

- `on-failure` artifacts are only available when `runStatus === 'failed'`
- `on-success` artifacts are only available when `runStatus === 'completed'`
- `always` artifacts available for terminal states
- `conditional` artifacts require file existence on disk

Attempting to download an unavailable artifact returns `400 Bad Request`.

## Error Handling

Errors follow [RFC 7807 Problem Details](https://tools.ietf.org/html/rfc7807):

```json
{
  "type": "https://api.kaseki.local/errors#bad-request",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid repository URL format"
}
```

Common error codes:

| Status | Reason |
|--------|--------|
| 400 | Invalid request (validation failed) |
| 401 | Missing/invalid API key |
| 404 | Run not found |
| 500 | Server error (check logs) |

## Workflow Example

### 1. Trigger a run

```bash
RESPONSE=$(curl -s -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer sk-test-key" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/org/repo",
    "taskPrompt": "Fix bug in parser.ts"
  }')

RUN_ID=$(echo $RESPONSE | jq -r '.id')
echo "Run started: $RUN_ID"
```

### 2. Poll status

```bash
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer sk-test-key" \
    http://localhost:8080/api/runs/$RUN_ID/status)
  
  STATE=$(echo $STATUS | jq -r '.status')
  PROGRESS=$(echo $STATUS | jq -r '.progress // "waiting"')
  ELAPSED=$(echo $STATUS | jq -r '.elapsedSeconds // 0')
  
  echo "[$ELAPSED s] $STATE: $PROGRESS"
  
  [ "$STATE" != "running" ] && break
  sleep 5
done
```

### 3. Check results

```bash
# Get comprehensive analysis
curl -s -H "Authorization: Bearer sk-test-key" \
  http://localhost:8080/api/runs/$RUN_ID/analysis | jq '.'

# Download the diff
curl -H "Authorization: Bearer sk-test-key" \
  http://localhost:8080/api/results/$RUN_ID/git.diff -o changes.diff
```

## Best Practices

1. **Set appropriate timeouts** — Agent timeout defaults to 95 minutes. Adjust globally via `KASEKI_AGENT_TIMEOUT_SECONDS` or per-run via `timeoutSeconds`.

2. **Monitor timeout risk** — Check `timeoutRiskPercent` in status. If >85%, consider graceful shutdown.

3. **Use allowlists** — Always set `changedFilesAllowlist` to prevent Pi from modifying unintended files.

4. **Limit concurrent runs** — Set `KASEKI_API_MAX_CONCURRENT_RUNS` to prevent host overload.

5. **Rotate API keys** — Keep keys in secure storage (`KASEKI_API_KEYS_FILE`), not in scripts.

6. **Parse errors** — Check `failureClass` in status to determine failure root cause:
   - `validation` — Validation command failed
   - `timeout` — Agent timeout
   - `quality` — Diff/allowlist/secret scan violation
   - `empty-diff` — No changes (when mode=patch)

## API Versioning

Current version: **v1** (embedded in base path `/api/`)

Future versions will use `/api/v2/`, `/api/v3/`, etc., allowing peaceful transitions.

---

## TypeScript Client (Coming Soon)

OpenClaw and other tools can use the auto-generated TypeScript client:

```typescript
import { KasekiApiClient } from '@kaseki-agent/api-client';

const client = new KasekiApiClient('http://localhost:8080', 'sk-api-key');

const run = await client.submit({
  repoUrl: 'https://github.com/org/repo',
  taskPrompt: 'Fix the bug'
});

console.log(`Run started: ${run.id}`);

// Monitor
const status = await client.getStatus(run.id);
console.log(`Status: ${status.status}, elapsed: ${status.elapsedSeconds}s`);
```

(Client implementation coming in Phase 8)
