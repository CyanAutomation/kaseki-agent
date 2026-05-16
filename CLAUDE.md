# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Kaseki Agent is an ephemeral coding-agent runner: it spins up a disposable Docker container, clones a target Git repository inside it, invokes the Pi CLI coding agent via OpenRouter, runs validation commands, and collects artifacts. Each run is a numbered instance (kaseki-1, kaseki-2, …).

## Current Infrastructure Status (May 2026)

- **Node.js**: v24 (bookworm-slim base image)
- **Docker Build**: Optimized multi-stage with consolidated RUN layers
- **CI/CD**: Parallelized pipeline with GHA caching (80-90% hit rate)
  - **GitHub Actions**: All actions updated to native Node.js 24 support (v6+ for checkout/setup-node, v7+ for upload-artifact)
  - **Trivy Scanner**: Pinned to v0.36.0 (no floating @master refs)
- **Security**: Trivy scanning with SBOM generation
- **Deployment**: Docker Compose (preferred) with Node.js fallback

## Setup Simplification (Completed May 2026)

A major simplification initiative has been completed to reduce setup friction. **Breaking changes released** — old setup paths no longer supported.

### What Changed

**Before**: 3 fragmented entry points

- npm CLI setup + serve (complex dependency on global Node.js)
- Shell script path (`./scripts/kaseki-setup.sh` + `./run-kaseki.sh`)
- Docker bootstrap ceremony: manual `kaseki-activate.sh --controller bootstrap`
- Configuration: 60+ env vars scattered across 3 files

**After**: Unified `kaseki-agent init` wizard + Zero-Touch Docker

- Single decision tree: single-run vs local API vs production
- Auto-detects environment (Docker, Node.js, permissions)
- Unified credential storage: `~/.kaseki/secrets.json` (mode 0600)
- Essential 8 variables (8 shown, 50+ auto-detected)
- Early permission checks prevent silent failures
- Template auto-initializes; no bootstrap ceremony needed

### Implementation Complete (Phases 1, 2, 3, 4, 5, 6)

**Phase 1: Unified Setup Command** ✅

- `src/setup/SetupWizard.ts` — Interactive wizard with environment detection
- `src/cli/commands/InitCommand.ts` — New primary setup entry point

**Phase 2: Permission Validation** ✅

- `scripts/startup-checks.sh` — Early permission checking with actionable errors
- Integrated into `scripts/docker-entrypoint.sh` — runs before any operation

**Phase 3: Bootstrap Auto-Initialization** ✅

- `src/kaseki-api-service.ts` → `ensureTemplateInitialized()` — auto-copies template from image
- No manual `kaseki-activate.sh --controller bootstrap` needed anymore
- API service starts automatically with zero setup ceremony

**Phase 4: Configuration Complexity Reduction** ✅

- Essential 8 variables identified and documented
- 50+ advanced variables auto-detected based on environment

**Phase 5: Unified Documentation** ✅

- `docs/QUICK_START.md` — Single decision tree for all paths
- `docs/ADVANCED_CONFIG.md` — Complete reference (60+ variables organized by zone)

**Phase 6: Formal Deprecation** ✅

- `docs/MIGRATION.md` — Guide for users transitioning from old setup paths
- Old commands/scripts no longer functional (breaking changes)
- Clear error messages direct users to new setup process

### Files Created/Modified

**New Files (9)**:

- `src/setup/SetupWizard.ts` — Interactive setup orchestrator
- `src/cli/commands/InitCommand.ts` — New primary setup command
- `.env.template` — Minimal Essential 8 configuration
- `.env.advanced.template` — Complete variable reference
- `scripts/startup-checks.sh` — Permission validation and startup diagnostics
- `docs/QUICK_START.md` — Unified quick-start guide (decision tree)
- `docs/ADVANCED_CONFIG.md` — Complete configuration reference
- `docs/MIGRATION.md` — Migration guide for existing users

**Modified Files (5)**:

- `scripts/docker-entrypoint.sh` — Added Phase 2 startup checks
- `src/kaseki-api-service.ts` — Added Phase 3 auto-initialization
- `src/cli/commands/SetupCommand.ts` — Deprecated (now delegates to wizard)
- `src/cli/KasekiCLI.ts` — Updated to feature 'init' command
- `src/cli.ts` — Updated help text

## Architecture: Host-Container Separation

Two layers, each with its own script:

**Host (`run-kaseki.sh`)** — runs on the bare host:

- Auto-generates instance names, creates per-run workspace and results directories (ephemeral, cleaned up after run)
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

### 🎯 Setup (All New Users Start Here)

```bash
# Interactive setup wizard - choose your execution path
kaseki-agent init

# This guides you through:
# - Environment detection (Docker, Node.js, permissions)
# - Path selection (single-run vs local API vs production)
# - Essential 8 configuration (API key, validation, timeouts)
# - Auto-generated smart defaults
# - Secure credential storage
```

### Single-Run Execution

```bash
# Basic run (auto-generates kaseki-N)
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh

# Explicit instance name
OPENROUTER_API_KEY=sk-or-... ./run-kaseki.sh kaseki-7

# API key via secret file
OPENROUTER_API_KEY_FILE=~/.kaseki/secrets.json ./run-kaseki.sh

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

### Deprecated Commands (No Longer Supported)

The following commands have been **removed**:

```bash
# ✗ Old setup command (removed)
kaseki-agent setup

# ✗ Old shell scripts (removed)
./scripts/kaseki-setup.sh
./scripts/kaseki-activate.sh

