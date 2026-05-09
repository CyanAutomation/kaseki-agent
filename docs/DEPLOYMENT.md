# Kaseki Agent API Service - Deployment Guide

## Overview

The Kaseki API Service allows remote execution and monitoring of kaseki-agent runs via HTTP REST API.

**Authoritative deployment mode: Docker container runtime** (docker-compose, systemd+docker, or manual `docker run`). Host Node.js process mode is fallback/dev-only and is not the production reference path.

## Prerequisites

- Docker + Docker Compose (for docker-compose deployment)
- Node.js ≥ 24.x (for Node.js fallback deployment)
- OpenRouter API key for Pi agent invocation (inherited from kaseki-agent)

## Volume Mounts & Directory Structure

The kaseki-api service uses a persistent host volume to store run artifacts and spawn ephemeral worker containers.

### Volume Mount Requirement

When deploying the API container, mount the host's `/agents` directory as read-write:

```yaml
volumes:
  - /agents:/agents:rw                    # Host → Container bridge
  - /var/run/docker.sock:/var/run/docker.sock
```

The container will **automatically create** the required subdirectories:

- `/agents/kaseki-results/` — Persistent run artifacts (metadata, diffs, logs)
  - **Auto-created** on API startup (no pre-setup needed)
  - Contains per-run subdirectories: `kaseki-1/`, `kaseki-2/`, …
  - Written to by the API service and spawned worker containers

- `/agents/kaseki-runs/` — Per-run workspace directories (cloned repos, node_modules)
  - Created by ephemeral worker containers (not used by API service itself)
  - Cleaned up after each run (if `KASEKI_KEEP_WORKSPACE=0`, the default)

- `/agents/kaseki-cache/` — Optional dependency cache (npm packages)
  - Created by worker containers if `KASEKI_CACHE_ENABLED=1`
  - Speeds up repeated runs by sharing npm dependencies across instances

### Docker User & Permissions

The API container runs as **UID 1000** (non-root) by default:

```yaml
user: "1000:1000"
```

**Critical:** Ensure the host `/agents` directory has write permissions for UID 1000:

#### Option A: Preferred (if you own /agents on host)

```bash
mkdir -p /agents
chown 1000:1000 /agents
chmod 755 /agents
```

#### Option B: Required if /agents is owned by root

```bash
# Make /agents world-writable to allow container user (1000) to write
mkdir -p /agents
sudo chmod 777 /agents
```

#### Option C: WSL or rootless Docker (if sudo isn't available)

```bash
mkdir -p /agents
chmod 777 /agents
```

**Troubleshooting permission errors:**

- If you see `Permission denied` errors when writing to `/results/`:
  - Verify the host `/agents` directory exists and is writable: `ls -ld /agents`
  - If owned by root with 755: run `sudo chmod 777 /agents`
  - If the issue persists, restart docker-compose: `docker-compose down && docker-compose up -d`

### Dockhand/Portainer Deployment

When deploying via a container UI (Dockhand, Portainer):

1. Configure the volume mount in the service definition: `-v /agents:/agents:rw`
2. On the host, pre-create `/agents` with write permissions: `mkdir -p /agents && chmod 777 /agents`
3. The container will auto-create required subdirectories on startup with proper permissions
4. Check logs for: `KASEKI_RESULTS_DIR: /agents/kaseki-results` (confirms successful mount and auto-creation)
5. Verify with: `curl -H "Authorization: Bearer $KASEKI_API_KEYS" http://localhost:8080/api/preflight`

## Quick Start

### ✅ Recommended: Docker Compose

```bash
# Navigate to kaseki-agent repository
cd /agents/kaseki-template

# Set API key
export KASEKI_API_KEYS=sk-your-secret-key-here

# Build image from this repo
docker build -t kaseki-agent:node24-local .

# Start services (uses KASEKI_API_IMAGE, default: kaseki-agent:node24-local)
docker-compose up -d

# View logs
docker-compose logs -f kaseki-api

# Stop services
docker-compose down
```

