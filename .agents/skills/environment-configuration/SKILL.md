---
name: environment-configuration
description: Complete reference for configuring kaseki-agent via environment variables
tags: [kaseki, configuration, environment-variables, settings, secrets, tuning]
relatedSkills: [cost-optimization, performance-tuning, docker-image-management, distributed-deployment]
---

# Environment Configuration for Kaseki Agent

This skill provides comprehensive reference for all kaseki-agent environment variables and configuration options.

## Overview

**When to Use**:
- Setting up a new kaseki deployment
- Tuning performance for specific use cases
- Securing credentials and API keys
- Configuring Docker, OpenRouter, or quality gates
- Creating configuration templates for teams

**Key Concepts**:
- Environment variables control all kaseki behavior
- Configuration hierarchy: CLI args > env file > .env > env vars
- Secrets should use file-based resolution (not hardcoded)
- Configuration is validated on startup via `--doctor`

---

## Core Agent Variables

### Required Variables

| Variable | Purpose | Format | Example |
|---|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter authentication | String (sk-or-...) | `sk-or-abc123...` |
| `REPO_URL` | Git repository to clone | HTTPS URL | `https://github.com/org/repo` |

### Optional Agent Variables

| Variable | Default | Purpose | Values |
|---|---|---|---|
| `GIT_REF` | `main` | Git branch/tag/commit | Branch name, tag, or commit SHA |
| `TASK_PROMPT` | (code fix) | Agent instruction | Natural language prompt |
| `KASEKI_MODEL` | `openrouter/free` | LLM model to use | Model identifier or `openrouter/free` |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `10800` | Agent execution timeout | Seconds (typical: 10800–14400) |
| `KASEKI_CAVEMAN` | `1` | Enable terse communication mode (Caveman skill) | `0` (disable) or `1` (enable, default) |

---

## Agent Communication Modes

### Caveman Mode (Token Efficiency)

**What it does**: Activates the Caveman skill to reduce prompt token usage ~75% across all Pi phases (goal-setting, scouting, coding, goal-check, evaluation) while preserving technical accuracy.

**How it works**: 
- Drop articles (a/an/the), filler (just, really, basically), pleasantries (sure, certainly)
- Keep full sentences; use fragments when clear
- Use short synonyms (big not extensive, fix not implement)
- No tool narration, decorative tables, or emoji
- Technical terms exact; code blocks unchanged
- Pattern: `[thing] [action] [reason]. [next step].`

**Usage**:
```bash
# Enable (default)
KASEKI_CAVEMAN=1 ./run-kaseki.sh

# Disable (verbose mode)
KASEKI_CAVEMAN=0 ./run-kaseki.sh
```

**When to use**:
- Cost-sensitive runs (OpenRouter/OpenAI token billing)
- Long multi-step tasks where prompt length impacts quality
- Large codebases requiring detailed exploration
- Limited context window for complex tasks

**When to disable** (`KASEKI_CAVEMAN=0`):
- Prefer verbose, detailed guidance
- Complex ambiguous tasks where clarity matters more than efficiency
- Initial setup/testing where extra detail helps

**Impact**:
- Prompt token usage: ~75% reduction
- Response quality: Maintained (technical substance preserved)
- Processing time: No impact (token reduction only affects input)
- Model behavior: No difference (same instructions, just more concise)

---

## Quality Gate Variables

### File Allowlist

| Variable | Default | Purpose | Format |
|---|---|---|---|
| `KASEKI_CHANGED_FILES_ALLOWLIST` | (none) | Restrict agent changes | Space-separated glob patterns |

**Examples**:
```bash
# Single file
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts"

# Multiple files
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"

# Glob patterns
KASEKI_CHANGED_FILES_ALLOWLIST="src/**/*.ts tests/**/*.test.ts"
```

### Diff Size & Security

| Variable | Default | Purpose | Format |
|---|---|---|---|
| `KASEKI_MAX_DIFF_BYTES` | `400000` | Max diff size | Bytes (integer) |
| `KASEKI_VALIDATION_ALLOWLIST` | (none) | Limit validation file changes | Space-separated glob patterns |

### Validation Commands

| Variable | Default | Purpose | Format |
|---|---|---|---|
| `KASEKI_VALIDATION_COMMANDS` | `npm run check;npm run test;npm run build` | Commands to run after agent | Semicolon-separated |