# ✗ Bootstrap ceremony (no longer needed)
# The API service auto-initializes now; just run: docker-compose up -d
```

**Migration**: See [docs/MIGRATION.md](docs/MIGRATION.md) for users transitioning from old setup paths.

## Deploying the Kaseki API Service

### ✅ Recommended: Docker Compose

```bash
# Start the API service (see docs/DEPLOYMENT.md for full options)
export KASEKI_API_KEYS=sk-your-secret-key
cd /agents/kaseki-template
docker-compose up -d

# Monitor
docker-compose logs -f kaseki-api
```

### Fallback: Node.js Process

```bash
# Install and run (if Docker is unavailable)
npm install
KASEKI_API_KEYS=sk-your-secret-key npm run kaseki-api
```

**Note on directory structure:**

- `run-kaseki.sh` and ephemeral worker containers create their own per-run `/agents/kaseki-runs/` workspaces (cleaned up after each run)
- The kaseki-api service **automatically creates** `/agents/kaseki-results/` on startup (no pre-setup needed) — this persists run artifacts for monitoring and analysis
- Both approaches share the same `/agents/kaseki-cache/` for optional dependency caching

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for comprehensive deployment guidance, including volume mount requirements for Dockhand/Portainer deployments.

## Key Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required (or use file) |
| `OPENROUTER_API_KEY_FILE` | `~/.kaseki/secrets.json` | Preferred; set by setup wizard |
| `REPO_URL` | CyanAutomation/crudmapper | Target repo |
| `GIT_REF` | main | Branch/tag/commit |
| `KASEKI_MODEL` | openrouter/free | Pi model string |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | 1200 | Pi invocation timeout |
| `TASK_PROMPT` | *(code fix task)* | Agent instruction |
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Semicolon-separated; missing npm scripts are skipped (non-fatal) |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | `src/lib/parser.ts tests/parser.validation.ts` | Space-separated patterns (agent phase) |
| `KASEKI_VALIDATION_ALLOWLIST` | — | Space-separated patterns (validation phase; optional) |
| `KASEKI_MAX_DIFF_BYTES` | 200000 | Max diff size (200 KB) |
| `KASEKI_DEBUG_RAW_EVENTS` | 0 | Keep raw Pi JSONL |
| `KASEKI_KEEP_WORKSPACE` | 0 | Remove per-run workspace after each run |
| `KASEKI_STREAM_PROGRESS` | 1 | Stream sanitized progress lines |
| `KASEKI_IMAGE` | docker.io/cyanautomation/kaseki-agent:latest | Image to use |

## Quality Gates and Exit Codes

Quality gates run after the agent completes, before reporting success:

| Gate | Exit Code | Variable |
|---|---|---|
| Missing API key / config | 2 | — |
| Empty git diff | 3 | — |
| Diff exceeds max bytes | 4 | `KASEKI_MAX_DIFF_BYTES` |
| Changed file outside allowlist | 5 | `KASEKI_CHANGED_FILES_ALLOWLIST` |
| Validation phase files outside allowlist | 7 | `KASEKI_VALIDATION_ALLOWLIST` |
| Secret scan hit (sk-or-* leak NOT in allowlist) | 6 | `.kaseki-secret-allowlist` |
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
- `restoration.jsonl` — structured allowlist restoration events (JSONL format)
- `restoration-report.md` — human-readable allowlist restoration report
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
- Docker runtime: `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, non-root user (UID 10000)
- Secret scan checks the results, workspace git metadata, and source dirs for `sk-or-*` patterns
- Detected patterns are allowlisted via `.kaseki-secret-allowlist` file (one entry per line: `<file>:<pattern>`)
- Only real leaks (unallowlisted patterns) trigger exit code 6; test fixtures are permitted

## Container Image Scanning

Kaseki-agent container images are scanned for vulnerabilities using industry-standard tools:

### Automated Scanning (CI/CD)

GitHub Actions automatically scans images on every build using **Trivy**:

```yaml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: 'docker.io/cyanautomation/kaseki-agent:latest'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'HIGH,CRITICAL'

- name: Upload to GitHub Security tab
  uses: github/codeql-action/upload-sarif@v4
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

1. `kaseki-report /agents/kaseki-results/kaseki-N` (compact summary, includes allowlist metrics)
2. `result-summary.md` → status + failed command
3. `restoration-report.md` → if many files were restored before validation
4. `metadata.json` → per-stage exit codes
5. `stdout.log` / `stderr.log` → execution flow
6. `pi-summary.json` / `pi-events.jsonl` → agent activity
7. `validation.log` + `validation-timings.tsv` → command failures
8. `quality.log` + `changed-files.txt` → allowlist/diff violations
9. `secret-scan.log` → credential detection

## Allowlist Configuration & Troubleshooting

**Problem: Too many files are restored before validation?**

See [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md) for:

- Allowlist pattern syntax and examples
- Pre-built templates for common task types
- How to use `scripts/suggest-allowlist.sh` to auto-generate patterns
- How to use `scripts/dry-run-allowlist.sh` to preview restoration
- Decision tree for choosing the right allowlist

**Problem: Agent made too many unintended changes?**

See [docs/TASK_PROMPT_TEMPLATES.md](docs/TASK_PROMPT_TEMPLATES.md) for:

- How to write clear, scoped task prompts
- Examples of good vs. bad prompts
- Anti-patterns that lead to scope creep
- How to combine prompts with allowlist for best results

## CI/CD

`.github/workflows/build-docker-image.yml` builds multi-arch images (amd64 + arm64 via QEMU), runs smoke tests (Pi CLI available, metadata structure valid), and publishes to `docker.io/cyanautomation/kaseki-agent:latest`.

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
