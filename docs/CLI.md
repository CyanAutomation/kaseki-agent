# Kaseki CLI - Live Agent Monitoring

The **Kaseki CLI** is a command-line tool that allows external AI agents to query running and completed kaseki instances in real-time. It provides structured JSON output for easy integration into monitoring scripts and agent workflows.

## Overview

- **Query running instances**: Get current stage, elapsed time, timeout risk
- **Detect errors**: Identify failures in stderr, validation, quality gates, and secret scans
- **Anomaly detection**: Flag timeout risk as instance approaches timeout
- **Log streaming**: Follow logs in real-time as they're written
- **Progress streaming**: Read sanitized stage and Pi tool progress without model text
- **Post-run analysis**: Comprehensive summary of changes, validation results, and Pi metrics

## Installation

The CLI is implemented as Node.js scripts and included in the kaseki-agent repository:

```bash
# Make scripts executable
chmod +x kaseki-cli.js kaseki-cli-lib.js

# Add to PATH (optional)
export PATH="/workspaces/kaseki-agent:$PATH"
```

On Pi hosts that do not have Node.js installed, use the `kaseki` wrapper
deployed with the template. It runs the CLI inside the configured Kaseki Docker
image:

```bash
/agents/kaseki-template/kaseki list
/agents/kaseki-template/kaseki status kaseki-1
/agents/kaseki-template/kaseki analysis kaseki-1
```

## Core Library (`kaseki-cli-lib.js`)

The library provides direct programmatic access. Use this for custom integration:

```javascript
const kasekiCli = require('./kaseki-cli-lib.js');

// List all instances
const instances = kasekiCli.listInstances();

// Get status of a running instance
const status = kasekiCli.getInstanceStatus('kaseki-1');

// Detect errors
const errors = kasekiCli.detectErrors('kaseki-1');

// Get anomalies (timeout risk, etc.)
const anomalies = kasekiCli.detectAnomalies('kaseki-1');

// Post-run analysis
const analysis = kasekiCli.getAnalysis('kaseki-1');
```

## CLI Commands

### `list`
List all kaseki instances (running and completed).

```bash
./kaseki-cli.js list
```

**Output**:
```
Instance  Status      Stage                  Elapsed (s)  Exit Code  Model
kaseki-2  running     Running Pi agent       1050         —          openrouter/claude-...
kaseki-1  completed   Collecting artifacts   300          0          openrouter/claude-...
```

### `status <instance>`
Get detailed status of a specific instance (JSON format).

```bash
./kaseki-cli.js status kaseki-1
```

**Output**:
```json
{
  "instance": "kaseki-1",
  "running": false,
  "stage": "Collecting artifacts",
  "elapsedSeconds": 300,
  "timeoutSeconds": 1200,
  "timeoutRiskPercent": 25.0,
  "timeoutImminent": false,
  "timedOut": false,
  "exitCode": 0,
  "repo": "CyanAutomation/crudmapper",
  "ref": "main",
  "model": "openrouter/claude-3.5-sonnet"
}
```
`repo` prefers `host-start.json.repo_url` (fallback: `repo`), and `ref` prefers `host-start.json.git_ref` (fallback: `ref`).

### `logs <instance> [options]`
Display recent log lines (tail).

```bash
# Show last 50 lines of stdout
./kaseki-cli.js logs kaseki-1

# Show last 100 lines
./kaseki-cli.js logs kaseki-1 --tail=100

# Show last 20 lines of validation.log
./kaseki-cli.js logs kaseki-1 --file=validation.log --tail=20
```

### `progress <instance> [options]`
Display sanitized progress events from `progress.jsonl`.

```bash
./kaseki-cli.js progress kaseki-1
./kaseki-cli.js progress kaseki-1 --tail=25
```

Progress events include stage starts/finishes, Pi event counts, and tool
start/end counts. They intentionally do not include assistant text, thinking
content, environment values, or secrets.

### `errors <instance>`
Detect and list errors (JSON format).

```bash
./kaseki-cli.js errors kaseki-1
```

**Output**:
```json
{
  "instance": "kaseki-1",
  "errorCount": 2,
  "errors": [
    {
      "severity": "error",
      "source": "stderr",
      "message": "Error: Build failed",
      "line": 42
    },
    {
      "severity": "critical",
      "source": "quality-gate",
      "message": "Diff exceeds maximum size"
    }
  ]
}
```

**Error sources**:
- `stderr` — errors from stderr.log
- `validation` — validation command failures
- `quality-gate` — quality gate violations (diff size, allowlist, format)
- `secret-scan` — credential leaks detected
- `timeout` — agent timeout (exit code 124)

### `analysis <instance>`
Get comprehensive post-run analysis (JSON format).

```bash
./kaseki-cli.js analysis kaseki-1
```

