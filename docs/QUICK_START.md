# Kaseki Agent Quick Start Guide

Welcome! This guide will help you set up and use kaseki-agent in **5 minutes or less**.

> **New to kaseki-agent?** Start with the **[Decision Tree](#decision-tree)** below to find your path.

---

## Decision Tree

**What's your deployment environment?**

- [**Docker Compose**](#docker-compose-deployment) — Standard single-server deployment (recommended)
  - Perfect for: Dockhand, Portainer, systemd+docker
  - Includes init container that auto-fixes permissions
  - Setup time: 3-5 minutes

- [**Single-Run Execution**](#single-run-execution) — One-off tasks without persistence
  - Perfect for: CI/CD scripts, quick testing, local development
  - Setup time: 2 minutes
  - No infrastructure needed

- [**Kubernetes**](#kubernetes-deployment) — Multi-replica, cloud-native deployments
  - Perfect for: Multi-instance setups, advanced orchestration
  - Setup time: 10-15 minutes
  - Requires Helm or manual manifest editing

---

### Docker Compose Deployment

**Best for**: Production deployments, Dockhand, Portainer, VMs  
**Setup time**: 3-5 minutes  
**Persistence**: Yes (results in `/agents/kaseki-results/`)

#### Step 1: Get Your API Key

1. Visit [OpenRouter](https://openrouter.ai) and sign up
2. Go to **Settings** → **API Keys** and create a new key
3. Copy the key (starts with `sk-or-`)

#### Step 2: Prepare `/agents` Directory

The init container will attempt to fix permissions automatically, but you may need to pre-create the directory:

```bash
# On the host running Docker:
sudo mkdir -p /agents
sudo chmod 755 /agents
# (Init container will set UID 10000 ownership if it can)
```

#### Step 3: Deploy the API Service

```bash
# In the kaseki-agent repository directory
export OPENROUTER_API_KEY=sk-or-your-key-here
mkdir -p /home/pi/secrets
echo "$OPENROUTER_API_KEY" > /home/pi/secrets/openrouter_api_key
chmod 600 /home/pi/secrets/openrouter_api_key

# Start the service (includes init container)
docker-compose up -d

# Monitor startup
docker-compose logs -f kaseki-api
```

#### Step 4: Verify Deployment

```bash
# Check if API is responding
curl http://localhost:8080/ready

# Check preflight status
sudo kaseki-agent host preflight | jq .
```

**If you see permission errors:**

- Check init container logs: `docker-compose logs kaseki-init`
- Follow the error message in logs (provides platform-specific fix)
- Or see [Dockhand/Portainer guide](#dockhandandportainer) in DEPLOYMENT.md

---

## Decision Tree

**What do you want to do?**

- [**Run one-off code tasks**](#single-run-execution) — Submit individual tasks without persistence
- [**Run multiple tasks from your machine**](#local-api-service) — Start an API service locally
- [**Deploy to production**](#production-rest-api) — Docker Compose with persistent storage

---

## Single-Run Execution

**Best for**: One-off tasks, CI/CD scripts, experiments  
**Setup time**: 2 minutes  
**Persistence**: No (results in ephemeral `/agents/kaseki-results/kaseki-N`)

### Step 1: Get your API key

1. Visit [OpenRouter](https://openrouter.ai) and sign up for free
2. Go to **Settings** → **API Keys** and create a key
3. Copy the key (starts with `sk-or-`)

### Step 2: Run a task

```bash
export OPENROUTER_API_KEY=sk-or-your-key-here
./run-kaseki.sh --repo https://github.com/user/repo --ref main
```

### Step 3: Check results

```bash
ls -la /agents/kaseki-results/
cat /agents/kaseki-results/kaseki-1/result-summary.md
```

### Customization

```bash
# Specify what the agent should do
TASK_PROMPT="Fix all TypeScript errors" ./run-kaseki.sh --repo https://github.com/user/repo --ref main

# Increase timeout for complex tasks
KASEKI_AGENT_TIMEOUT_SECONDS=2400 ./run-kaseki.sh --repo https://github.com/user/repo --ref main

# Limit which files can be changed
KASEKI_CHANGED_FILES_ALLOWLIST="src/**" ./run-kaseki.sh --repo https://github.com/user/repo --ref main
```

### Common Issues

**Error: `Docker is not installed or not accessible`**  
→ Install Docker: <https://docs.docker.com/install/>

**Error: `Permission denied` when writing to `/agents`**  
→ Run on the host: `sudo chown 10000:10000 /agents && sudo chmod 755 /agents`  
→ Then restart: `docker-compose down && docker-compose up -d` (if using Docker Compose)

**Exit code 4: Diff exceeds maximum size**  
→ Increase the limit: `KASEKI_MAX_DIFF_BYTES=400000 ./run-kaseki.sh ...`

---

## Local API Service

**Best for**: Multiple tasks on one machine, interactive workflows, CLI tooling  
**Setup time**: 5-10 minutes  
**Persistence**: Local (results in `~/.kaseki/results/`)

### Step 1: Setup (one-time)

```bash
kaseki-agent init
```

Follow the wizard. It will:

- Auto-detect your environment
- Ask which path you want (select "Local API service")
- Save credentials securely to `~/.kaseki/secrets.json`
- Generate `.env` configuration

### Step 2: Start the API service

```bash
npm install  # First time only
npx kaseki-agent serve --port 8080
```

### Step 3: Submit tasks (in another terminal)

```bash
# Simple task
npx kaseki-agent run https://github.com/user/repo main

# With custom prompt
TASK_PROMPT="Add error handling to all endpoints" npx kaseki-agent run https://github.com/user/repo main

# Dry-run (validate without running agent)
KASEKI_DRY_RUN=1 npx kaseki-agent run https://github.com/user/repo main
```

### Step 4: Monitor progress

```bash
# List all runs
npx kaseki-agent list

# Check status of a specific run
npx kaseki-agent status kaseki-1

# View full report
npx kaseki-agent report kaseki-1

# Stream logs in real-time
npx kaseki-agent report kaseki-1 --follow
```

### Customization

Edit `.env` to change:

- Validation commands (`KASEKI_VALIDATION_COMMANDS`)
- AI model (`KASEKI_MODEL`)
- Timeout (`KASEKI_AGENT_TIMEOUT_SECONDS`)
- Maximum diff size (`KASEKI_MAX_DIFF_BYTES`)

See [Advanced Configuration](#advanced-configuration) for more options.

### Common Issues

**API service fails to start**  
→ Check port is available: `lsof -i :8080`  
→ Run health check: `kaseki-agent doctor`

**Tasks fail validation**  
→ Check: `npx kaseki-agent report kaseki-1` → `validation.log`  
→ Common: validation commands don't exist in target repo  
→ Fix: Customize `KASEKI_VALIDATION_COMMANDS` in `.env`

---

## Production REST API

**Best for**: Production deployments, multi-host setups, CI/CD integration  
**Setup time**: 10-20 minutes  
**Persistence**: Persistent (results in `/agents/kaseki-results/`)

### Step 1: Install Docker Compose

```bash
# macOS / Linux
docker-compose --version  # Should be v2.0+

# If not installed
brew install docker-compose  # macOS
sudo apt-get install docker-compose  # Ubuntu/Debian
```

### Step 2: Prepare the host (first-time setup)

Create the `/agents` directory on the host with correct ownership for UID 10000 (the container user):

```bash
# Create and fix ownership
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# Verify
ls -ld /agents  # Should show: drwxr-xr-x 2 10000 10000 ...
```

**Why?** The container runs as UID 10000 (non-root hardening). The `/agents` directory must be writable by this UID. Without correct ownership, startup checks will fail and the container will restart repeatedly. See [Troubleshooting](#common-issues) below if you encounter permission errors.

### Step 3: Prepare secrets (first-time)

Create the secrets directory and add your API key:

```bash
mkdir -p /home/pi/secrets
echo "sk-or-your-openrouter-api-key" > /home/pi/secrets/openrouter_api_key
chmod 600 /home/pi/secrets/openrouter_api_key

# Optional: GitHub App credentials (for GitHub integration)
echo "your-app-id" > /home/pi/secrets/github_app_id
echo "your-client-id" > /home/pi/secrets/github_app_client_id
echo "-----BEGIN RSA PRIVATE KEY-----" > /home/pi/secrets/github_app_private_key
# ... paste full private key ...
echo "-----END RSA PRIVATE KEY-----" >> /home/pi/secrets/github_app_private_key
```

### Step 4: Validate setup (optional but recommended)

Run the pre-flight validation script to catch configuration issues before deploying:

```bash
./scripts/kaseki-preflight-docker-compose.sh

# Expected output (all checks passing):
# ✓ /agents directory exists
# ✓ /agents is owned by UID:GID 10000:10000
# ✓ docker command found
# ✓ Docker daemon is accessible
# ✓ docker-compose is available
# ✓ docker-compose.yml is valid
```

### Step 5: Start the service

```bash
docker-compose up -d
```

### Step 6: Verify it's running

```bash
# Watch startup logs (should show no permission errors)
docker-compose logs -f kaseki-api

# Liveness check (wait ~30s for startup)
curl http://localhost:8080/health

# Readiness/preflight diagnostics
curl http://localhost:8080/ready
sudo kaseki-agent host preflight

# View current runs
curl -H "Authorization: Bearer $(sudo sed -n '1p' /home/pi/secrets/kaseki_api_keys)" \
  http://localhost:8080/api/runs
```

### Step 7: Submit tasks via API

```bash
# Validate first
curl -X POST http://localhost:8080/api/validate \
  -H "Authorization: Bearer $(cat /home/pi/secrets/openrouter_api_key)" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo",
    "ref": "main",
    "taskPrompt": "First-time setup smoke test"
  }'

# Then submit
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer $(cat /home/pi/secrets/openrouter_api_key)" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo",
    "ref": "main",
    "taskPrompt": "Fix TypeScript errors",
    "publishMode": "none"
  }'

# Via CLI (if installed locally)
KASEKI_API_URL=http://localhost:8080/api \
KASEKI_API_KEY="$(cat /home/pi/secrets/openrouter_api_key)" \
  kaseki-agent run https://github.com/user/repo main
```

### Customization

Edit `.env` to change:

- API port: `KASEKI_API_PORT=8080`
- Concurrent runs: `KASEKI_API_MAX_CONCURRENT_RUNS=3`
- Log directory: `KASEKI_LOG_DIR=/var/log/kaseki`

### Common Issues

**Error: Container repeatedly restarts with permission errors**

Logs show:

```
✗ /agents exists but is not writable by UID 10000
✗ Fix: Run on host: sudo chown 10000:10000 /agents
```

Solution:

```bash
# On the host (not in container):
sudo chown 10000:10000 /agents
sudo chmod 755 /agents
docker-compose down
docker-compose up -d
```

**Error: "Could not create /agents/kaseki-template"**

This warning is **normal** on first startup. The API service will auto-initialize the template. If it persists after startup completes, check permissions are correct (see above).

**Error: Health check fails or times out**

```bash
# Check logs
docker-compose logs kaseki-api | tail -50

# Verify /agents ownership is correct
ls -ld /agents

# Ensure API key file is readable
ls -la /home/pi/secrets/openrouter_api_key
```

See [DEPLOYMENT.md](DEPLOYMENT.md#troubleshooting-startup-failures) for comprehensive troubleshooting.

### Production Checklist

- [ ] `/agents` directory exists and is writable by Docker (UID 10000)
- [ ] Secret files live in `~/secrets`, directory mode `0750`, file mode `0640`, group `10000`
- [ ] Docker socket mounted: `-v /var/run/docker.sock:/var/run/docker.sock`
- [ ] Results volume persistent: `-v /agents:/agents`
- [ ] API accessible from CI/CD: correct base URL and firewall rules
- [ ] Logging configured: `KASEKI_LOG_DIR` points to persistent storage
- [ ] Monitoring/alerts setup (optional): track API health, queue depth

### Common Issues

**Permission denied writing to `/agents`**  

```bash
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 775 /agents
```

Or run: `sudo kaseki-agent host setup --fix`

**Preflight reports a deleted bind mount**

The host directory was removed after the container started. Recreate the host
directories, then recreate the container:

```bash
sudo npm install -g @cyanautomation/kaseki-agent@latest
sudo kaseki-agent host setup --fix --recreate-api --wait-ready
sudo kaseki-agent host preflight
```

**Docker socket not accessible**  

```bash
# Verify socket exists and is readable
ls -la /var/run/docker.sock

# If using rootless Docker, adjust mount path
# See: https://docs.docker.com/engine/security/rootless/
```

**API service won't start**  

```bash
# Check logs
docker-compose logs kaseki-api

# Verify Docker image is available
docker pull docker.io/cyanautomation/kaseki-agent:latest
```

---

## Advanced Configuration

All three paths support advanced customization via environment variables:

### Common Customizations

**Restrict files agent can modify**:

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
```

**Use a different AI model** (costs more, better quality):

```bash
KASEKI_MODEL=openrouter/openai/gpt-4-turbo
```

**Increase timeout for complex tasks**:

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=3600  # 1 hour
```

**Skip pre-flight validation** (only validate after agent runs):

```bash
KASEKI_PRE_AGENT_VALIDATION=false
```

### Complete Variable Reference

For full documentation of all 60+ configuration variables:
→ See [docs/ADVANCED_CONFIG.md](../docs/ADVANCED_CONFIG.md)

Variables are organized by zone:

- **Execution**: What code to run
- **Validation**: What to check
- **Caching**: Performance optimization
- **Infrastructure**: API service & Docker
- **Advanced**: Experimental features

---

## Next Steps

### For Understanding

- [Architecture Overview](../docs/IMPLEMENTATION_SUMMARY.md) — How kaseki-agent works
- [Advanced Configuration](../docs/ADVANCED_CONFIG.md) — All 60+ variables explained
- [Troubleshooting](../docs/TROUBLESHOOTING_FLOW.md) — Error decision tree

### For Integration

- [CI/CD Integration](../docs/CI_CD_INTEGRATION.md) — GitHub Actions, GitLab CI, etc.
- [API Reference](../docs/API.md) — REST API endpoints and schemas
- [Distributed Setup](../docs/DISTRIBUTED_SETUP.md) — Multi-host deployments

### For Operations

- [Deployment Guide](../docs/DEPLOYMENT.md) — Production hardening, monitoring
- [Disaster Recovery](../docs/DISASTER_RECOVERY.md) — Backups, incident response
- [Cost Estimation](../docs/COST_ESTIMATION.md) — OpenRouter pricing, optimization

---

## Getting Help

**First time?**  
→ Re-read the [Decision Tree](#decision-tree) section above

**Configuration issue?**  
→ Run: `kaseki-agent doctor --verbose`  
→ Check: [docs/TROUBLESHOOTING_FLOW.md](../docs/TROUBLESHOOTING_FLOW.md)

**Found a bug?**  
→ Open an issue: <https://github.com/CyanAutomation/kaseki-agent/issues>

**Want to contribute?**  
→ See: [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**Happy coding! 🚀**
