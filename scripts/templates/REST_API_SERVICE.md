# REST API Service Setup

For running kaseki-agent as a long-running HTTP API service for async, distributed execution.

**Complexity**: High | **Time**: 15-30 minutes

---

## Architecture

```
External Client
    ↓ (HTTP POST /api/run)
REST API Service (port 8080)
    ↓
Docker Daemon
    ↓
Kaseki Agent Container (kaseki-1, kaseki-2, ...)
```

The API service acts as a broker, accepting HTTP requests and managing kaseki instances on behalf of clients.

---

## Comparison: API Service vs. Direct CLI

| Aspect | Direct CLI | REST API Service |
|--------|-----------|------------------|
| **Deployment** | Single host or SSH-based | Long-running service |
| **Execution** | Synchronous (blocking) | Asynchronous (non-blocking) |
| **Concurrent Runs** | One at a time | Multiple (configurable) |
| **Access Method** | Shell commands | HTTP REST API |
| **Best For** | Development, simple tasks | Production, distributed systems |

---

## Prerequisites

- Docker (required)
- Docker Compose (recommended) or Node.js ≥24.x (fallback)
- OpenRouter API key
- Port 8080 available (or configure different port)

---

## Step 1: Clone and Prepare

```bash
cd /agents/kaseki-template
# (or clone if not already done)
git clone https://github.com/CyanAutomation/kaseki-agent.git /agents/kaseki-template
cd /agents/kaseki-template
```

## Step 2: Set API Keys

### Option A: Single API Key (Simple)

```bash
export KASEKI_API_KEYS=sk-your-secret-key-here
```

### Option B: Multiple API Keys (Production)

```bash
export KASEKI_API_KEYS="sk-key1,sk-key2,sk-key3"
```

Or store in a file:

```bash
# Create file with one key per line
cat > ~/.kaseki/api-keys.txt << 'EOF'
sk-key1
sk-key2
sk-key3
EOF

# Set environment to point to file
export KASEKI_API_KEYS_FILE=~/.kaseki/api-keys.txt
```

## Step 3: Configure OpenRouter API Key

The service needs your OpenRouter key to invoke the Pi agent:

```bash
# Option 1: Environment variable (not recommended for production)
export OPENROUTER_API_KEY=sk-or-v1-your-key

# Option 2: File (recommended)
mkdir -p ~/.kaseki/secrets
read -sp 'Enter OpenRouter API key: ' OPENROUTER_KEY
echo "$OPENROUTER_KEY" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key
```

---

## Step 4: Launch the Service

### Option A: Docker Compose (Recommended)

```bash
# Navigate to repo root
cd /agents/kaseki-template

# Set configuration
export KASEKI_API_KEYS=sk-your-secret-key-here
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key

# Get Docker socket GID (required for container to launch kaseki instances)
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"

# Start services
docker-compose up -d

# View logs
docker-compose logs -f kaseki-api
```

### Option B: systemd Service

```bash
# Copy service file to systemd directory
sudo cp scripts/kaseki-api.service /etc/systemd/system/

# Create environment file
sudo tee /etc/kaseki.env > /dev/null << 'EOF'
KASEKI_API_KEYS=sk-your-secret-key-here
OPENROUTER_API_KEY_FILE=/home/pi/secrets/openrouter_api_key
KASEKI_API_PORT=8080
KASEKI_RESULTS_DIR=/agents/kaseki-results
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable kaseki-api
sudo systemctl start kaseki-api

# Check status
sudo systemctl status kaseki-api

# View logs
sudo journalctl -u kaseki-api -f
```

### Option C: Direct Node.js (Fallback)

```bash
# Install dependencies
npm ci --omit=dev

# Build TypeScript
npm run build

# Start API service
KASEKI_API_KEYS=sk-your-secret-key-here \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  npm run kaseki-api

# Service runs on http://localhost:8080
```

---

## Step 5: Verify the Service

### Health Check

```bash
# Without authentication (preflight endpoint)
curl http://localhost:8080/api/health

# Response: { "status": "ok" }
```

### Authenticated Preflight Check

```bash
# With API key authentication
curl -H "Authorization: Bearer sk-your-secret-key-here" \
  http://localhost:8080/api/preflight

# Response includes Docker readiness, image status, etc.
```

---

## Step 6: Trigger Your First Run

### Via curl

```bash
curl -X POST http://localhost:8080/api/run \
  -H "Authorization: Bearer sk-your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/your-org/your-repo",
    "git_ref": "main",
    "task_prompt": "Fix the bug in parser.ts"
  }'
```

Response:

```json
{
  "instance_name": "kaseki-1",
  "status": "queued",
  "estimated_start_time": "2026-05-07T10:15:32Z"
}
```

### Via Node.js Client

```typescript
import { KasekirClient } from './dist/kaseki-api-client.js';

const client = new KasekirClient('http://localhost:8080', 'sk-your-secret-key-here');

const result = await client.run({
  repo_url: 'https://github.com/your-org/your-repo',
  git_ref: 'main',
  task_prompt: 'Fix the bug in parser.ts',
});

console.log('Started:', result.instance_name);
```

---

## Step 7: Monitor Runs

### Get Run Status

```bash
curl -H "Authorization: Bearer sk-your-secret-key-here" \
  http://localhost:8080/api/status/kaseki-1
```

Response:

```json
{
  "instance_name": "kaseki-1",
  "status": "running",
  "elapsed_seconds": 42,
  "timeout_seconds": 1200,
  "stage": "pi-agent",
  "progress": "Analyzing code..."
}
```

