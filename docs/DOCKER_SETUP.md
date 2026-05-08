# Container-Based Setup Guide

This guide covers the **simplified container-based workflows** for kaseki-agent. These are ideal for users who want to minimize host-level complexity.

## Quick Start (Choose Your Scenario)

### **Scenario A: Interactive Setup (Easiest)**

Perfect for: Single host, local development, first-time users

```bash
# 1. One-time setup (interactive, saves API key)
docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup

# 2. Run your first task (API key already saved)
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent https://github.com/your-org/your-repo main
```

**Or with the convenience wrapper (if you've installed kaseki):**

```bash
./kaseki setup
./kaseki agent https://github.com/your-org/your-repo main
```

---

### **Scenario B: One-Command Run (No Setup)**

Perfect for: CI/CD, temporary runs, scripts

```bash
# Single command, API key from environment variable
OPENROUTER_API_KEY=sk-or-v1-your-key docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run-mode https://github.com/your-org/your-repo main
```

**Or with wrapper:**

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key ./kaseki run-mode https://github.com/your-org/your-repo main
```

---

### **Scenario C: Multi-Host Setup (From Controller)**

Perfect for: Distributed execution, managing multiple Pi/hosts

**From your controller machine (Mac, Linux):**

```bash
# Bootstrap each host
docker run \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup-remote pi@192.168.88.201 sk-or-v1-your-key

docker run \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup-remote pi@192.168.88.202 sk-or-v1-your-key

# Then run tasks on each host via SSH
ssh pi@192.168.88.201 \
  'docker run -it \
    -v ~/.kaseki/secrets:/secrets \
    -v /var/run/docker.sock:/var/run/docker.sock \
    docker.io/cyanautomation/kaseki-agent:latest \
    agent https://github.com/your-org/your-repo main'
```

---

## Entry Points Reference

The container supports the following entry points (commands):

### `setup` — Interactive Setup Wizard

**Purpose:** Securely prompt for API key and validate configuration

**Usage:**

```bash
docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup
```

**What it does:**

1. Prompts: "Enter your OpenRouter API key (sk-or-v1-...): "
2. Creates `~/.kaseki/secrets/openrouter_api_key` with mode 600
3. Validates Docker daemon accessibility
4. Confirms Pi CLI availability
5. Reports readiness status

**Credential sources (in priority order):**

1. Existing `/secrets/openrouter_api_key` file (asks to reuse)
2. `OPENROUTER_API_KEY` environment variable (if set)
3. Interactive prompt (if neither above)

---

### `doctor` — Health Check & Diagnostics

**Purpose:** Validate system readiness for kaseki operations

**Usage:**

```bash
docker run \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  doctor
```

**Validates:**

- Docker daemon accessibility
- Pi CLI availability
- API key file readability
- Image and tools integrity

---

### `agent` — Run Agent Task

**Purpose:** Execute kaseki-agent against a repository

**Usage:**

```bash
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent <repo-url> <git-ref> [task-prompt]
```

**Arguments:**

- `<repo-url>` — Git repository URL (e.g., `https://github.com/org/repo`)
- `<git-ref>` — Branch, tag, or commit (e.g., `main`, `v1.0.0`, `abc1234`)
- `[task-prompt]` — Optional: Custom task description (overrides default)

**Example:**

```bash
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v results:/results \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent https://github.com/CyanAutomation/crudmapper main "Refactor the auth module"
```

**Environment variables (optional):**

- `KASEKI_AGENT_TIMEOUT_SECONDS` — Timeout in seconds (default: 1200 / 20 min)
- `KASEKI_MODEL` — Pi model to use (default: openrouter/free)
- `KASEKI_VALIDATION_COMMANDS` — Validation steps (default: npm run check; npm run test; npm run build)
- `KASEKI_CHANGED_FILES_ALLOWLIST` — Restrict which files can change
- `KASEKI_MAX_DIFF_BYTES` — Maximum diff size (default: 200000 bytes)

**Result location:**

- Output: Streamed to stdout in real-time
- Artifacts: Saved to `/results` (mounted volume)

---

### `run-mode` — One-Command Run

**Purpose:** Execute a complete run with API key from environment variable (no pre-setup)

**Usage:**

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v results:/results \
  docker.io/cyanautomation/kaseki-agent:latest \
  run-mode <repo-url> <git-ref> [task-prompt]
```

**Key differences from `agent` mode:**

- API key comes from `OPENROUTER_API_KEY` env var (not file)
- No pre-setup required
- One-shot execution (no need for `./kaseki setup` first)
- Ideal for CI/CD, scripts, temporary runs

**Example:**

```bash
OPENROUTER_API_KEY=sk-or-v1-abc... docker run -it \
  -e OPENROUTER_API_KEY \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run-mode https://github.com/org/repo main
```

**Security note:** API key is read from environment, written to a secure temp file (mode 600), and the environment variable is cleared immediately to prevent exposure in child process listings.

---

### `setup-remote` — Remote Host Setup

**Purpose:** Bootstrap kaseki-agent on a remote host via SSH (orchestrated from container)

**Usage:**

```bash
docker run \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup-remote <remote-host> <api-key-or-file>
```

**Arguments:**

- `<remote-host>` — SSH destination (e.g., `pi@192.168.88.201`)
- `<api-key-or-file>` — API key directly (sk-or-...) OR path to file

**Examples:**

```bash
# Inline API key
docker run \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup-remote pi@192.168.88.201 sk-or-v1-your-key

# API key from file
docker run \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup-remote pi@192.168.88.202 ~/.kaseki/secrets/openrouter_api_key
```

**What it does:**

1. Validates SSH connectivity
2. Creates `~/.kaseki/secrets/` on remote with proper permissions
3. Securely transfers API key via stdin (avoids shell history exposure)
4. Attempts Docker-based setup on remote (if Docker available)
5. Reports readiness

**Assumptions:**

- SSH keys are already configured (run `ssh-copy-id` first if needed)
- Remote host has Docker installed (or manually runs kaseki-install.sh)

---

## Volume Mounts Reference

### Required Mounts

| Mount | Purpose | Example |
|-------|---------|---------|
| **Docker Socket** | Allows container to launch child containers | `-v /var/run/docker.sock:/var/run/docker.sock` |
| **Secrets** | API key storage | `-v ~/.kaseki/secrets:/secrets` |
| **Results** | Output artifacts (optional) | `-v ./results:/results` |

### Optional Mounts

| Mount | Purpose | Example |
|-------|---------|---------|
| **Git Cache** | Speed up repeated clones | `-v ~/.kaseki/git-cache:/cache/git` |
| **npm Cache** | Speed up npm installs | `-v ~/.kaseki/npm-cache:/cache/npm` |

### Full Example with All Mounts

```bash
docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.kaseki/secrets:/secrets \
  -v ./results:/results \
  -v ~/.kaseki/git-cache:/cache/git \
  -v ~/.kaseki/npm-cache:/cache/npm \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent https://github.com/org/repo main
```

---

## Convenience Wrapper Script

If you've installed the `kaseki` wrapper script at the root, you can use simplified commands:

```bash
# Interactive setup
./kaseki setup

# Health check
./kaseki doctor

# Run agent task (uses saved API key)
./kaseki agent https://github.com/org/repo main

# One-command run (uses OPENROUTER_API_KEY env var)
OPENROUTER_API_KEY=sk-or-... ./kaseki run-mode https://github.com/org/repo main

# Multi-host setup
./kaseki setup-remote pi@host1 sk-or-key
./kaseki setup-remote pi@host2 sk-or-key
```

### Installing the Wrapper

The `kaseki` script is at the repository root:

```bash
# Option 1: Use directly from repo
cd /path/to/kaseki-agent
./kaseki setup

# Option 2: Copy to PATH for system-wide access
cp ./kaseki ~/bin/kaseki
chmod +x ~/bin/kaseki
kaseki setup

# Option 3: Create symlink
ln -s /path/to/kaseki-agent/kaseki ~/bin/kaseki
```

---

## Environment Variables

### Execution Control

| Variable | Default | Purpose |
|----------|---------|---------|
| `KASEKI_IMAGE` | `docker.io/cyanautomation/kaseki-agent:latest` | Docker image to use |
| `KASEKI_INSTANCE` | `kaseki-run` | Instance name (for run-mode) |
| `KASEKI_RESULTS_DIR` | `/results` | Results directory |
| `KASEKI_AGENT_TIMEOUT_SECONDS` | `1200` | Agent timeout (20 min) |

### Credentials

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | API key (for run-mode only; not recommended for interactive use) |
| `OPENROUTER_API_KEY_FILE` | Path to API key file (set automatically during setup) |

### Agent Configuration

| Variable | Purpose |
|----------|---------|
| `TASK_PROMPT` | Custom task description |
| `KASEKI_MODEL` | Model to use (default: openrouter/free) |
| `KASEKI_VALIDATION_COMMANDS` | Validation steps (semicolon-separated) |
| `KASEKI_CHANGED_FILES_ALLOWLIST` | Restrict file changes |
| `KASEKI_MAX_DIFF_BYTES` | Maximum diff size (bytes) |

---

## Common Workflows

### Workflow 1: Daily Development Tasks

```bash
# Day 1: Initial setup
docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup

# Days 2+: Run tasks (API key cached)
docker run -it \
  -v ~/.kaseki/secrets:/secrets \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v results:/results \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent https://github.com/my-org/my-repo feature/branch
```

### Workflow 2: CI/CD Pipeline

```bash
# In your GitHub Actions / GitLab CI / Jenkins:
OPENROUTER_API_KEY=${{ secrets.OPENROUTER_API_KEY }} docker run \
  -e OPENROUTER_API_KEY \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run-mode $REPO_URL main "Fix failing tests"
```

### Workflow 3: Multi-Host Distributed Execution

```bash
#!/bin/bash

# Bootstrap 3 Pi hosts (from controller)
for i in 1 2 3; do
  docker run \
    docker.io/cyanautomation/kaseki-agent:latest \
    setup-remote pi@192.168.88.20$i sk-or-v1-your-key
done

# Run tasks on each host in parallel
for i in 1 2 3; do
  host="pi@192.168.88.20$i"
  ssh "$host" 'docker run -it \
    -v ~/.kaseki/secrets:/secrets \
    -v /var/run/docker.sock:/var/run/docker.sock \
    docker.io/cyanautomation/kaseki-agent:latest \
    agent https://github.com/org/repo main' &
done

wait
echo "All hosts completed!"
```

---

## Troubleshooting

### "Docker daemon not responding"

The container needs access to the Docker socket. Make sure you're mounting it:

```bash
docker run -v /var/run/docker.sock:/var/run/docker.sock ...
```

If using Docker Desktop (Mac/Windows), ensure Docker Desktop is running.

### "API key file not found"

For `setup` and `agent` modes, the API key file must exist at `~/.kaseki/secrets/openrouter_api_key`:

```bash
# Create it manually if needed
mkdir -p ~/.kaseki/secrets
echo "sk-or-v1-your-key" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key

# Or run setup to create it interactively
docker run -it \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.kaseki/secrets:/secrets \
  docker.io/cyanautomation/kaseki-agent:latest \
  setup
```

### "OPENROUTER_API_KEY environment variable is required"

For `run-mode`, you must pass the API key as an environment variable:

```bash
OPENROUTER_API_KEY=sk-or-v1-... docker run -it \
  -e OPENROUTER_API_KEY \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker.io/cyanautomation/kaseki-agent:latest \
  run-mode https://github.com/org/repo main
```

### "SSH: permission denied"

For `setup-remote`, you need SSH keys configured:

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519

# Copy public key to remote host
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.88.201

# Test SSH
ssh pi@192.168.88.201 "echo OK"
```

### Results not saved

Make sure you're mounting the results directory:

```bash
docker run -it \
  ...
  -v ./results:/results \
  docker.io/cyanautomation/kaseki-agent:latest \
  agent ...
```

Results will be in `./results/` after the run completes.

---

## Comparison: Container vs. Host Setup

| Aspect | Container-Based | Host-Based (`run-kaseki.sh`) |
|--------|-----------------|------------------------------|
| **Setup** | `docker run ... setup` | Clone repo, run `./scripts/kaseki-setup.sh` |
| **Execution** | `docker run ... agent` | `./run-kaseki.sh` |
| **API key** | File (`/secrets/`) or env var | File (`~/.kaseki/secrets/`) |
| **Host dependencies** | Docker + curl/wget | Docker + bash + git |
| **First-time user** | "Run `docker run ... setup`" | "Read SETUP_GUIDE.md" |
| **Multi-host** | `docker run ... setup-remote` (from controller) | Clone repo, run `pi-setup-remote.sh` on each host |

---

## See Also

- [SETUP_GUIDE.md](SETUP_GUIDE.md) — Traditional host-based setup
- [DEPLOYMENT.md](DEPLOYMENT.md) — REST API service deployment
- [CLI.md](CLI.md) — Monitoring with kaseki-cli
- [QUALITY_GATES.md](QUALITY_GATES.md) — Quality gates and allowlists
- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Writing effective task prompts