**Output**:
```json
{
  "instance": "kaseki-1",
  "duration": 300,
  "exitCode": 0,
  "model": "openrouter/claude-3.5-sonnet",
  "repo": "CyanAutomation/crudmapper",
  "ref": "main",
  "changedFiles": [
    "src/lib/parser.ts",
    "tests/parser.test.ts"
  ],
  "changedFileCount": 2,
  "diffSizeBytes": 2150,
  "diffSizeKb": 2,
  "validationCommands": [
    {
      "command": "npm run check",
      "exitCode": 0,
      "durationSeconds": 10,
      "passed": true
    }
  ],
  "piMetrics": {
    "toolStartCount": 8,
    "toolEndCount": 8,
    "eventCount": 65
  },
  "errors": [],
  "errorCount": 0,
  "criticalErrors": 0
}
```
`repo` prefers `host-start.json.repo_url` (fallback: `repo`), and `ref` prefers `host-start.json.git_ref` (fallback: `ref`).

### `watch <instance> [options]`
Live monitor an instance with periodic status updates and anomaly alerts.

```bash
# Poll every 5 seconds (default)
./kaseki-cli.js watch kaseki-1

# Poll every 2 seconds
./kaseki-cli.js watch kaseki-1 --interval=2
```

**Output** (updates every interval):
```
Watching kaseki-1 (updating every 5s, Ctrl+C to stop)...

[2026-04-25T14:23:45.123Z] Stage: Running Pi agent
             Elapsed: 1050s / 1200s
             Timeout: 87.5%
             Status: RUNNING
             ⚠ [WARNING] Timeout approaching: 1050s / 1200s (87.5%)

[2026-04-25T14:23:50.456Z] Stage: Running validation
             Elapsed: 1055s / 1200s
             Status: RUNNING
```

### `follow <instance> [options]`
Stream logs in real-time as they're written.

```bash
# Follow stdout.log
./kaseki-cli.js follow kaseki-1

# Follow validation.log
./kaseki-cli.js follow kaseki-1 --tail=validation.log
```

---

## External AI Agent Integration

### Pattern 1: Polling Status

An external agent can poll kaseki status at regular intervals:

```bash
#!/bin/bash
# monitor-kaseki.sh - Monitor kaseki instance from external agent

INSTANCE=$1
POLL_INTERVAL=${2:-5}  # Default 5 seconds
MAX_ATTEMPTS=${3:-240}  # Default 2 hours (240 * 5s)

ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  STATUS=$(./kaseki-cli.js status $INSTANCE)
  
  # Parse JSON
  RUNNING=$(echo $STATUS | jq -r '.running')
  STAGE=$(echo $STATUS | jq -r '.stage')
  TIMEOUT_RISK=$(echo $STATUS | jq -r '.timeoutRiskPercent')
  EXIT_CODE=$(echo $STATUS | jq -r '.exitCode')
  
  echo "[$INSTANCE] Stage: $STAGE | Timeout Risk: ${TIMEOUT_RISK}%"
  
  # Detect timeout imminent
  if (( $(echo "$TIMEOUT_RISK >= 85" | bc -l) )); then
    echo "⚠ ALERT: Timeout approaching ($TIMEOUT_RISK%)"
    # Take action: notify, scale resources, etc.
  fi
  
  # Check if completed
  if [ "$RUNNING" = "false" ]; then
    echo "✓ Instance completed with exit code: $EXIT_CODE"
    break
  fi
  
  sleep $POLL_INTERVAL
  ((ATTEMPT++))
done

# Post-run analysis
ANALYSIS=$(./kaseki-cli.js analysis $INSTANCE)
ERRORS=$(echo $ANALYSIS | jq -r '.errorCount')
echo "Final analysis: $ERRORS errors detected"
```

### Pattern 2: Error Detection and Reaction

React to detected errors:

```bash
#!/bin/bash
# react-to-errors.sh

INSTANCE=$1

ERRORS=$(./kaseki-cli.js errors $INSTANCE)
ERROR_COUNT=$(echo $ERRORS | jq -r '.errorCount')

if [ "$ERROR_COUNT" -gt 0 ]; then
  CRITICAL=$(echo $ERRORS | jq '[.errors[] | select(.severity == "critical")] | length')
  
  if [ "$CRITICAL" -gt 0 ]; then
    echo "❌ Critical errors detected: $CRITICAL"
    # Escalate, rollback, notify team, etc.
  else
    echo "⚠ Non-critical errors detected: $(($ERROR_COUNT - $CRITICAL))"
  fi
fi
```

### Pattern 3: Library Import in Node.js Agent

Use the library directly in a Node.js agent:

```javascript
const kasekiCli = require('./kaseki-cli-lib.js');

async function monitorKaseki(instanceName) {
  const pollInterval = 5000; // 5 seconds
  
  while (true) {
    const status = kasekiCli.getInstanceStatus(instanceName);
    
    if (status.error) {
      console.error(`Error: ${status.error}`);
      break;
    }
    
    console.log(`[${instanceName}] Stage: ${status.stage} | Timeout: ${status.timeoutRiskPercent.toFixed(1)}%`);
    
    // Check for timeout risk
    if (status.timeoutImminent) {
      console.warn(`⚠ ALERT: Timeout imminent (${status.elapsedSeconds}s / ${status.timeoutSeconds}s)`);
      // Handle timeout risk
    }
    
    // Check for errors
    const errors = kasekiCli.detectErrors(instanceName);
    if (errors.length > 0) {
      console.warn(`✗ ${errors.length} error(s) detected`);
      errors.forEach((e) => console.warn(`  - [${e.severity}] ${e.source}: ${e.message}`));
    }
    
    // Exit when complete
    if (!status.running) {
      const analysis = kasekiCli.getAnalysis(instanceName);
      console.log(`✓ Completed: ${analysis.changedFileCount} files changed, ${analysis.errorCount} errors`);
      break;
    }
    
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

monitorKaseki('kaseki-1');
```

