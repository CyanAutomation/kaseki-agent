# Kaseki Agent Setup Guide

**👉 NEW: Using npm package?** See [NPM_SETUP.md](NPM_SETUP.md) for the recommended approach.

---

## Quick Start (< 5 minutes) - NPM Method

### Prerequisites

- **Node.js v24+** — JavaScript runtime
- **Docker** (required) — handles containerized agent runs  
- **Git** (required) — for cloning target repositories
- **OpenRouter API Key** (required) — authenticates Pi agent calls
- **Linux or macOS**

### Installation

```bash
# Global install (recommended)
npm install -g @cyanautomation/kaseki-agent

# Run setup wizard
kaseki-agent setup

# Verify
kaseki-agent doctor

# Run your first task
kaseki-agent run https://github.com/CyanAutomation/crudmapper main
```

That's it! For detailed documentation, see [NPM_SETUP.md](NPM_SETUP.md).

---

## Alternative: Traditional Setup (Shell Scripts)

For users preferring shell-based setup:

### Prerequisites

- **Docker** (required) — handles containerized agent runs
- **Git** (required) — for cloning target repositories
- **OpenRouter API Key** (required) — authenticates Pi agent calls
- **bash/sh** — standard shell

### One-Command Bootstrap

For a single host setup with automatic dependency checks:

```bash
# Clone the repository
git clone https://github.com/CyanAutomation/kaseki-agent.git /agents/kaseki-template
cd /agents/kaseki-template

# Run interactive setup (checks dependencies, guides you through API key setup)
./scripts/kaseki-setup.sh
```

This script will:

1. Validate Docker is installed (or guide you to install it)
2. Prompt for your OpenRouter API key securely
3. Create `~/.kaseki/secrets/openrouter_api_key` with proper permissions (600)
4. Run final health checks
5. Confirm you're ready to use kaseki-agent

**That's it!** You can now run kaseki-agent directly.

---

## Choosing Your Deployment Pattern

Kaseki supports three deployment patterns. Choose the one that matches your needs:

| Pattern | Use Case | Complexity | Effort |
|---------|----------|-----------|--------|
| **Direct CLI** | One-off runs, local development, single host | Simple | Low |
| **Remote Activation** | Multi-host setup, controller-driven orchestration | Medium | Medium |
| **REST API Service** | Long-running service, async execution, distributed orchestration | Complex | High |

### Pattern 1: Direct CLI (Recommended for Single Host)

**Scenario**: You're on a Pi or single host and want to run kaseki-agent directly.

**Setup**: Run `./scripts/kaseki-setup.sh` once, then:

```bash
# Run an agent task
OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/your-org/your-repo main

# Health check
./run-kaseki.sh --doctor
```

**When to use:**

- Local development or testing
- Single Pi/host deployments
- One-off tasks without orchestration
- Manual, ad-hoc execution

See [scripts/templates/SINGLE_HOST_CLI.md](../scripts/templates/SINGLE_HOST_CLI.md) for detailed steps.

---

### Pattern 2: Remote Activation (Recommended for Multi-Host)

**Scenario**: You have a controller machine (Mac, Linux) and want to orchestrate multiple Pi hosts.

**Setup**: Run `./scripts/pi-setup-remote.sh` from your controller to bootstrap each Pi:

```bash
# From your controller machine (Mac/Linux)
./scripts/pi-setup-remote.sh pi@192.168.88.201 sk-or-v1-your-key-here

# Or, if you have the key in a file
./scripts/pi-setup-remote.sh pi@192.168.88.201 ~/my-openrouter-key.txt
```

This will:

1. SSH to the remote Pi
2. Create secrets directory with proper permissions
3. Securely transfer your API key
4. Run `kaseki-install.sh` to bootstrap the repository
5. Validate readiness with `--doctor`

Then from your controller, you can trigger runs on the Pi:

```bash
ssh pi@192.168.88.201 'OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key /agents/kaseki-template/run-kaseki.sh https://github.com/your-org/your-repo main'
```

**When to use:**

- Managing multiple Pi/host instances
- Controller-driven orchestration
- Integration with external orchestrators (e.g., OpenClaw)
- Want idempotent, reproducible setup

See [scripts/templates/MULTI_HOST_DISTRIBUTED.md](../scripts/templates/MULTI_HOST_DISTRIBUTED.md) for detailed steps.

---

### Pattern 3: REST API Service (For Advanced Users)

**Scenario**: You want a long-running HTTP API service that manages async kaseki-agent runs.

**Setup**: Deploy the Docker Compose service:

```bash
cd /agents/kaseki-template

# Set your API key(s)
export KASEKI_API_KEYS=sk-your-secret-key

# Start the service
docker-compose up -d

# Verify it's running
curl http://localhost:8080/api/health
```

Then trigger runs via HTTP:

```bash
curl -X POST http://localhost:8080/api/run \
  -H "Authorization: Bearer sk-your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "repo_url": "https://github.com/your-org/your-repo",
    "git_ref": "main",
    "task_prompt": "Fix the parsing bug"
  }'
```

**When to use:**

- Long-running service with async execution
- Multiple concurrent runs
- Integration with distributed orchestrators
- Need HTTP API for external tools

See [scripts/templates/REST_API_SERVICE.md](../scripts/templates/REST_API_SERVICE.md) and [docs/DEPLOYMENT.md](DEPLOYMENT.md) for detailed setup.

---

## Environment-Specific Installation

If you need to manually install dependencies, choose your operating system:

### Debian / Ubuntu / Raspberry Pi OS

```bash
# Update package list
sudo apt update

# Install required dependencies
sudo apt install -y \
  docker.io \
  git

# Optional: Install Node.js (only needed for fallback mode)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Start Docker daemon
sudo systemctl start docker
sudo systemctl enable docker

# (Optional) Add your user to docker group to avoid `sudo`
sudo usermod -aG docker "$USER"
# Restart shell or run: newgrp docker
```