The API container runs as the `/agents` owner by default (`1000:1000`) and must also be able to use the host Docker socket so it can launch ephemeral `kaseki-N` containers. Set `DOCKER_GID` to the group owner of `/var/run/docker.sock`:

```bash
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
docker-compose up -d
```

In Dockhand, Portainer, or another compose manager, keep the same shape:

```yaml
services:
  kaseki-api:
    user: "1000:1000"
    group_add:
      - "${DOCKER_GID:-985}"
    volumes:
      - /agents:/agents:rw
      - /var/run/docker.sock:/var/run/docker.sock
```

After deployment, verify controller readiness with the authenticated preflight endpoint:

```bash
curl -H "Authorization: Bearer $KASEKI_API_KEYS" \
  http://localhost:8080/api/preflight
```

**Configuration** (via environment variables):

```bash
# Core settings
KASEKI_API_KEYS=sk-key1,sk-key2            # Required: comma-separated API keys
KASEKI_API_PORT=8080                        # API listen port (default: 8080)
KASEKI_API_LOG_LEVEL=info                  # Log level: debug/info/warn/error
KASEKI_API_IMAGE=kaseki-agent:node24-local # Must be built from this repo's Dockerfile

# Performance
KASEKI_API_MAX_CONCURRENT_RUNS=3           # Max concurrent jobs (default: 3)
KASEKI_AGENT_TIMEOUT_SECONDS=1200          # Agent timeout in seconds (default: 20 min)
KASEKI_MAX_DIFF_BYTES=200000               # Max diff size (default: 200 KB)

# Paths (usually inherited from docker-compose)
KASEKI_RESULTS_DIR=/agents/kaseki-results
KASEKI_API_LOG_DIR=/var/log/kaseki-api
```

---

## Fallback Deployment Options

### Option 1: Node.js Process (Fallback)

Quick alternative if Docker/docker-compose is unavailable:

```bash
cd /agents/kaseki-template

# Install dependencies (lockfile-enforced)
npm ci --omit=dev

# Verify runtime
node -v  # Must report v24.x or newer

# Start API
KASEKI_API_KEYS=sk-dev-key npm run kaseki-api
```

**Environment variables:**

```bash
KASEKI_API_KEYS=sk-key1,sk-key2            # Required
KASEKI_API_PORT=8080                        # Default: 8080
KASEKI_API_LOG_LEVEL=info                  # Default: info
KASEKI_API_MAX_CONCURRENT_RUNS=3           # Default: 3
KASEKI_AGENT_TIMEOUT_SECONDS=1200          # Default: 1200
KASEKI_MAX_DIFF_BYTES=200000               # Default: 200000
```

**Production considerations:**

- Use a process manager (systemd, supervisor, PM2) for restart/recovery
- Run with `NODE_ENV=production` for optimal performance
- Monitor logs and uptime independently

### Option 2: systemd Service (Alternative)

Deploy as a systemd service on the host (advanced):

```bash
# 1. Build image from this repository
cd /agents/kaseki-template
npm ci --omit=dev
npm run build
docker build -t kaseki-agent:node24-local .

# 2. (Registry workflow) push/pull image before service restart
# docker tag kaseki-agent:node24-local registry.example.com/kaseki-agent:node24-2026-05-03
# docker push registry.example.com/kaseki-agent:node24-2026-05-03
# On target host: docker pull registry.example.com/kaseki-agent:node24-2026-05-03

# 3. Install systemd service (Docker mode only)
sudo cp scripts/kaseki-api.service /etc/systemd/system/
sudo systemctl daemon-reload

# 4. Create environment file
sudo mkdir -p /etc/kaseki-api
sudo tee /etc/kaseki-api/kaseki-api.env << EOF
KASEKI_API_KEYS=sk-your-secret-key
KASEKI_API_PORT=8080
KASEKI_API_LOG_LEVEL=info
KASEKI_RESULTS_DIR=/agents/kaseki-results
KASEKI_API_IMAGE=kaseki-agent:node24-local
EOF

# 5. Set appropriate permissions
sudo chown root:root /etc/kaseki-api/kaseki-api.env
sudo chmod 600 /etc/kaseki-api/kaseki-api.env

# 6. Start service
sudo systemctl enable kaseki-api
sudo systemctl start kaseki-api

# 7. Check status
sudo systemctl status kaseki-api
sudo journalctl -u kaseki-api -f
```

