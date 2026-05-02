# Kaseki Agent API Service - Deployment Guide

## Overview

The Kaseki API Service allows remote execution and monitoring of kaseki-agent runs via HTTP REST API. This guide covers deployment options.

## Prerequisites

- Node.js ≥ 22.22.2 (when running as Node process)
- Docker (when running in container)
- `/agents/kaseki-results` directory must exist or be creatable
- OpenRouter API key for Pi agent invocation (inherited from kaseki-agent)

## Deployment Options

### Option 1: Docker Compose (Recommended)

Simplest deployment using docker-compose:

```bash
# Navigate to kaseki-agent repository
cd /agents/kaseki-template

# Set API key
export KASEKI_API_KEYS=sk-your-secret-key-here

# Start services
docker-compose up -d

# View logs
docker-compose logs -f kaseki-api

# Stop services
docker-compose down
```

**Configuration** (via environment variables):

```bash
# Core settings
KASEKI_API_KEYS=sk-key1,sk-key2            # Required: comma-separated API keys
KASEKI_API_PORT=8080                        # API listen port (default: 8080)
KASEKI_API_LOG_LEVEL=info                  # Log level: debug/info/warn/error

# Performance
KASEKI_API_MAX_CONCURRENT_RUNS=3           # Max concurrent jobs (default: 3)
KASEKI_AGENT_TIMEOUT_SECONDS=1200          # Agent timeout in seconds (default: 20 min)
KASEKI_MAX_DIFF_BYTES=200000               # Max diff size (default: 200 KB)

# Paths (usually inherited from docker-compose)
KASEKI_RESULTS_DIR=/agents/kaseki-results
KASEKI_API_LOG_DIR=/var/log/kaseki-api
```

### Option 2: systemd Service (Host Process)

Deploy as a systemd service on the host:

```bash
# 1. Build the project
cd /agents/kaseki-template
npm install
npm run build

# 2. Install systemd service
sudo cp scripts/kaseki-api.service /etc/systemd/system/
sudo systemctl daemon-reload

# 3. Create environment file
sudo mkdir -p /etc/kaseki-api
sudo tee /etc/kaseki-api/kaseki-api.env << EOF
KASEKI_API_KEYS=sk-your-secret-key
KASEKI_API_PORT=8080
KASEKI_API_LOG_LEVEL=info
KASEKI_RESULTS_DIR=/agents/kaseki-results
EOF

# 4. Set appropriate permissions
sudo chown root:root /etc/kaseki-api/kaseki-api.env
sudo chmod 600 /etc/kaseki-api/kaseki-api.env

# 5. Start service
sudo systemctl enable kaseki-api
sudo systemctl start kaseki-api

# 6. Check status
sudo systemctl status kaseki-api
sudo journalctl -u kaseki-api -f
```

### Option 3: Manual Docker Container

Run the API container directly:

```bash
docker run --rm \
  --name kaseki-api \
  -p 8080:8080 \
  -v /agents/kaseki-results:/agents/kaseki-results:rw \
  -v /var/log/kaseki-api:/var/log/kaseki-api:rw \
  -e KASEKI_API_KEYS=sk-your-key \
  -e KASEKI_API_PORT=8080 \
  -e KASEKI_AGENT_TIMEOUT_SECONDS=1200 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --read-only \
  docker.io/cyanautomation/kaseki-agent:latest \
  node dist/kaseki-api-service.js
```

### Option 4: Node.js Process (Development)

Quick development setup:

```bash
cd /agents/kaseki-template

# Install dependencies
npm install

# Start API
KASEKI_API_KEYS=sk-dev-key npm run kaseki-api
```

## Security Best Practices

1. **API Key Management**
   - Store keys in `/etc/kaseki-api/kaseki-api.env` with mode `0600`
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
   - API runs as non-root user (UID 10001)

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

## Health Checks

All deployments should monitor health:

```bash
curl http://localhost:8080/health
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

## Monitoring

### Docker Compose

```bash
# View logs
docker-compose logs -f kaseki-api

# Check resource usage
docker stats kaseki-api
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

## Log Rotation

For the host deployment option, configure logrotate:

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

## Troubleshooting

### API won't start

Check required environment variables:

```bash
# Must be set
echo $KASEKI_API_KEYS  # Should not be empty
ls -la /agents/kaseki-results  # Directory must exist
```

### "Pod is crashing"

View logs for detailed error:

```bash
# Docker Compose
docker-compose logs kaseki-api | head -50

# systemd
journalctl -u kaseki-api -n 50
```

Common issues:
- Missing `/agents/kaseki-results` directory
- Invalid port (not between 1-65535)
- API key environment variable not set

### Slow performance

Check queue status:

```bash
curl -H "Authorization: Bearer sk-key" http://localhost:8080/api/runs

# Monitor running jobs
watch -n2 'curl -s -H "Authorization: Bearer sk-key" http://localhost:8080/health | jq ".queue"'
```

Increase `KASEKI_API_MAX_CONCURRENT_RUNS` if jobs are queueing unnecessarily.

## Cleanup

### Stop Docker Compose

```bash
cd /agents/kaseki-template
docker-compose down
docker volume prune  # Optional: delete unused volumes
```

### Disable systemd Service

```bash
sudo systemctl stop kaseki-api
sudo systemctl disable kaseki-api
sudo rm /etc/systemd/system/kaseki-api.service
sudo systemctl daemon-reload
```

## Next Steps

1. **Configure for your network** — Update firewall rules, reverse proxy settings
2. **Set up monitoring** — Add health checks, alerts
3. **Test integration** — Use TypeScript client library to submit test runs
4. **Deploy kaseki-agent** — Ensure Docker base image and OpenRouter credentials are configured