### Fedora / RHEL / CentOS Stream

```bash
# Update package list
sudo dnf update -y

# Install required dependencies
sudo dnf install -y \
  docker \
  git

# Optional: Install Node.js (only needed for fallback mode)
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs

# Start Docker daemon
sudo systemctl start docker
sudo systemctl enable docker

# (Optional) Add your user to docker group to avoid `sudo`
sudo usermod -aG docker "$USER"
# Restart shell or run: newgrp docker
```

### Arch Linux

```bash
# Update package list
sudo pacman -Sy

# Install required dependencies
sudo pacman -S --needed \
  docker \
  git

# Optional: Install Node.js (only needed for fallback mode)
sudo pacman -S --needed nodejs npm

# Start Docker daemon
sudo systemctl start docker
sudo systemctl enable docker

# (Optional) Add your user to docker group to avoid `sudo`
sudo usermod -aG docker "$USER"
# Restart shell or run: newgrp docker
```

### macOS (for controller/development only)

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Docker Desktop (GUI) or Docker via Homebrew
brew install --cask docker
# OR (CLI only)
brew install docker

# Install Git and Node.js (if needed)
brew install git node
```

---

## Credential Setup

### OpenRouter API Key

Your OpenRouter API key authenticates requests to the Pi coding agent.

#### Obtain Your Key

1. Visit [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create or copy an existing API key (format: `sk-or-v1-...`)

#### Store It Securely

```bash
# Create secrets directory
mkdir -p ~/.kaseki/secrets
chmod 700 ~/.kaseki/secrets

# Store your key (interactive)
read -sp 'Enter your OpenRouter API key: ' OPENROUTER_KEY
echo "$OPENROUTER_KEY" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key

# Or paste from a file
cp /path/to/your/key.txt ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key
```

#### Use It

All kaseki commands reference this file:

```bash
OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key ./run-kaseki.sh ...
```

Or, for convenience, add to `~/.bashrc` or `~/.zshrc`:

```bash
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key
```

Then you can simply run:

```bash
./run-kaseki.sh https://github.com/your-org/your-repo main
```

---

## Verify Your Setup

### Quick Health Check

```bash
./run-kaseki.sh --doctor
```

Expected output:

```
Preflight required dependencies: ok (docker)
Preflight optional dependencies: ok (curl, wget, sshpass, git, node, npm)
Docker daemon: running
Kaseki template image: available
✓ Setup is ready!
```

### Test a Real Run

```bash
./run-kaseki.sh \
  https://github.com/CyanAutomation/crudmapper \
  main
```

This will:

1. Spin up a Docker container (kaseki-1)
2. Clone the repository
3. Run the default agent task
4. Collect artifacts in `/agents/kaseki-results/kaseki-1/`

Check the results:

```bash
cat /agents/kaseki-results/kaseki-1/result-summary.md
```

---

## Troubleshooting

### "Docker daemon not responding"

```bash
# Start Docker (Linux/Raspberry Pi OS)
sudo systemctl start docker

# Or (if not using systemd)
sudo service docker start

# Verify it's running
docker ps
```

### "Permission denied while trying to connect to Docker daemon"

Add your user to the docker group:

```bash
sudo usermod -aG docker "$USER"
newgrp docker  # Apply immediately (or restart shell)
```

### "OpenRouter API key not found"

Make sure your key file exists and is readable:

```bash
ls -la ~/.kaseki/secrets/openrouter_api_key
# Should output: -rw------- ... openrouter_api_key

# If not, re-create it
mkdir -p ~/.kaseki/secrets
read -sp 'Enter your OpenRouter API key: ' OPENROUTER_KEY
echo "$OPENROUTER_KEY" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key
```

### "Missing required host dependencies"

Run `./scripts/kaseki-setup.sh` or manually install dependencies:

```bash
# For Ubuntu/Debian
sudo apt install -y docker.io git

# For Fedora/RHEL
sudo dnf install -y docker git

# For Arch
sudo pacman -S --needed docker git
```

### Agent runs take too long

The default timeout is 20 minutes. To adjust:

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=3600 ./run-kaseki.sh ...
```

### Results directory filling up disk

Clean up old runs:

```bash
./scripts/cleanup-kaseki.sh
```

By default, keeps 10 most recent runs. Adjust with:

```bash
./scripts/cleanup-kaseki.sh --keep 5
```

---

## Next Steps

1. **Choose your pattern** — Direct CLI, Remote Activation, or REST API Service
2. **Follow the appropriate template** — See [scripts/templates/](../scripts/templates/) for detailed steps
3. **Review quality gates** — Understand constraints in [docs/QUALITY_GATES.md](QUALITY_GATES.md)
4. **Craft effective task prompts** — See [docs/TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md)
5. **Monitor results** — Use `kaseki-report`, `kaseki-cli`, or web dashboard

---

## Advanced Topics

- **Dependency Caching**: See [CLAUDE.md](../CLAUDE.md#L159-L165) for 4-layer npm cache strategy
- **Quality Gates & Allowlists**: See [docs/QUALITY_GATES.md](QUALITY_GATES.md)
- **Task Prompts**: See [docs/TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md)
- **REST API Configuration**: See [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- **Monitoring & CLI**: See [docs/CLI.md](CLI.md)

---

## Support

For issues, questions, or contributions:

- Check existing issues: [GitHub Issues](https://github.com/CyanAutomation/kaseki-agent/issues)
- Review documentation: [docs/](../) folder
- Report bugs: [New Issue](https://github.com/CyanAutomation/kaseki-agent/issues/new)

---

**Last updated**: May 7, 2026
