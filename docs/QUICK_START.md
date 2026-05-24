# Kaseki Agent Quick Start

Get kaseki-agent running in **3 simple steps**. No manual permission setup needed.

---

## Step 1: Run the Setup Wizard

```bash
kaseki-agent init
```

This will:
- ✓ Auto-configure secrets directories with proper permissions
- ✓ Ask which deployment path you want (Docker Compose or single-run)
- ✓ Collect your OpenRouter API key and other credentials
- ✓ Save everything securely

**First time?** The wizard will guide you through each step.

---

## Step 2: Add Your Secrets

When prompted, provide:

1. **OpenRouter API Key** (required)
   - Get one at [openrouter.ai](https://openrouter.ai) → Settings → API Keys
   - Looks like: `sk-or-...`

2. **GitHub App Credentials** (optional)
   - Only needed if you want GitHub-authenticated deployments
   - Provide App ID, Client ID, and Private Key

---

## Step 3: Deploy

### Docker Compose (Recommended)

```bash
docker-compose up -d
```

Monitor startup:
```bash
docker-compose logs -f kaseki-api
```

Verify it's running:
```bash
curl http://localhost:8080/ready
```

### Single-Run Execution

```bash
./run-kaseki.sh https://github.com/your-org/your-repo main
```

---

## What Just Happened?

The setup wizard created:

- **`/home/pi/secrets/`** on the host, mounted read-only at **`/run/secrets/kaseki/`** in Docker, or **`~/.kaseki/secrets/`** for local runs
  - Your API keys and credentials
  - Permissions automatically secured (not world-readable)

- **`.env`** (current directory)
  - Configuration for Docker Compose or local runs
  - Safe to commit to Git (no secrets included)

---

## Troubleshooting

### Permission Errors on Startup?

```bash
./scripts/setup-secrets.sh --fix
docker-compose restart kaseki-api
```

### Secrets Not Found?

Check where they're stored:
```bash
ls -la /home/pi/secrets/                    # Host Docker source
docker exec kaseki-api ls -la /run/secrets/kaseki/  # Container mount
ls -la ~/.kaseki/secrets/                   # Local
```

### API Key Not Working?

Verify the files are readable:
```bash
docker exec kaseki-api test -r /run/secrets/kaseki/openrouter_api_key
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_id
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_client_id
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_private_key
cat ~/.kaseki/secrets/openrouter_api_key # Local only
```

If it looks correct, try running the API service again:
```bash
docker-compose up kaseki-api
```

---

## Single-Run Execution

**Best for**: One-off tasks, CI/CD scripts, experiments  

```bash
export OPENROUTER_API_KEY=sk-or-your-key-here
./run-kaseki.sh https://github.com/user/repo main
```

Check results: `ls -la /agents/kaseki-results/`

---

## Scouting Agent & Allowlist Control

**New in v2.6**: When you enable scouting, the agent automatically analyzes the task and generates allowlist patterns to narrow the scope of the main coding agent.

### What's Scouting?

1. **Research Phase**: Scouting agent (Pi) reads the repository and task prompt (read-only)
   - Identifies relevant files, dependencies, and constraints
   - Generates a task plan and validation strategy
   - Outputs structured research to `scouting.json`

2. **Allowlist Generation**: Scouting recommends which files the main coding agent should modify
   - Generates glob patterns (e.g., `src/parser.ts`, `tests/**`, `src/lib/parser.ts`)
   - Calculates coverage metrics (% of changed files matching patterns)
   - Warns if patterns are too broad (>98%) or too narrow (<30%)

3. **Merge & Apply**: Scouting patterns are merged with any user-provided allowlist, then applied to the main agent
   - Both agent-phase and validation-phase allowlists are controlled
   - Main agent runs with narrowed scope, reducing unwanted changes

### Enable Scouting

Via environment variable:
```bash
export KASEKI_SCOUTING=1
export OPENROUTER_API_KEY=sk-or-your-key
./run-kaseki.sh
```

Or via API request:
```json
{
  "repoUrl": "https://github.com/user/repo",
  "taskPrompt": "Fix the parser bug in src/parser.ts",
  "scouting": {
    "enabled": true,
    "model": "openrouter/free",
    "timeoutSeconds": 300
  }
}
```

### Combine with Manual Allowlist

If you also provide a custom allowlist, both are **merged** (union):

```bash
export KASEKI_SCOUTING=1
export KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
./run-kaseki.sh
```

In this case:
- Scouting recommends: `src/parser.ts src/lexer.ts tests/parser.test.ts`
- You provide: `src/** tests/**`
- **Result**: Main agent can modify any files in `src/` or `tests/` (broadest of both)

### Check Scouting Results

After a run, inspect:
- `/results/scouting.json` — Full research artifact with recommended patterns
- `/results/scouting-report.md` — Coverage metrics and warnings
- `/results/metadata.jsonl` — Log of allowlist merge decisions

Example `scouting.json`:
```json
{
  "task": "Fix parser bug when handling nested expressions",
  "plan": ["Identify parse error", "Update parser logic", "Add test"],
  "suggested_allowlist": {
    "agent_patterns": ["src/lib/parser.ts", "tests/parser.validation.ts"],
    "validation_patterns": ["src/lib/parser.ts", "tests/**"]
  },
  "coverage": {
    "agent_phase_percent": 75,
    "validation_phase_percent": 85,
    "warnings": ["patterns too narrow"]
  }
}
```

---

## Advanced Configuration

For more options (timeouts, validation commands, quality gates, etc.), see:
- [docs/ADVANCED_CONFIG.md](ADVANCED_CONFIG.md) — 60+ environment variables
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment guide
- [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Common issues

---

## Questions?

- **Setup issues?** Check [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Need help?** Open an issue: [github.com/CyanAutomation/kaseki-agent/issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- **More features?** See [docs/ADVANCED_CONFIG.md](ADVANCED_CONFIG.md)

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
- [Troubleshooting](../docs/TROUBLESHOOTING.md) — Error decision tree

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
→ Check: [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md)

**Found a bug?**  
→ Open an issue: <https://github.com/CyanAutomation/kaseki-agent/issues>

**Want to contribute?**  
→ See: [CONTRIBUTING.md](../CONTRIBUTING.md)

---

**Happy coding! 🚀**
