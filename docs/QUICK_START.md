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
- ✓ Collect provider credentials (OpenRouter by default, or LLM Gateway when explicitly selected)
- ✓ Save everything securely

**First time?** The wizard will guide you through each step.

---

## Step 2: Add Your Secrets

When prompted, provide:

1. **LLM Gateway settings** (required for the default provider)
   - Kaseki defaults to `KASEKI_PROVIDER=gateway` so the LLM Gateway is the primary provider.
   - Provide `LLM_GATEWAY_URL` and `LLM_GATEWAY_API_KEY` or `LLM_GATEWAY_API_KEY_FILE`.
   - Examples: `https://llmgateway.local.xyz/v1/responses`, `https://api.openai.com/v1/chat/completions`, or `http://localhost:11434/v1/chat/completions`.
   - Gateway preflight validates URL/key configuration, worker secret mounting, and Pi provider registration before agent phases run.

2. **OpenRouter API Key** (fallback / secondary provider)
   - Set `KASEKI_PROVIDER=openrouter` to use OpenRouter instead of the gateway.
   - Set `OPENROUTER_API_KEY` or provide the `OPENROUTER_API_KEY_FILE` secret.

3. **GitHub App Credentials** (optional)
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

## Host Setup (Phase 1-5)

**New in v2.5**: Comprehensive host setup validation and troubleshooting tools.

### Validate Your Setup

```bash
# Check if host is ready for Kaseki (no changes)
kaseki-agent host setup --check-only
```

This runs through 8 validation stages and outputs structured JSON:

```json
{
  "status": "ok",
  "checks": {
    "checkout_freshness_probe": "ok",
    "template_ready": "ok"
  },
  "performance": {
    "stage_1_ms": 45,
    "probe_duration_ms": 2150
  }
}
```

### Fix Setup Issues

If validation reports failures:

```bash
# Fix all identified issues
sudo kaseki-agent host setup --fix

# Verify fixes took effect
kaseki-agent host setup --check-only
```

### Understanding Validation Stages (Phase 4-5)

- **Stage 1**: Host prerequisites (git, utilities)
- **Stage 2**: Create/fix /agents directories  
- **Stage 3-4**: Configure secrets & checkout (run in parallel - Phase 4)
- **Stage 5**: Bootstrap checkout (conditional on Stage 6)
- **Stage 6**: Checkout freshness probe (parallel privilege tools - Phase 4)
- **Stage 7**: Verify fixes applied
- **Stage 8**: Template verification
- **Stage 9**: API container recreation (optional)

**Phase 4 Optimizations**:

- Stages 3 & 4 run in parallel (~250ms combined vs. ~500ms sequential)
- Privilege tools tested in parallel (~2s vs. ~6s)

**Phase 5 Documentation**:

- [HOST_SETUP_STAGES.md](HOST_SETUP_STAGES.md) — Detailed stage information & execution flow
- [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) — 11+ failure scenarios with diagnosis & fixes
- [HOST_SETUP_API_REFERENCE.md](HOST_SETUP_API_REFERENCE.md) — JSON schemas, function reference & integration examples

---

## Troubleshooting

### Permission Errors on Startup?

```bash
./scripts/setup-secrets.sh --fix
docker-compose restart kaseki-api

# Or use new host setup tool
sudo kaseki-agent host setup --fix
```

### Secrets Not Found?

Check where they're stored:

```bash
ls -la /home/pi/secrets/                    # Host Docker source
docker exec kaseki-api ls -la /run/secrets/kaseki/  # Container mount
ls -la ~/.kaseki/secrets/                   # Local

# Or diagnose with host setup
kaseki-agent host setup --check-only | grep -A2 "Stage 3"
```

### API Key Not Working?

Verify the files are readable:

```bash
docker exec kaseki-api test -r /run/secrets/kaseki/llm_gateway_api_key
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_id
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_client_id
docker exec kaseki-api test -r /run/secrets/kaseki/github_app_private_key
cat ~/.kaseki/secrets.json # Local only (contains llm_gateway_api_key)
```

If it looks correct, try running the API service again:

```bash
docker-compose up kaseki-api
```

### Host Setup or Permission Issues?

See [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) for detailed diagnosis of 11+ common failure scenarios.

---

## Single-Run Execution

**Best for**: One-off tasks, CI/CD scripts, experiments  

```bash
export LLM_GATEWAY_URL=https://llmgateway.local.xyz/v1/responses
export LLM_GATEWAY_API_KEY=your-api-key-here
./run-kaseki.sh https://github.com/user/repo main
```

Check results: `ls -la /agents/kaseki-results/`

---

## Goal-Setting Agent (Pre-Scouting Prompt Enhancement)

**New in v2.7**: The goal-setting agent runs **before scouting** to upgrade your task prompt into a mature, specific goal.

### What's Goal-Setting?

The goal-setting agent:

1. Reads your raw task prompt
2. Analyzes for clarity, measurability, and scope
3. Creates an **upgraded goal** with clear success criteria
4. Returns a refined prompt that improves downstream agent performance

**Example**:

- **Your prompt**: "Fix the parser"
- **Upgraded goal**: "Fix parseRole() to safely handle null/undefined values in FriendlyName field. Add test coverage for 5 edge cases. All tests must pass."

### Enable Goal-Setting

