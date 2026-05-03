# Kaseki Agent API Service - Deployment Guide

## Overview

The Kaseki API Service allows remote execution and monitoring of kaseki-agent runs via HTTP REST API.

**Authoritative deployment mode: Docker container runtime** (docker-compose, systemd+docker, or manual `docker run`). Host Node.js process mode is fallback/dev-only and is not the production reference path.

## Prerequisites

- Docker + Docker Compose (for docker-compose deployment)
- Node.js ≥ 24.x (for Node.js fallback deployment)
- `/agents/kaseki-results` directory must exist or be creatable
- OpenRouter API key for Pi agent invocation (inherited from kaseki-agent)

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

# Install dependencies
npm install

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
npm install
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

### Prometheus Metrics (Future)

Metrics endpoint coming in Phase 8:

```bash
curl http://localhost:8080/metrics
```

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