**Examples**:
```bash
# TypeScript
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"

# Python
KASEKI_VALIDATION_COMMANDS="python -m pytest;mypy src/"

# Single command
KASEKI_VALIDATION_COMMANDS="npm test"
```

---

## API Service Configuration

### Authentication

| Variable | Default | Purpose |
|---|---|---|
| `KASEKI_API_KEYS` | (required) | Comma-separated API keys for requests |
| `KASEKI_API_KEY_FILE` | `/run/secrets/kaseki_api_keys` | Read keys from file (preferred) |

**Setup** (file-based, recommended):
```bash
# Create secret file
echo "api-key-1,api-key-2" > /etc/kaseki/api-keys
chmod 600 /etc/kaseki/api-keys

# Use in docker-compose.yml
environment:
  KASEKI_API_KEY_FILE: /etc/kaseki/api-keys
```

### Service Port & Concurrency

| Variable | Default | Purpose | Values |
|---|---|---|---|
| `KASEKI_API_PORT` | `8080` | HTTP listen port | Port number (1–65535) |
| `KASEKI_API_HOST` | `0.0.0.0` | Bind address | IP or hostname |
| `KASEKI_API_MAX_CONCURRENT_RUNS` | `3` | Parallel run limit | 1–10 (typical) |
| `KASEKI_API_QUEUE_SIZE` | `100` | Max pending runs | Integer |

**Example**:
```bash
# High-throughput configuration
KASEKI_API_PORT=8080
KASEKI_API_HOST=0.0.0.0
KASEKI_API_MAX_CONCURRENT_RUNS=8
KASEKI_API_QUEUE_SIZE=200
```

---

## Docker & Container Settings

| Variable | Default | Purpose | Values |
|---|---|---|---|
| `KASEKI_IMAGE` | `docker.io/cyanautomation/kaseki-agent:latest` | Container image | Registry/image:tag |
| `DOCKER_HOST` | `/var/run/docker.sock` | Docker daemon socket | Path or TCP URL |
| `DOCKER_GID` | (auto-detect) | Docker group ID | Numeric GID |

---

## OpenRouter Configuration

| Variable | Default | Purpose | Example |
|---|---|---|---|
| `OPENROUTER_API_KEY` | (required) | API authentication | `sk-or-abc123...` |
| `KASEKI_MODEL` | `openrouter/free` | Model selection | `claude-3.5-sonnet`, `gpt-4` |
| `KASEKI_API_BASE` | (OpenRouter default) | Alternative API endpoint | `https://api.custom.com` |

**Model Examples**:
```bash
# Free tier (default, cheapest available)
KASEKI_MODEL=openrouter/free

# Specific model
KASEKI_MODEL=anthropic/claude-3.5-sonnet

# Alternative provider
KASEKI_MODEL=openai/gpt-4-turbo
```

---

## Cache & Performance

| Variable | Default | Purpose | Values |
|---|---|---|---|
| `KASEKI_CACHE_ENABLED` | `1` | Enable npm caching | 0=disabled, 1=enabled |
| `KASEKI_KEEP_WORKSPACE` | `0` | Keep temp workspace after run | 0=delete, 1=keep |
| `KASEKI_STREAM_PROGRESS` | `1` | Stream progress logs | 0=off, 1=on |

---

## Logging & Debugging

| Variable | Default | Purpose |
|---|---|---|
| `KASEKI_DEBUG_RAW_EVENTS` | `0` | Keep raw Pi JSONL (no filtering) |
| `KASEKI_LOG_LEVEL` | `info` | Log verbosity |

**Values** (log levels):
- `error` — Only errors
- `warn` — Warnings and errors
- `info` — Standard logging (default)
- `debug` — Verbose debugging
- `trace` — Ultra-verbose

---

## Directory Structure

| Variable | Default | Purpose |
|---|---|---|
| `AGENTS_ROOT_DIR` | `/agents` | Base directory for all kaseki data |
| `AGENTS_RESULTS_DIR` | `/agents/kaseki-results` | Where run artifacts are stored |
| `AGENTS_CACHE_DIR` | `/agents/kaseki-cache` | Persistent npm cache |
| `AGENTS_RUNS_DIR` | `/agents/kaseki-runs` | Ephemeral workspace (if `KASEKI_KEEP_WORKSPACE=1`) |

---

## Configuration by Use Case

### Minimal Configuration (Development)