Goal-setting is **enabled by default**. To disable it:

```bash
export KASEKI_GOAL_SETTING=0
./run-kaseki.sh
```

Or via API:

```json
{
  "repoUrl": "https://github.com/user/repo",
  "taskPrompt": "Your task prompt",
  "goalSetting": {
    "enabled": false
  }
}
```

### Fine-Tune Goal-Setting

Use a different model or timeout:

```bash
export KASEKI_GOAL_SETTING_MODEL=gpt-4-turbo
export KASEKI_GOAL_SETTING_TIMEOUT_SECONDS=600
./run-kaseki.sh
```

### Check Goal-Setting Results

After a run:

- `/results/goal-setting.json` — The upgraded goal with reasoning
- `/results/goal-setting-events.jsonl` — Agent activity details

Example output:

```json
{
  "original_prompt": "Fix the parser bug",
  "upgraded_goal": "Fix parseRole() to handle null FriendlyName safely.",
  "key_requirements": ["Handle null values", "Preserve valid inputs"],
  "success_criteria": ["All tests pass", "No TypeErrors"],
  "confidence": "high"
}
```

For detailed guidance, see [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md).

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
export LLM_GATEWAY_URL=https://llmgateway.local.xyz/v1/responses
export LLM_GATEWAY_API_KEY=your-api-key-here
./run-kaseki.sh
```

Or via API request:

```json
{
  "repoUrl": "https://github.com/user/repo",
  "taskPrompt": "Fix the parser bug in src/parser.ts",
  "scouting": {
    "enabled": true,
    "model": "auto",
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

**Host log mirror warning at startup**  

If `KASEKI_LOG_DIR` is not writable, startup prints a warning and continues by default.

- To fail fast instead: `KASEKI_STRICT_HOST_LOGGING=1`
- To keep mirroring enabled: set `KASEKI_LOG_DIR` to a writable host path

---

## Advanced Configuration

All three paths support advanced customization via environment variables:

### Common Customizations

**Restrict files agent can modify**:

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
```

**Use a different AI model** (check your gateway for available models):

```bash
KASEKI_MODEL=gpt-4-turbo
```

**Increase timeout for complex tasks**:

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=3600  # 1 hour
```

**Skip pre-flight validation** (only validate after agent runs):

```bash
KASEKI_PRE_AGENT_VALIDATION=false
```

**Disable TypeScript pre-check** (enabled by default for early error detection):

```bash
KASEKI_TS_PRE_CHECK=0
```

By default, kaseki-agent runs `npm run build` before invoking the agent to catch TypeScript compilation errors early (saves ~15 minutes when export issues occur). This is automatic and transparent; errors are logged to `/results/pre-validation-ts-check.log`.

---

## Baseline Test Failure Comparison

**New in v2.8**: Kaseki automatically compares test results before and after the agent's changes to identify newly-introduced failures.

### What's Baseline Validation?

Baseline validation checks out the `main` branch and runs your validation commands (tests) on the pristine code, then compares against the agent's modified code:

- **Pre-existing failures**: Failures that existed in main (not the agent's fault)
- **Newly-introduced failures**: Tests that passed in main but fail after agent changes ⚠️
- **Fixed failures**: Tests that failed in main but now pass ✅

### Enable Baseline Validation

Baseline validation is **enabled by default**. Just set your validation commands:

```bash
export KASEKI_PRE_AGENT_VALIDATION_COMMANDS="npm run test"
./run-kaseki.sh https://github.com/user/repo main
```

To disable it:

```bash
export KASEKI_BASELINE_VALIDATION_ENABLED=0
```

### View Results

After the run, check:

- **result-summary.md** — Quick summary:

  ```
  - Test failure analysis: completed
    - ⚠️ **Newly introduced failures: 1**
  ```

- **test-baseline-comparison.json** — Full breakdown:

  ```json
  {
    "summary": {
      "total_pre_existing": 2,
      "total_newly_introduced": 1,
      "total_fixed": 0
    },
    "classification": {
      "should validate input": {
        "category": "pre-existing"
      },
      "should handle null": {
        "category": "newly-introduced"
      }
    }
  }
  ```

- **metadata.json** — Quick metrics:

  ```json
  {
    "test_failure_classification_status": "completed",
    "newly_introduced_failures_count": 1
  }
  ```

### Optimize Cache

First run caches the main branch baseline; subsequent runs reuse it (faster):

```bash
# Run 1: ~30-60 sec overhead (baseline checkout + validation)
# Run 2-N: baseline reused from cache (~2 sec overhead)

# Control cache expiration (days):
export KASEKI_BASELINE_CACHE_MAX_AGE_DAYS=14
```

### Use Case: Quality Gate

Fail the run if agent introduces failures:

```bash
./run-kaseki.sh

NEWLY_INTRO=$(jq '.summary.total_newly_introduced' \
  /agents/kaseki-results/kaseki-1/test-baseline-comparison.json)

if [ "$NEWLY_INTRO" -gt 0 ]; then
  echo "❌ Agent introduced $NEWLY_INTRO failures"
  exit 1
fi
```

**For detailed guide**: → See [docs/BASELINE_TEST_COMPARISON.md](../docs/BASELINE_TEST_COMPARISON.md)

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
- [Cost Estimation](../docs/COST_ESTIMATION.md) — Gateway pricing, cost optimization

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
