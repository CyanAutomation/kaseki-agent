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
| `KASEKI_AGENT_TIMEOUT_SECONDS` | 1200 | Timeout for agent (20 min) |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_TASK_MODE` | patch | Default task mode: patch or inspect |
| `KASEKI_API_LOG_LEVEL` | info | Log verbosity: debug/info/warn/error |

## Authentication

All endpoints (except `/health`) require Bearer token authentication:

```bash
curl -H "Authorization: Bearer sk-your-api-key" http://localhost:8080/api/runs
```

If the token is missing or invalid, the API returns `401 Unauthorized`.

## API Endpoints

### Health Check

**GET `/health`**

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
    "maxDiffBytes": 150000,
    "validationCommands": ["npm run lint", "npm run test"],
    "taskMode": "patch"
  }'
```

**Request Schema:**
```typescript
{
  repoUrl: string;           // ✓ Required, must be valid URL
  ref?: string;              // Git branch/tag/commit (default: "main")
  taskPrompt?: string;       // Instructions for Pi agent
  changedFilesAllowlist?: string[];  // File patterns Pi must not modify outside
  maxDiffBytes?: number;     // Max diff size in bytes
  validationCommands?: string[];     // Commands to run after agent completes
  taskMode?: "patch" | "inspect";    // "patch" (default) = require changes
}
```

**Response (202 Accepted):**
```json
{
  "id": "kaseki-42",
  "status": "queued",
  "createdAt": "2026-05-02T14:30:00Z"
}
```

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

**Response (200 OK):**
```json
{
  "id": "kaseki-42",
  "status": "running",
  "progress": "Invoking Pi agent...",
  "elapsedSeconds": 45,
  "timeoutRiskPercent": 4
}
```

**Status Values:**
- `queued` — Waiting in queue
- `running` — Currently executing
- `completed` — Finished successfully (check exitCode)
- `failed` — Failed validation, timeout, or quality gate

**Timeout Risk:** Percentage of agent timeout elapsed. Monitor for >85% and consider canceling if needed.

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

### Download Artifact

**GET `/api/results/:id/:file`**

Download specific result artifacts.

**Allowed Files:**
- `git.diff` — Unified diff of changes
- `metadata.json` — Full run metadata
- `result-summary.md` — Human-readable summary
- `pi-events.jsonl` — Pi agent events (newline-delimited JSON)
- `pi-summary.json` — Pi agent statistics

**Example:**
```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  http://localhost:8080/api/results/kaseki-42/git.diff -o patch.diff
```

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

1. **Set appropriate timeouts** — Agent timeout defaults to 20 minutes. Adjust via `KASEKI_AGENT_TIMEOUT_SECONDS`.

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