**Important behavior in Docker mode:**

- The unit executes `node /app/dist/kaseki-api-service.js` inside the container image.
- `/etc/kaseki-api/kaseki-api.env` only supplies environment variables; it does not mount over `/app/dist`.
- Mounted host volumes are `/agents`, `/agents/kaseki-results`, `/var/log/kaseki-api`, and `/var/run/docker.sock`; none are mounted at `/app`, so `/app/dist` always comes from the image artifact.

### Option 3: Manual Docker Container (Advanced)

Run the API container directly without docker-compose:

```bash
docker run --rm \
  --name kaseki-api \
  -p 8080:8080 \
  -v /agents:/agents:rw \
  -v /agents/kaseki-results:/agents/kaseki-results:rw \
  -v /var/log/kaseki-api:/var/log/kaseki-api:rw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e KASEKI_API_KEYS=sk-your-key \
  -e KASEKI_API_PORT=8080 \
  -e KASEKI_CONTAINER_USER=1000:1000 \
  -e KASEKI_AGENT_TIMEOUT_SECONDS=1200 \
  --user 1000:1000 \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --read-only \
  --entrypoint node \
  ${KASEKI_API_IMAGE:-kaseki-agent:node24-local} \
  /app/dist/kaseki-api-service.js
```

---

## Security Best Practices

1. **API Key Management**
   - Store keys in environment files with mode `0600` (or use Docker secrets)
   - Never commit keys to version control
   - Rotate keys regularly
   - Use separate keys for different environments (dev/staging/prod)
   - For GitHub App authentication, prefer mounted files:
     `GITHUB_APP_ID_FILE`, `GITHUB_APP_CLIENT_ID_FILE`, and
     `GITHUB_APP_PRIVATE_KEY_FILE`. Avoid placing the private key PEM directly
     in `.env`; environment variables are more likely to appear in process
     inspection output, container metadata, and deployment UI history.

2. **Network Security**
   - Expose API only on trusted networks (localhost or VPN)
   - Use firewall rules to restrict access:

     ```bash
     sudo ufw allow from 10.0.0.0/8 to any port 8080  # Example: allow from private network
     ```

   - Consider putting API behind a reverse proxy (nginx) with authentication

3. **Container Hardening**
   - All Docker deployments use:
     - `--cap-drop ALL` — Remove all Linux capabilities
     - `--security-opt no-new-privileges:true` — Prevent privilege escalation
     - `--read-only` — Read-only root filesystem
     - `tmpfs` — Temporary write-able directories
   - API runs as a non-root user that owns `/agents`
   - Add only the host Docker socket group as a supplemental group; do not run the API as root just to reach Docker

4. **TLS/HTTPS**
   - Forward HTTPS traffic via reverse proxy (e.g., nginx):

     ```nginx
     upstream kaseki_api {
       server localhost:8080;
     }

     server {
       listen 443 ssl http2;
       server_name api.kaseki.local;
       ssl_certificate /etc/letsencrypt/live/api.kaseki.local/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.kaseki.local/privkey.pem;

       location / {
         proxy_pass http://kaseki_api;
         proxy_set_header Authorization $http_authorization;
       }
     }
     ```

---

## Health Checks

All deployments should monitor health:

```bash
curl http://localhost:8080/health
# Equivalent namespaced endpoint:
curl http://localhost:8080/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2026-05-02T14:30:00Z",
  "queue": {
    "pending": 0,
    "running": 0,
    "maxConcurrent": 3
  }
}
```

---

## Monitoring

### Dependency Cache Behavior

- Worker installs are lockfile-only (`npm ci --omit=dev`) and will fail when no `package-lock.json` or `npm-shrinkwrap.json` is present.
- Scheduler/runner containers must keep a persistent cache mount at `/agents/kaseki-cache` (or override with `KASEKI_CACHE_DIR`) so dependency cache data survives between runs.
- `run-kaseki.sh` mounts that directory into workers at `/cache`, and workers use:
  - `KASEKI_DEPENDENCY_CACHE_DIR=/cache/dependencies`
  - `NPM_CONFIG_CACHE=/cache/npm-cache`
