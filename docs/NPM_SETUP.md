# NPM Package Setup Guide

This guide covers installation and usage of `@cyanautomation/kaseki-agent` as an npm package.

## Installation

### Global Install (Recommended)

```bash
npm install -g @cyanautomation/kaseki-agent
```

Provides the `kaseki-agent` command globally. After installation, run:

```bash
kaseki-agent setup
```

### Local Project Install

```bash
npm install @cyanautomation/kaseki-agent
```

Use with `npx`:

```bash
npx kaseki-agent setup
npx kaseki-agent run <repo> <ref>
```

### Requirements

- **Node.js v24 or higher**
- **Docker** (for running agent containers)
- **Linux or macOS** (headless Linux recommended)
- **Internet access** (for OpenRouter API)

### Verify Installation

```bash
kaseki-agent doctor
```

Should output:
```
✓ Docker daemon running
✓ Node.js v24.x available
✓ npm available
✓ git available
✓ API key configured
✓ Disk space: XXX GB available
```

---

## First-Time Setup

### 1. Get API Key

Sign up for [OpenRouter](https://openrouter.ai/) and create an API key.

### 2. Run Setup Wizard

```bash
kaseki-agent setup
```

This interactive wizard will:
- Validate your environment
- Prompt for OpenRouter API key
- Save configuration (locally or globally)
- Run health checks

### 3. Test with `doctor`

```bash
kaseki-agent doctor
```

All checks should pass.

---

## Basic Usage

### Run Agent on a Repository

```bash
kaseki-agent run https://github.com/your-org/your-repo main
```

This will:
1. Create instance `kaseki-1` (or next available number)
2. Clone repository at specified branch
3. Run Pi agent in Docker container
4. Collect results
5. Display summary

### View Results

```bash
# List all instances
kaseki-agent list

# View specific instance
kaseki-agent report kaseki-1
```

---

## Configuration

### Project-Level Configuration

Create `kaseki-agent.json` in your project:

```json
{
  "repo": {
    "url": "https://github.com/your-org/your-repo",
    "ref": "main"
  },
  "agent": {
    "model": "openrouter/free",
    "timeout_seconds": 1200,
    "provider": "openrouter"
  },
  "validation": {
    "allowlist": ["src/lib/", "tests/"],
    "max_diff_bytes": 200000,
    "commands": ["npm run check", "npm run test"]
  }
}
```

Then run without args:

```bash
kaseki-agent run
```

### User-Level Configuration

Set global defaults:

```bash
kaseki-agent config set agent.timeout_seconds 1800 --global
kaseki-agent config set docker.auto_pull true --global
```

View global config:

```bash
kaseki-agent config show --global
```

### Environment Variables

Override configuration via environment:

```bash
export KASEKI_MODEL=openrouter/free
export KASEKI_AGENT_TIMEOUT_SECONDS=1200
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key

kaseki-agent run <repo> <ref>
```

**Common variables:**

- `KASEKI_ROOT` — Results/runs directory (default: /agents)
- `KASEKI_MODEL` — AI model string
- `KASEKI_AGENT_TIMEOUT_SECONDS` — Timeout for agent
- `KASEKI_VALIDATION_COMMANDS` — Validation commands (semicolon-separated)
- `KASEKI_CHANGED_FILES_ALLOWLIST` — File patterns to allow (space-separated)
- `OPENROUTER_API_KEY_FILE` — Path to API key file

---

## Advanced Usage

### Custom Task Prompts

```bash
kaseki-agent run https://github.com/your-org/your-repo main \
  "Fix all TypeScript compilation errors in src/"
```

The task prompt is passed to the Pi agent for context-specific instructions.

### Filtering Instances

```bash
# Show only completed
kaseki-agent list --status completed

# Show only failed
kaseki-agent list --status failed
```

### Viewing Detailed Reports

```bash
kaseki-agent report kaseki-1
```

Shows:
- Instance metadata
- Execution stages and timing
- Exit code and status
- Detailed summary

### Secret Management

Store sensitive credentials securely:

```bash
# Store API key
kaseki-agent secrets set openrouter-api-key sk-or-...

# List stored secrets
kaseki-agent secrets list

# Retrieve (hidden)
kaseki-agent secrets get openrouter-api-key

# Show value (explicit)
kaseki-agent secrets get openrouter-api-key --show

# Delete
kaseki-agent secrets delete openrouter-api-key
```

**Storage:**
- Linux: `pass` (password-store) keyring
- Headless: `~/.kaseki/secrets/` (0600 permissions)

---

## Using Docker Image

If you don't want to install Node.js:

### Setup

```bash
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup
```

### Run Agent

```bash
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run https://github.com/your-org/your-repo main
```

### Start API Service

```bash
docker run -d \
  -p 8080:8080 \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  serve --port 8080
```

---

## REST API Service

For distributed/async execution:

### Start Service

```bash
kaseki-agent serve --port 8080
```

Or with custom port:

```bash
kaseki-agent serve --port 9000
```

### API Endpoints

**Health Check**
```bash
curl http://localhost:8080/health
```

**List Instances**
```bash
curl http://localhost:8080/api/runs
```

**Start Run**
```bash
curl -X POST http://localhost:8080/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "https://github.com/your-org/your-repo",
    "ref": "main",
    "task": "Fix TypeScript errors"
  }'
```

**Get Instance Status**
```bash
curl http://localhost:8080/api/runs/kaseki-1
```

**Stream Logs**
```bash
curl http://localhost:8080/api/runs/kaseki-1/logs
```

---

## Troubleshooting

### Issue: Doctor fails

```bash
kaseki-agent doctor --fix
```

This attempts auto-remediation:
- Pulls Docker image
- Provides install instructions

### Issue: Agent times out

Increase timeout:

```bash
kaseki-agent config set agent.timeout_seconds 1800 --global
```

Or for single run:

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=1800 kaseki-agent run <repo> <ref>
```

### Issue: Docker permission denied

```bash
# Add current user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### Issue: API key not found

```bash
# Check stored secrets
kaseki-agent secrets list

# Re-setup if needed
kaseki-agent setup

# Or manually set
kaseki-agent secrets set openrouter-api-key sk-or-...
```

### Issue: Out of disk space

```bash
# Check available space
kaseki-agent doctor

# Clean old instances (optional)
rm -rf /agents/kaseki-results/kaseki-*
```

---

## Configuration Precedence

Settings are loaded in this order (first wins):

1. **CLI flags** (`--flag=value`)
2. **kaseki-agent.json** (project directory)
3. **~/.kaseki/config.json** (home directory)
4. **Environment variables** (`KASEKI_*`, `OPENROUTER_*`)
5. **Built-in defaults**

Example:
```bash
# Uses CLI flag (highest precedence)
KASEKI_AGENT_TIMEOUT_SECONDS=900 kaseki-agent run <repo> <ref> --model=custom-model
```

---

## Example Workflow

```bash
# 1. One-time setup
kaseki-agent setup

# 2. Verify environment
kaseki-agent doctor

# 3. Create project config
cat > kaseki-agent.json << 'EOF'
{
  "agent": {
    "timeout_seconds": 1200
  },
  "validation": {
    "allowlist": ["src/", "tests/"]
  }
}
EOF

# 4. Run agent
kaseki-agent run https://github.com/your-org/your-repo main

# 5. Check results
kaseki-agent list
kaseki-agent report kaseki-1

# 6. Start API service for continuous use
kaseki-agent serve --port 8080
```

---

## Documentation

- [README.md](../README.md) — Overview and quick start
- [docs/SETUP_GUIDE.md](SETUP_GUIDE.md) — Detailed setup walkthrough
- [docs/CLI.md](CLI.md) — CLI monitoring and debugging
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment
- [docs/QUALITY_GATES.md](QUALITY_GATES.md) — Quality gate configuration

---

## Support

For issues:

1. Run `kaseki-agent doctor` to check environment
2. Check logs in `/agents/kaseki-results/kaseki-N/`
3. Enable verbose output: `kaseki-agent --verbose run <repo> <ref>`
4. Open issue on [GitHub](https://github.com/CyanAutomation/kaseki-agent)