---

## Output Formats

### Status Object

```json
{
  "instance": "kaseki-1",
  "running": boolean,
  "stage": "string",
  "elapsedSeconds": number,
  "timeoutSeconds": number,
  "timeoutRiskPercent": number (0-100),
  "timeoutImminent": boolean,
  "timedOut": boolean,
  "exitCode": number | null,
  "repo": "string",
  "ref": "string",
  "model": "string"
}
```
Field source note: `repo` is read from `host-start.json.repo_url` with fallback to `host-start.json.repo`; `ref` is read from `host-start.json.git_ref` with fallback to `host-start.json.ref`.

### Error Object

```json
{
  "severity": "critical" | "error" | "warning",
  "source": "stderr" | "validation" | "quality-gate" | "secret-scan" | "timeout",
  "message": "string",
  "line": number | null
}
```

### Anomaly Object

```json
{
  "type": "timeout-risk" | "timeout",
  "severity": "warning" | "critical",
  "message": "string"
}
```

---

## Configuration

### Directory Structure

The CLI looks for instances in:
- Results: `/agents/kaseki-results/kaseki-N/`
- Workspace: `/agents/kaseki-runs/kaseki-N/` (optional, for running instances)

### Testing Mode

To test with custom directories:

```javascript
const kasekiCli = require('./kaseki-cli-lib.js');

// Override config for testing
kasekiCli.config.KASEKI_RESULTS_DIR = '/custom/path/kaseki-results';
```

---

## Examples

### Example 1: Monitor and Alert

```bash
#!/bin/bash
while true; do
  STATUS=$(./kaseki-cli.js status kaseki-1 | jq -r '.timeoutRiskPercent')
  if (( $(echo "$STATUS > 85" | bc -l) )); then
    echo "🚨 Timeout risk: $STATUS%" | mail -s "Kaseki Alert" ops@team.com
  fi
  sleep 10
done
```

### Example 2: Parse Changes from Completed Run

```bash
ANALYSIS=$(./kaseki-cli.js analysis kaseki-1)
echo "Changed files:"
echo $ANALYSIS | jq -r '.changedFiles[]'
echo "Diff size: $(echo $ANALYSIS | jq '.diffSizeKb') KB"
```

### Example 3: Combine Status + Errors

```bash
./kaseki-cli.js status kaseki-1 > /tmp/status.json
./kaseki-cli.js errors kaseki-1 > /tmp/errors.json
./kaseki-cli.js analysis kaseki-1 > /tmp/analysis.json

# Process combined data
jq -s '. as $data | {status: $data[0], errors: $data[1], analysis: $data[2]}' \
  /tmp/status.json /tmp/errors.json /tmp/analysis.json
```

---

## Troubleshooting

### "Instance not found"
- Verify instance name matches format `kaseki-N` where N is digits
- Check that `/agents/kaseki-results/kaseki-N/` directory exists

### Empty results for running instances
- Stage extraction requires `==>` markers in stdout.log
- Elapsed time estimation requires `metadata.json` with `start_time`

### Docker ps errors
- Docker may not be available (safe to ignore in test environments)
- Running check falls back to checking workspace directory existence

---

## Architecture

The CLI is split into two parts:

1. **`kaseki-cli-lib.js`** — Core query library
   - 600+ lines of reusable functions
   - No side effects, all I/O is read-only
   - Suitable for programmatic use and testing

2. **`kaseki-cli.js`** — CLI executable
   - Command-line interface using library
   - Formats output (JSON, tables, streaming)
   - Handles user options and arguments

---

## Performance Notes

- **listInstances()**: Scans `/agents/kaseki-results/` directory; O(n) where n = number of instances
- **readLiveLog()**: Tail only; avoids re-reading entire logs
- **getInstanceStatus()**: Lightweight; reads small JSON files and parses stage from logs
- **detectErrors()**: Scans stderr and error files; proportional to log size
- **getAnalysis()**: Collects data from multiple artifacts; good for post-run analysis

Suitable for:
- Polling every 5-10 seconds during runs
- Real-time log streaming
- Post-run batch analysis

---

## Future Enhancements

- **Baseline timing data**: Store per-stage historical medians for anomaly detection
- **Webhook integration**: Callback external services on status changes
- **Metrics export**: Prometheus-compatible metrics for monitoring stacks
- **Sub-task progress**: Real-time visibility into Pi agent tool invocations (requires enhanced logging)