- Cache key is deterministic: `sha256(repo_url) + lockfile sha256 + Node major version`.
- Progress + timing artifacts include install/cache signals:
  - `progress.jsonl` / `progress.log`: dependency install stage, cache hit/miss, elapsed seconds.
  - `stage-timings.tsv`: `dependency install` row with cache source and install flags.
  - `dependency-cache.log`: summarized cache status.

### Docker Compose

```bash
# View logs
docker-compose logs -f kaseki-api

# Check resource usage
docker stats kaseki-api
```

### Node.js Process

```bash
# Check process status
ps aux | grep kaseki-api

# View recent logs (depends on logging setup)
tail -f /var/log/kaseki-api.log
```

### systemd Service

```bash
# Check status
systemctl status kaseki-api

# View logs (last 100 lines)
journalctl -u kaseki-api -n 100

# Stream logs
journalctl -u kaseki-api -f
```

### Prometheus Metrics

Metrics endpoint coming in Phase 8:

```bash
curl -H "Authorization: Bearer $KASEKI_API_KEYS" http://localhost:8080/api/metrics
```

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: kaseki_api
    metrics_path: /api/metrics
    scheme: http
    static_configs:
      - targets: ['kaseki-api:8080']
    authorization:
      credentials: ${KASEKI_API_KEY}
