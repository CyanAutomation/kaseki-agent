# Single Host CLI Setup

For running kaseki-agent directly on a single host (Pi, Ubuntu VM, etc.) via command-line.

**Complexity**: Low | **Time**: 5-10 minutes

---

## Prerequisites

- Docker installed and running
- Git installed
- OpenRouter API key

## Step 1: Clone the Repository

```bash
# On your Pi or host machine
git clone https://github.com/CyanAutomation/kaseki-agent.git /agents/kaseki-template
cd /agents/kaseki-template
```

## Step 2: Run Interactive Setup

```bash
./scripts/kaseki-setup.sh
```

This will:

- Validate Docker is installed
- Prompt for your OpenRouter API key (securely, not in shell history)
- Create `~/.kaseki/secrets/openrouter_api_key` with proper permissions
- Run health checks

## Step 3: Verify Setup

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

## Step 4: Run Your First Task

```bash
# Set the API key file location
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key

# Run kaseki-agent against a repository
./run-kaseki.sh https://github.com/your-org/your-repo main
```

Or with inline arguments:

```bash
REPO_URL=https://github.com/your-org/your-repo \
  GIT_REF=main \
  TASK_PROMPT='Fix the bug in parser.ts' \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh
```

## Step 5: Monitor Results

Kaseki creates a numbered instance folder. Check the results:

```bash
# List all runs
ls -la /agents/kaseki-results/

# Check the first run
cat /agents/kaseki-results/kaseki-1/result-summary.md

# View the git diff
cat /agents/kaseki-results/kaseki-1/git.diff

# Stream live progress (if still running)
./kaseki-cli.js watch kaseki-1
```

## Convenience: Add to Shell Profile

To avoid typing `OPENROUTER_API_KEY_FILE=...` every time:

```bash
# Add to ~/.bashrc or ~/.zshrc
export OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key
export REPO_URL=https://github.com/your-org/your-repo
export GIT_REF=main

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

Then simply run:

```bash
./run-kaseki.sh
```

## Common Tasks

### Run a Custom Task

```bash
TASK_PROMPT='Refactor the authentication module to use async/await' \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/your-org/your-repo main
```

### Increase Agent Timeout

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=3600 \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh ...
```

### Run Against a Specific Commit

```bash
GIT_REF=abc1234def5678 \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh https://github.com/your-org/your-repo abc1234def5678
```

### Enable Debug Output

```bash
KASEKI_DEBUG_RAW_EVENTS=1 \
  OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
  ./run-kaseki.sh ...
```

## Troubleshooting

### "Docker daemon not running"

```bash
# Start Docker
sudo systemctl start docker

# Or (if not using systemd)
sudo service docker start

# Verify
docker ps
```

### "Permission denied" when accessing Docker

```bash
# Add user to docker group
sudo usermod -aG docker "$USER"

# Apply immediately
newgrp docker

# Or restart shell
```

### "API key not found"

```bash
# Recreate the key file
mkdir -p ~/.kaseki/secrets
read -sp 'Enter your OpenRouter API key: ' OPENROUTER_KEY
echo "$OPENROUTER_KEY" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key
```

### Agent times out

Increase the timeout:

```bash
KASEKI_AGENT_TIMEOUT_SECONDS=3600 ./run-kaseki.sh ...  # 1 hour
```

## Next Steps

- Review [docs/QUALITY_GATES.md](../../docs/QUALITY_GATES.md) to understand constraints
- Learn about task prompts: [docs/TASK_PROMPT_TEMPLATES.md](../../docs/TASK_PROMPT_TEMPLATES.md)
- Monitor runs with CLI: [docs/CLI.md](../../docs/CLI.md)
- Scale to multiple hosts: [MULTI_HOST_DISTRIBUTED.md](MULTI_HOST_DISTRIBUTED.md)