```bash
# .env
OPENROUTER_API_KEY=sk-or-...
REPO_URL=https://github.com/org/repo
```

### Production Configuration

```bash
# /etc/kaseki/env

# Core
OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_api_key
REPO_URL=https://github.com/org/repo
GIT_REF=main

# Quality gates
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
KASEKI_MAX_DIFF_BYTES=300000
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"

# API service
KASEKI_API_PORT=8080
KASEKI_API_MAX_CONCURRENT_RUNS=5
KASEKI_API_KEY_FILE=/etc/kaseki/api-keys

# Performance
KASEKI_AGENT_TIMEOUT_SECONDS=1800
KASEKI_CACHE_ENABLED=1

# Logging
KASEKI_LOG_LEVEL=info
```

### Cost-Optimized Configuration

```bash
# Focus on reducing token usage

KASEKI_MODEL=openrouter/free  # Always free tier
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"  # Tight scope
KASEKI_AGENT_TIMEOUT_SECONDS=2400  # Longer timeout = less thrashing
KASEKI_CACHE_ENABLED=1  # Faster validation
```

### High-Performance Configuration

```bash
# Focus on speed and throughput

KASEKI_API_MAX_CONCURRENT_RUNS=8
KASEKI_AGENT_TIMEOUT_SECONDS=10800
KASEKI_CACHE_ENABLED=1
KASEKI_STREAM_PROGRESS=1
KASEKI_VALIDATION_COMMANDS="npm run test"  # Skip lint/build for speed
```

### Scoped/Restricted Configuration

```bash
# Limit blast radius for untrusted tasks

KASEKI_CHANGED_FILES_ALLOWLIST="src/parser.ts tests/parser.test.ts"
KASEKI_MAX_DIFF_BYTES=50000
KASEKI_VALIDATION_COMMANDS="npm run test -- tests/parser.test.ts"
KASEKI_AGENT_TIMEOUT_SECONDS=900  # Shorter timeout
```

---

## Environment Variable Precedence

Order of precedence (highest to lowest):

1. **Command-line arguments** (if using CLI)
   ```bash
   ./run-kaseki.sh --api-key sk-or-... --repo-url https://...
   ```

2. **Explicit env file** (with `--env-file`)
   ```bash
   ./run-kaseki.sh --env-file /path/to/.env
   ```

3. **Local .env file** (automatically loaded)
   ```bash
   # In current directory: .env
   OPENROUTER_API_KEY=sk-or-...
   ```

4. **System environment variables**
   ```bash
   export OPENROUTER_API_KEY=sk-or-...
   ```

5. **Defaults** (hardcoded in scripts)
   ```bash
   # Default: GIT_REF=main, KASEKI_AGENT_TIMEOUT_SECONDS=1200
   ```

---

## Validation Checklist

Before running kaseki, verify configuration:

```bash
#!/bin/bash
# kaseki-config-check.sh

echo "🔍 Validating kaseki configuration..."

# Check API key
[[ -z "$OPENROUTER_API_KEY" ]] && \
  echo "❌ OPENROUTER_API_KEY not set" || echo "✅ API key set"

# Check repo URL
[[ -z "$REPO_URL" ]] && \
  echo "❌ REPO_URL not set" || echo "✅ Repo URL set"

# Check ports available
if netstat -tuln | grep -q ":8080 "; then
  echo "⚠️  Port 8080 in use"
else
  echo "✅ Port 8080 available"
fi

# Check disk space
DISK_AVAIL=$(df /agents | awk 'NR==2 {print $4}')
[[ $DISK_AVAIL -lt 5000000 ]] && \
  echo "⚠️  Low disk space: $((DISK_AVAIL/1024)) MB available" || \
  echo "✅ Sufficient disk space"

# Check Docker
docker ps > /dev/null 2>&1 && \
  echo "✅ Docker available" || echo "❌ Docker not available"

echo "✅ Configuration check complete"
```

---

## See Also

- [ENV_VARS.md](../../docs/ENV_VARS.md) — Authoritative environment variable reference
- [PERFORMANCE_TUNING.md](../../docs/PERFORMANCE_TUNING.md) — Configuration tuning for performance
- [COST_ESTIMATION.md](../../docs/COST_ESTIMATION.md) — Cost-aware configuration
- [DEPLOYMENT.md](../../docs/DEPLOYMENT.md) — Deployment-specific configuration
