# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Kaseki Agent is an ephemeral coding-agent runner: it spins up a disposable Docker container, clones a target Git repository inside it, invokes the Pi CLI coding agent via OpenRouter, runs validation commands, and collects artifacts. Each run is a numbered instance (kaseki-1, kaseki-2, …).

## Current Infrastructure Status (May 2026)

- **Node.js**: v24 (bookworm-slim base image)
- **Docker Build**: Optimized multi-stage with consolidated RUN layers
- **CI/CD**: Parallelized pipeline with GHA caching (80-90% hit rate)
- **Security**: Trivy scanning with SBOM generation

## Architecture: Host-Container Separation

Two layers, each with its own script:

**Host (`run-kaseki.sh`)** — runs on the bare host:

- Auto-generates instance names, creates per-run workspace and results directories
- Resolves the OpenRouter API key (env var or secret file), mounts it read-only
- Launches Docker with hardened runtime flags (`--read-only`, `--cap-drop ALL`, tmpfs, non-root user)
- Cleans up on exit

**Container (`kaseki-agent.sh`)** — runs inside the container:

- Clones the repo at the requested ref
- Prepares Node.js dependencies via a 4-layer cache (stamp check → workspace cache → image seed cache → fresh install)
- Invokes Pi with a configurable timeout
- Runs validation commands sequentially, recording timings
- Enforces quality gates (diff size, changed-file allowlist, secret scan)
- Writes all artifacts to `/results`

**Supporting utilities (Node.js):**

- `pi-event-filter.js` — filters raw Pi JSONL, strips thinking blocks, emits `pi-events.jsonl` + `pi-summary.json`
- `kaseki-report.js` — reads a results directory and prints a compact diagnostic report
- `kaseki-cli.js` + `kaseki-cli-lib.js` — live monitoring CLI for external AI agents (see [docs/CLI.md](docs/CLI.md))

**Directory layout at runtime:**

```
/agents/kaseki-template/          # Dockerfile, scripts (this repo)
/agents/kaseki-runs/kaseki-N/     # Per-run workspace (cloned repo, node_modules)
/agents/kaseki-results/kaseki-N/  # Artifacts (logs, diff, metadata, summary)
/agents/kaseki-cache/             # Optional host-level dependency cache
```

## Common Commands

```bash
# Basic run (auto-generates kaseki-N)
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh

# Explicit instance name
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh kaseki-7

# API key via secret file
OPENROUTER_API_KEY_FILE=~/secrets/openrouter_api_key ./run-kaseki.sh

# Custom target repo + branch
REPO_URL=https://github.com/org/repo GIT_REF=feature/branch OPENROUTER_API_KEY=... ./run-kaseki.sh

# Health/sanity check (no agent run)
./run-kaseki.sh --doctor

# Build image locally
docker build -t kaseki-template:latest .

# Generate diagnostic report for a completed run
docker run --rm --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-4:/results:ro \
  kaseki-template:latest /results
```

## Key Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required (or use file) |
| `OPENROUTER_API_KEY_FILE` | `/run/secrets/openrouter_api_key` | Preferred; mounted read-only |
| `REPO_URL` | CyanAutomation/crudmapper | Target repo |
| `GIT_REF` | main | Branch/tag/commit |
| `KASEKI_MODEL` | openrouter/free | Pi model string |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | 1200 | Pi invocation timeout |
| `TASK_PROMPT` | *(code fix task)* | Agent instruction |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Semicolon-separated |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | `src/lib/parser.ts tests/parser.validation.ts` | Space-separated patterns |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_DEBUG_RAW_EVENTS` | 0 | Keep raw Pi JSONL |
| `KASEKI_KEEP_WORKSPACE` | 0 | Remove per-run workspace after each run |
| `KASEKI_STREAM_PROGRESS` | 1 | Stream sanitized progress lines |
| `KASEKI_IMAGE` | docker.io/cyanautomation/kaseki-agent:0.1.0 | Image to use |

## Quality Gates and Exit Codes

Quality gates run after the agent completes, before reporting success:

| Gate | Exit Code | Variable |
|---|---|---|
| Missing API key / config | 2 | — |
| Empty git diff | 3 | — |
| Diff exceeds max bytes | 4 | `KASEKI_MAX_DIFF_BYTES` |
| Changed file outside allowlist | 5 | `KASEKI_CHANGED_FILES_ALLOWLIST` |
| Secret scan hit (sk-or-* leak) | 6 | — |
| Pi agent timeout | 124 | `KASEKI_AGENT_TIMEOUT_SECONDS` |
| Validation command failure | propagated | `KASEKI_VALIDATION_COMMANDS` |

## Result Artifacts

All written to `/agents/kaseki-results/kaseki-N/`:

- `metadata.json` — timestamps, exit codes per stage, model, instance name
- `result-summary.md` — human-readable status + key facts
- `pi-events.jsonl` / `pi-summary.json` — filtered agent events and stats
- `git.diff` / `git.status` / `changed-files.txt` — repo changes
- `validation.log` / `validation-timings.tsv` — command output + timing
- `quality.log` / `secret-scan.log` — gate failures
- `progress.log` / `progress.jsonl` — sanitized stage and Pi event progress
- `cleanup.log` — mandatory post-run cleanup summary
- `stdout.log` / `stderr.log` / `exit_code` — raw execution output

## Dependency Caching

`kaseki-agent.sh` uses a stamp-based, 4-layer cache to avoid redundant `npm ci` runs:

1. Check if node_modules + lock hash stamp already match → skip
2. Restore from workspace cache (`/workspace/.kaseki-cache/<repo-hash>/<lock-hash>/`)
3. Restore from image seed cache (`/opt/kaseki/workspace-cache/`)
4. Run `npm ci --prefer-offline` or `npm install`

The stamp file lives outside the repo directory to keep `git.status` clean.

## Security Hardening

- API key is **never passed as an env var to child processes** — resolved from file at runtime
- Docker runtime: `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, non-root user (UID 10001)
- Secret scan checks the results, workspace git metadata, and source dirs for `sk-or-*` patterns