### List All Runs

```bash
curl -H "Authorization: Bearer sk-your-secret-key-here" \
  http://localhost:8080/api/runs
```

### Get Results (After Completion)

```bash
curl -H "Authorization: Bearer sk-your-secret-key-here" \
  http://localhost:8080/api/results/kaseki-1
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `KASEKI_API_KEYS` | — | Required: comma-separated API keys |
| `KASEKI_API_KEYS_FILE` | — | Alternative: file with newline-separated keys |
| `KASEKI_API_PORT` | `8080` | HTTP listen port |
| `KASEKI_API_LOG_LEVEL` | `info` | Log level: debug, info, warn, error |
| `KASEKI_API_IMAGE` | `docker.io/cyanautomation/kaseki-agent:latest` | Docker image to use |
| `KASEKI_API_MAX_CONCURRENT_RUNS` | `3` | Max parallel instances |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `1200` | Per-run timeout (20 min) |
| `KASEKI_MAX_DIFF_BYTES` | `200000` | Max diff size (200 KB) |
| `OPENROUTER_API_KEY_FILE` | — | Required: path to OpenRouter key file |
| `KASEKI_RESULTS_DIR` | `/agents/kaseki-results` | Output directory |

### Docker Compose Override

To customize Docker Compose, create `docker-compose.override.yml`:

```yaml
version: '3.8'

services:
  kaseki-api:
    environment:
      KASEKI_API_MAX_CONCURRENT_RUNS: 5
      KASEKI_AGENT_TIMEOUT_SECONDS: 3600
    ports:
      - "9000:8080"  # Listen on port 9000 instead
```

---

## Scaling & Production Setup

### Load Balancing (nginx)

```nginx
upstream kaseki_api {
  server localhost:8080;
  server host2:8080;
  server host3:8080;
}

server {
  listen 80;
  server_name kaseki.example.com;

  location /api/ {
    proxy_pass http://kaseki_api;
    proxy_set_header Authorization $http_authorization;
  }
}
```

### Multiple Instances on Different Ports

```bash
# Instance 1
export KASEKI_API_PORT=8080
docker-compose -f docker-compose.yml -p kaseki-1 up -d

# Instance 2
export KASEKI_API_PORT=8081
docker-compose -f docker-compose.yml -p kaseki-2 up -d

# Instance 3
export KASEKI_API_PORT=8082
docker-compose -f docker-compose.yml -p kaseki-3 up -d
```

### Monitoring & Logging

```bash
# Real-time logs
docker-compose logs -f kaseki-api

# JSON logs for parsing
docker-compose logs --format='{{json .}}' kaseki-api | jq .

# Log rotation (optional)
sudo cp ops/logrotate/kaseki-api /etc/logrotate.d/
```

---

## Troubleshooting

### "Connection refused"

Service is not running:

```bash
# Check Docker Compose
docker-compose ps

# Check systemd
sudo systemctl status kaseki-api

# Check Node.js process
ps aux | grep kaseki-api
```

### "Unauthorized" (401 error)

Invalid or missing API key:

```bash
# Verify key is set
echo $KASEKI_API_KEYS

# Check curl header
curl -v -H "Authorization: Bearer sk-your-secret-key" \
  http://localhost:8080/api/health
```

### "Max concurrent runs exceeded"

All worker slots are in use. Either:
1. Wait for a run to complete
2. Increase `KASEKI_API_MAX_CONCURRENT_RUNS`

```bash
export KASEKI_API_MAX_CONCURRENT_RUNS=10
docker-compose up -d  # Restart with new limit
```

### Results Directory Filling Up

Clean up old runs:

```bash
./scripts/cleanup-kaseki.sh --keep 10
```

Or configure automatic retention:

```bash
# In crontab
0 2 * * * /agents/kaseki-template/scripts/cleanup-kaseki.sh --keep 20
```

---

## Integration Examples

### Python Client

```python
import requests

API_URL = "http://localhost:8080"
API_KEY = "sk-your-secret-key-here"

def run_kaseki(repo_url, git_ref, task_prompt):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    
    data = {
        "repo_url": repo_url,
        "git_ref": git_ref,
        "task_prompt": task_prompt,
    }
    
    response = requests.post(f"{API_URL}/api/run", headers=headers, json=data)
    return response.json()

result = run_kaseki("https://github.com/org/repo", "main", "Fix bug")
print(f"Started: {result['instance_name']}")
```

### Bash Wrapper

```bash
#!/bin/bash

API_URL="http://localhost:8080"
API_KEY="sk-your-secret-key-here"
REPO_URL="$1"
GIT_REF="$2"
TASK_PROMPT="$3"

RESPONSE=$(curl -s -X POST "$API_URL/api/run" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"repo_url\": \"$REPO_URL\",
    \"git_ref\": \"$GIT_REF\",
    \"task_prompt\": \"$TASK_PROMPT\"
  }")

INSTANCE=$(echo "$RESPONSE" | jq -r '.instance_name')
echo "Started: $INSTANCE"

# Poll for completion
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/api/status/$INSTANCE" | jq -r '.status')
  
  [ "$STATUS" = "completed" ] && break
  sleep 5
done

echo "Completed!"
```

---

## Next Steps

- Set up SSL/TLS for production: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)
- Integrate with orchestrators: See integration examples
- Monitor performance: `kaseki-cli.js` and dashboard
- Scale horizontally: Deploy multiple API instances behind load balancer
