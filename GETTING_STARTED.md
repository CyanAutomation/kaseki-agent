# Getting Started with Kaseki Agent

Follow this guide to install kaseki-agent, authenticate with an LLM
gateway, and submit your first coding task.

---

## 1. Install

Install globally so `kaseki-agent` is available system-wide:

```bash
npm install -g @cyanautomation/kaseki-agent
```

Or run inside the Docker image without local Node.js:

```bash
docker run -it docker.io/cyanautomation/kaseki-agent:latest init
```

**Prerequisites:**

- Node.js >= 24 on the host (for npm path), or Docker (image path)
- Network access to your LLM gateway endpoint and GitHub (if used)

---

## 2. Run the Setup Wizard

Run the interactive wizard to configure authentication, deployment mode,
and defaults:

```bash
kaseki-agent init
```

The wizard auto-detects your environment (Docker availability, Node.js
version, permissions) and guides you through:

- **Deployment path** -- Docker Compose (production API service) or
  single-run (ephemeral container per task)
- **Primary credentials** -- LLM Gateway URL and API key
  (see section 3)
- **Secondary fallback** -- Optional OpenRouter API key for model
  diversity
- **GitHub App credentials** -- Optional; needed only for PR-based change
  publishing

After setup, secrets are stored securely in `~/.kaseki/secrets.json`
(mode 0600).

---

## 3. Authentication: LLM Gateway (Default Provider)

Kaseki defaults to an **LLM Gateway** as its primary provider
(`KASEKI_PROVIDER=gateway`). The gateway accepts any
OpenAI-compatible endpoint.

### Primary credentials

Set these environment variables or provide them via the setup wizard:

- **`LLM_GATEWAY_URL`** -- OpenAI-compatible API endpoint.
  Example: `https://gateway.ai.cloudflare.com/v1/...`
- **`LLM_GATEWAY_API_KEY_FILE`** -- Path to file containing API key.
  Default: `~/.kaseki/secrets.json`
- **`LLM_GATEWAY_API_KEY`** -- Inline API key (less secure).
  Use `LLM_GATEWAY_API_KEY_FILE` in production.
- **`KASEKI_MODEL`** -- Model identifier.
  Default: `dynamic/kaseki-agent`.

### Supported gateways

Any OpenAI-compatible endpoint works. Examples include:

- **CloudFlare AI Workers**: CloudFlare Workers AI
  (`/compat` suffix required)
- **Azure OpenAI**: Azure OpenAI deployments
- **Ollama (local)**: Local Ollama server
- **OpenAI direct**: api.openai.com endpoints
- **Anthropic (via proxy)**: Any compatible proxy

The setup wizard probes your gateway URL during configuration and
verifies connectivity before saving.

### Environment variable summary

The `.env.template` file (root of the repository) defines all
configuration variables. The "Essential 8" variables cover core setup;
additional options exist in `.env.advanced.template`. See
[docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) for the full
reference.

---

## 4. Secondary/Fallback: OpenRouter

OpenRouter serves as the secondary provider when
`KASEKI_PROVIDER=openrouter`. It provides access to many models through
a single API.

To use OpenRouter instead of the gateway:

```bash
export KASEKI_PROVIDER=openrouter
export OPENROUTER_API_KEY=sk-or-your-key-here
# Or via secret file:
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets.json
```

You can also set both providers simultaneously and let `run-kaseki.sh`
select based on which credentials are available.

---

## 5. Deploy and Run Your First Task

Choose the path that matches your workflow.

### Option A: Docker Compose (Production API Service)

Use this for continuous operation, multi-task queuing, and REST API
access:

```bash
# Ensure /agents directory exists (API service uses this path)
sudo mkdir -p /agents
sudo chown 10000:10000 /agents

# Start the API service
cd /path/to/kaseki-template
docker-compose up -d

# Verify health
curl http://localhost:8080/health

# Submit a task via CLI
kaseki-agent run https://github.com/owner/repo main \
  "Fix TypeScript compilation errors"
```

The API service persists results in `/agents/kaseki-results/` and spawns
ephemeral worker containers for each task.

Monitor status:

```bash
kaseki-agent list              # List all instances
kaseki-agent status kaseki-1   # Live status + anomaly detection
kaseki-agent follow kaseki-1   # Stream logs real-time
```

### Option B: Single-Run (Ephemeral Container)

Use this for CI/CD pipelines or one-off tasks where no persistent
service is needed:

```bash
# Set gateway credentials inline
export LLM_GATEWAY_URL=https://gateway.ai.cloudflare.com/\
v1/account-id/namespace/compat
export LLM_GATEWAY_API_KEY=your-cloudflare-token
export KASEKI_MODEL=dynamic/kaseki-agent
export TASK_PROMPT="Add input validation to POST endpoints"

# Execute a single task (positional args: repo-url ref)
./run-kaseki.sh \
  https://github.com/owner/repo \
  main
```

Each invocation creates a numbered instance (`kaseki-1`, `kaseki-2`,
...), runs the task inside an isolated container, writes results to
`/results`, and cleans up the workspace afterward. Artifacts are preserved
in `kaseki-results/kaseki-N/` for inspection.

---

## 6. Monitor Results

After a task completes, inspect artifacts:

```bash
# Human-readable summary
cat kaseki-results/kaseki-1/result-summary.md

# Compact diagnostic report (inside the image)
docker run --rm \
  -v kaseki-results/kaseki-1:/results:ro \
  kaseki-template:latest /results

# Full metadata with phase data
cat kaseki-results/kaseki-1/metadata.json

# Progress events and agent activity
cat kaseki-results/kaseki-1/pi-events.jsonl | head -20
```

Exit codes indicate outcome:

- **0** -- Success; all gates passed
- **6** -- Secret scan detected a credential leak
- **88** -- Provider/model error (non-retryable after retry)
- **124** -- Agent timeout (exceeded `KASEKI_AGENT_TIMEOUT_SECONDS`)

See [docs/EXIT_CODES.md](docs/EXIT_CODES.md) for the complete list.

---

## 7. Development Workflow

Kaseki requires Node.js >= 24 for local development:

```bash
npm ci                   # Install dependencies
npm run check            # Lint and type-check
npm test                 # Run test suite
```

Optional tree-sitter probe:

```bash
npm install --global tree-sitter-cli@0.25.10
npm run test:tree-sitter:environment-probe
```

---

## Next Steps

- Read [docs/QUICK_START.md](docs/QUICK_START.md) for step-by-step quick-start
- Consult [docs/ADVANCED_CONFIG.md](docs/ADVANCED_CONFIG.md) for full variable reference
- Use [docs/CLI.md](docs/CLI.md) for live monitoring commands and patterns
- Review [docs/QUALITY_GATES.md](docs/QUALITY_GATES.md) for allowlist config
- See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for common issues

For deployment specifics (volume mounts, security hardening, scaling),
see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

**CyanAutomation** -- Building reliable AI coding workflows