## Container Image Scanning

Kaseki-agent container images are scanned for vulnerabilities using industry-standard tools:

### Automated Scanning (CI/CD)

GitHub Actions automatically scans images on every build using **Trivy**:

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'docker.io/cyanautomation/kaseki-agent:latest'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'HIGH,CRITICAL'

- name: Upload to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v2
  with:
    sarif_file: 'trivy-results.sarif'
```

Results are published to GitHub's **Security** → **Dependabot alerts** tab.

### Manual Scanning

To scan the image locally:

```bash
# Install Trivy (macOS)
brew install trivy

# Install Trivy (Linux)
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Scan latest image
trivy image docker.io/cyanautomation/kaseki-agent:latest

# Scan with severity filter
trivy image --severity HIGH,CRITICAL docker.io/cyanautomation/kaseki-agent:latest

# Generate JSON report
trivy image --format json --output report.json docker.io/cyanautomation/kaseki-agent:latest
```

### Known Vulnerabilities

Check GitHub Settings → Code security → Dependabot alerts for any discovered vulnerabilities. Most are transitive (in Pi CLI dependencies) and are addressed via dependency updates.

### Image Integrity (Optional)

Images can be signed using **cosign** for supply chain security:

```bash
# Verify signed image (requires public key)
cosign verify --key cosign.pub docker.io/cyanautomation/kaseki-agent:latest

# View image attestation
cosign verify-attestation --key cosign.pub docker.io/cyanautomation/kaseki-agent:latest
```

See [SECURITY.md](SECURITY.md) for detailed vulnerability response procedures.

## Diagnosing Failures

Recommended inspection order:

1. `kaseki-report /agents/kaseki-results/kaseki-N` (compact summary)
2. `result-summary.md` → status + failed command
3. `metadata.json` → per-stage exit codes
4. `stdout.log` / `stderr.log` → execution flow
5. `pi-summary.json` / `pi-events.jsonl` → agent activity
6. `validation.log` + `validation-timings.tsv` → command failures
7. `quality.log` + `changed-files.txt` → allowlist/diff violations
8. `secret-scan.log` → credential detection

## CI/CD

`.github/workflows/build-docker-image.yml` builds multi-arch images (amd64 + arm64 via QEMU), runs smoke tests (Pi CLI available, metadata structure valid), and publishes to `docker.io/cyanautomation/kaseki-agent` on version tags or manual dispatch.

## External Agent Monitoring with Kaseki CLI

The **Kaseki CLI** enables external AI agents to interrogate running and completed kaseki instances in real-time. This is useful for:

- **Status polling**: Get current stage, elapsed time, timeout risk
- **Error detection**: Identify failures in validation, quality gates, secret scans
- **Anomaly flagging**: Warn when timeout is imminent (>85% elapsed)
- **Log streaming**: Follow logs live as agent runs
- **Post-run analysis**: Comprehensive summary of changes, validation results, metrics

### Quick Example

```bash
# List all instances
./kaseki-cli.js list

# Get status of a running instance (JSON)
./kaseki-cli.js status kaseki-1

# Detect errors
./kaseki-cli.js errors kaseki-1

# Get post-run analysis
./kaseki-cli.js analysis kaseki-1

# Live monitor with anomaly alerts
./kaseki-cli.js watch kaseki-1 --interval=2

# Stream logs in real-time
./kaseki-cli.js follow kaseki-1

# Show sanitized progress events
./kaseki-cli.js progress kaseki-1 --tail=25
```

### Integration Pattern

An external agent can use the CLI to monitor kaseki:

```bash
#!/bin/bash
while true; do
  STATUS=$(./kaseki-cli.js status kaseki-1)
  RUNNING=$(echo $STATUS | jq -r '.running')
  TIMEOUT_RISK=$(echo $STATUS | jq -r '.timeoutRiskPercent')
  
  # Alert on timeout risk
  if (( $(echo "$TIMEOUT_RISK >= 85" | bc -l) )); then
    echo "⚠ Timeout imminent: ${TIMEOUT_RISK}%"
  fi
  
  # Exit when complete
  [ "$RUNNING" = "false" ] && break
  sleep 5
done

# Final analysis
./kaseki-cli.js analysis kaseki-1
```

See [docs/CLI.md](docs/CLI.md) for comprehensive documentation, library usage, and advanced integration patterns.