```

Readiness probe (no auth required):

```bash
curl -f http://localhost:8080/ready
# or
curl -f http://localhost:8080/api/ready
```

`/ready` returns `503` with machine-readable `reasons` when dependencies like results-dir writability,
scheduler queue introspection, or webhook processing health are unavailable.

---

## Log Rotation

### Docker Compose

Logs are managed by Docker automatically. To configure retention:

```bash
# Edit daemon.json
sudo nano /etc/docker/daemon.json
```

Add:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart Docker:

```bash
sudo systemctl restart docker
```

### Host Deployment (systemd/Node.js)

Configure logrotate:

```bash
sudo tee /etc/logrotate.d/kaseki-api << EOF
/var/log/kaseki-api/*.log {
  daily
  rotate 7
  compress
  delaycompress
  missingok
  notifempty
  create 0640 nobody nogroup
  sharedscripts
  postrotate
    systemctl reload kaseki-api > /dev/null 2>&1 || true
  endscript
}
EOF
```

---

## Troubleshooting

### API won't start

Check required environment variables:

```bash
# Must be set
echo $KASEKI_API_KEYS  # Should not be empty
ls -la /agents/kaseki-results  # Directory must exist
```

### Container/process is crashing

View logs for detailed error:

```bash
# Docker Compose
docker-compose logs kaseki-api | head -50

# Node.js
npm run kaseki-api  # Run in foreground to see errors

# systemd
journalctl -u kaseki-api -n 50
```

Common issues:

- Missing `/agents/kaseki-results` directory
- Invalid port (not between 1-65535)
- API key environment variable not set
- Docker daemon not running (for docker-compose)
- Node.js not installed or wrong version

### Slow performance

Check queue status:

```bash
curl -H "Authorization: Bearer sk-key" http://localhost:8080/api/runs

# Monitor running jobs
watch -n2 'curl -s http://localhost:8080/health | jq ".queue"'
```

Increase `KASEKI_API_MAX_CONCURRENT_RUNS` if jobs are queueing unnecessarily.

---

## Cleanup

### Docker Compose

```bash
cd /agents/kaseki-template
docker-compose down
docker volume prune  # Optional: delete unused volumes
```

### Node.js Process

```bash
# Stop the process
pkill -f "kaseki-api"

# Or if using npm:
# Ctrl+C in the terminal
```

### systemd Service

```bash
sudo systemctl stop kaseki-api
sudo systemctl disable kaseki-api
sudo rm /etc/systemd/system/kaseki-api.service
sudo systemctl daemon-reload
```

---

## Publishing & Release Workflows

### npm Package Publishing

The package is published to npm registry via GitHub Actions:

**Automated Flow (Recommended)**

1. Run the **Release** workflow (`.github/workflows/release.yml`) manually or via push
   - Creates semantic version tags via `semantic-release`
   - Generates GitHub release notes
2. **Publish NPM** workflow (`.github/workflows/publish-npm.yml`) runs automatically
   - Triggered when Release completes successfully
   - Builds package, publishes to npm, verifies on registry

**Manual Publishing (Recovery Scenario)**

If the automatic publish fails (e.g., transient network issue) but Release succeeded:

1. Open GitHub Actions → "Publish NPM" workflow
2. Click "Run workflow" button
3. **Tags input** (optional):
   - Leave empty to auto-detect from latest git tag (default)
   - Provide comma-separated tags to override (e.g., `1.2.3,latest`)
4. Click "Run workflow"
5. Monitor the run in the Actions tab
6. Verify on npm registry: `npm view @cyanautomation/kaseki-agent@<version>`

**Troubleshooting: 404 Not Found on npm publish**

If you get `404 Not Found - PUT https://registry.npmjs.org/@cyanautomation%2fkaseki-agent`:

This means your npm account/organization **isn't configured for OIDC trusted publishing**. The workflow uses GitHub Actions OIDC tokens (no hardcoded secrets), but npm needs to be configured to accept them.

**Setup OIDC on npm (one-time):**

1. Go to [npm settings → Access](https://npmjs.com/settings/cyanautomation/access)
2. Scroll to "GitHub Actions" section
3. Click "Authorize GitHub Actions" or "Configure"
4. Select your repository (CyanAutomation/kaseki-agent)
5. Grant npm publish permissions
6. Confirm authorization

**After setup, retry:**

```bash
# GitHub Actions → Publish NPM → Run workflow (leave tags empty or provide explicit version)
```

If OIDC still doesn't work, see [npm OIDC docs](https://docs.npmjs.com/cli/using-npm/configure-npm/configuring-your-npm-client-with-github-actions) or contact npm support.

**Note:** You only need to set this up once. After OIDC is enabled, all future publishes (automatic via Release workflow or manual) will work without additional configuration.

**Option A: Retry with new prerelease version** (recommended for testing)

1. Create a new git tag: `git tag v1.4.2-retry.1 && git push origin v1.4.2-retry.1`
2. Run Publish NPM workflow
3. Leave tags input empty (will auto-detect new version)
4. Or explicitly provide: `1.4.2-retry.1`

**Option B: Manual version override** (for recovery with explicit version)

1. Run Publish NPM workflow manually
2. In the tags input, provide the **exact new version**: `1.4.2`
3. Workflow will update package.json and publish the new version

**Manual Publishing with Custom Version (Testing)**

For one-off test publishes (alpha/beta/rc tags):

1. Create a git tag: `git tag v1.2.3-alpha.1 && git push origin v1.2.3-alpha.1`
2. Run Publish NPM workflow manually
3. Provide custom tags: `1.2.3-alpha.1` (or leave empty to auto-detect)

**Checking Published Versions**

```bash
# View current npm package info
npm view @cyanautomation/kaseki-agent

# Check specific version
npm view @cyanautomation/kaseki-agent@1.2.3

# View publication history
npm view @cyanautomation/kaseki-agent versions | tail -20

# Check if a version already exists before trying to publish
npm view @cyanautomation/kaseki-agent@1.4.1 && echo "Version already published" || echo "Version not found"
```

---

## Troubleshooting

### Permission Denied Errors Writing to `/results/`

**Symptom:**

```
tee: /results/pi-stderr.log: Permission denied
/usr/local/bin/kaseki-agent: line 436: /results/git.status: Permission denied
```

**Root Cause:**
The container runs as UID 1000, but the host `/agents` directory is owned by root (or another user) with permissions that don't allow UID 1000 to write.

**Quick Fix:**

```bash
# On the host, make /agents writable for all users (including container UID 1000)
sudo mkdir -p /agents
sudo chmod 777 /agents

# Verify
ls -ld /agents  # Should show: drwxrwxrwx ... /agents
```

**Better Fix (if you control the host user):**

```bash
# Create /agents owned by the container user
sudo mkdir -p /agents
sudo chown 1000:1000 /agents
sudo chmod 755 /agents
```

**After Fixing:**

1. Restart docker-compose: `docker-compose down && docker-compose up -d`
2. Verify container can write: `docker-compose logs kaseki-api | grep KASEKI_RESULTS_DIR`
3. Retry your kaseki-agent run

### Startup Logs Show "Failed to create KASEKI_RESULTS_DIR"

**Check:**

```bash
docker-compose logs kaseki-api | grep "Failed to create"
```

**Verify host directory:**

```bash
# Ensure /agents exists and is writable by UID 1000
ls -ld /agents
touch /agents/test-write  # Should succeed
rm /agents/test-write
```

**If touch fails:**

- Run: `sudo chmod 777 /agents`
- Or: `sudo chown 1000:1000 /agents && sudo chmod 755 /agents`

### Container Exits with Code 1

**Check logs:**

```bash
docker-compose logs kaseki-api --tail 50
```

**Common causes:**

1. `/agents` directory doesn't exist or isn't writable (see "Permission Denied" section above)
2. `KASEKI_RESULTS_DIR` points to invalid path
3. Docker socket mount not available: verify `-v /var/run/docker.sock:/var/run/docker.sock`

**Fix:**

```bash
# Ensure /agents exists and is writable
sudo mkdir -p /agents && sudo chmod 777 /agents

# Restart service
docker-compose restart kaseki-api

# View logs
docker-compose logs -f kaseki-api
```

### Runs Fail with "Cannot write to workspace"

**Symptom:**
Worker containers fail to write to `/agents/kaseki-runs/` or `/agents/kaseki-results/`

**Cause:**
Same as above — `/agents` directory permissions

**Fix:**
See "Permission Denied Errors" section above.

### Docker Socket Permission Denied

**Symptom:**

```
permission denied while trying to connect to Docker daemon
Error response from daemon: user does not have permissions to use Docker
```

**Cause:**
Container UID 1000 doesn't have access to `/var/run/docker.sock`

**Fix:**

```bash
# Get the gid of the docker group on the host
stat -c '%g' /var/run/docker.sock  # Returns e.g., 985

# Set DOCKER_GID environment variable
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)

# Restart docker-compose with the GID
docker-compose down && docker-compose up -d
```

The docker-compose.yml should have:

```yaml
group_add:
  - "${DOCKER_GID:-999}"
```

### Volume Mount Not Available in Container

**Symptom:**

```
Error: ENOENT: no such file or directory, mkdir '/agents/kaseki-results'
```

**Verify volume mount:**

```bash
docker-compose ps  # Check if kaseki-api is running

docker inspect kaseki-api | grep -A 5 Mounts
# Should show: /agents -> /agents
```

**Fix:**

1. Ensure `/agents` exists on host: `mkdir -p /agents && chmod 777 /agents`
2. Check docker-compose.yml has: `- /agents:/agents:rw`
3. Restart: `docker-compose down && docker-compose up -d`

---

## Next Steps

1. **Choose your deployment path** — Docker Compose (recommended) or Node.js
2. **Configure for your network** — Update firewall rules, reverse proxy settings
3. **Set up monitoring** — Add health checks, alerts
4. **Test integration** — Use TypeScript client library to submit test runs
5. **Deploy kaseki-agent** — Ensure Docker base image and OpenRouter credentials are configured

## Runtime Verification

Use these checks after deployment:

```bash
# Check whether systemd is launching Docker or host Node
systemctl cat kaseki-api | sed -n "1,220p"

# Docker path: verify container runtime Node major
docker exec kaseki-api node -v

# Host-Node path: verify service user runtime (example for nobody)
sudo -u nobody /usr/bin/node -v
```

The service startup precheck logs detected Node version and exits with a clear error if the major version is less than 24.
