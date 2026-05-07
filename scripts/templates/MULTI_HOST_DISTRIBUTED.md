# Multi-Host Distributed Setup

For orchestrating kaseki-agent across multiple Pi or host instances from a controller machine.

**Complexity**: Medium | **Time**: 10-20 minutes per host

---

## Architecture

```
Controller Machine (Mac/Linux)
    ↓
    ├── ssh → Pi Host 1 (kaseki-1 runs here)
    ├── ssh → Pi Host 2 (kaseki-2 runs here)
    └── ssh → Pi Host 3 (kaseki-3 runs here)
```

Each Pi host runs kaseki-agent independently. The controller orchestrates via SSH.

---

## Step 1: Controller Preparation

On your controller machine (Mac, Linux desktop, etc.):

### 1a. Clone kaseki-agent

```bash
git clone https://github.com/CyanAutomation/kaseki-agent.git ~/kaseki-agent
cd ~/kaseki-agent
```

### 1b. Verify SSH Access to Your Hosts

```bash
# Test connectivity to each host
ssh pi@192.168.88.201 "echo 'Pi 1: OK'"
ssh pi@192.168.88.202 "echo 'Pi 2: OK'"
ssh pi@192.168.88.203 "echo 'Pi 3: OK'"

# You should see "Pi 1: OK", "Pi 2: OK", "Pi 3: OK" without password prompts
# (assumes SSH keys are already set up; if not, follow SSH key setup first)
```

### 1c. Prepare Your OpenRouter API Key

```bash
# Option 1: Store the key in a file on your controller
mkdir -p ~/.kaseki/secrets
read -sp 'Enter your OpenRouter API key: ' OPENROUTER_KEY
echo "$OPENROUTER_KEY" > ~/.kaseki/secrets/openrouter_api_key
chmod 600 ~/.kaseki/secrets/openrouter_api_key

# Option 2: Have it as an environment variable (less secure)
export OPENROUTER_API_KEY=sk-or-v1-your-key
```

---

## Step 2: Bootstrap Each Host

For each Pi host, run the remote setup script from your controller:

### Bootstrap Pi Host 1

```bash
./scripts/pi-setup-remote.sh pi@192.168.88.201 ~/.kaseki/secrets/openrouter_api_key
```

Expected output:

```
Setting up pi@192.168.88.201...
SSH check: pi@192.168.88.201 ✓
Creating secrets directory on remote host... ✓
Transferring API key securely... ✓
Running kaseki bootstrap... ✓
Running health check...
Preflight required dependencies: ok (docker)
Preflight optional dependencies: ok (curl, wget, sshpass, git, node, npm)
Docker daemon: running
Kaseki template image: available
✓ Setup complete for pi@192.168.88.201!
```

### Bootstrap Pi Host 2

```bash
./scripts/pi-setup-remote.sh pi@192.168.88.202 ~/.kaseki/secrets/openrouter_api_key
```

### Bootstrap Pi Host 3

```bash
./scripts/pi-setup-remote.sh pi@192.168.88.203 ~/.kaseki/secrets/openrouter_api_key
```

---

## Step 3: Verify All Hosts Are Ready

```bash
# Health check on each host
ssh pi@192.168.88.201 '/agents/kaseki-template/run-kaseki.sh --doctor'
ssh pi@192.168.88.202 '/agents/kaseki-template/run-kaseki.sh --doctor'
ssh pi@192.168.88.203 '/agents/kaseki-template/run-kaseki.sh --doctor'
```

All should output:

```
✓ Setup is ready!
```

---

## Step 4: Run Tasks on Each Host

### Run on Pi Host 1

```bash
ssh pi@192.168.88.201 \
  'OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
   /agents/kaseki-template/run-kaseki.sh \
   https://github.com/your-org/your-repo main'
```

### Run Simultaneously on All Hosts (Background)

```bash
# Start all three hosts in the background
for host in pi@192.168.88.201 pi@192.168.88.202 pi@192.168.88.203; do
  ssh "$host" \
    'OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
     /agents/kaseki-template/run-kaseki.sh \
     https://github.com/your-org/your-repo main' &
done

# Wait for all to complete
wait

echo "All hosts completed!"
```

---

## Step 5: Collect Results

### Retrieve Results from Pi Host 1

```bash
# Copy the results to your controller
scp -r pi@192.168.88.201:/agents/kaseki-results/kaseki-1 ~/results/host1-kaseki-1

# View summary
cat ~/results/host1-kaseki-1/result-summary.md
```

### Retrieve Results from All Hosts

```bash
# Create results directory
mkdir -p ~/kaseki-results

# Copy from each host
for i in 1 2 3; do
  host="192.168.88.20$i"
  scp -r pi@$host:/agents/kaseki-results/kaseki-* \
    ~/kaseki-results/host$i/
done

# View all summaries
ls -la ~/kaseki-results/
```

---

## Advanced: Using kaseki-activate.sh for Controller Mode

If you prefer using `kaseki-activate.sh` commands for more control:

### Remote Activation on Pi Host

```bash
# Run via kaseki-activate.sh (alternative to run-kaseki.sh)
ssh pi@192.168.88.201 \
  'OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
   /agents/kaseki-template/scripts/kaseki-activate.sh run \
   https://github.com/your-org/your-repo main'
```

### Get JSON Status

```bash
# Get status as JSON for parsing
ssh pi@192.168.88.201 \
  '/agents/kaseki-template/scripts/kaseki-activate.sh \
   --json doctor'
```

---

## Monitoring Runs in Progress

### From Controller, Monitor a Remote Run

```bash
# Stream the progress log
ssh pi@192.168.88.201 'tail -f /agents/kaseki-results/kaseki-1/progress.log'

# Or use kaseki-cli on the remote host
ssh pi@192.168.88.201 \
  '/agents/kaseki-template/kaseki-cli.js watch kaseki-1'
```

---

## Load Balancing (Optional)

To distribute tasks across hosts:

```bash
#!/bin/bash
hosts=(
  "pi@192.168.88.201"
  "pi@192.168.88.202"
  "pi@192.168.88.203"
)

# Round-robin assignment
counter=0
for task in task1 task2 task3 task4 task5; do
  host=${hosts[$((counter % ${#hosts[@]}))]
  
  ssh "$host" \
    'OPENROUTER_API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key \
     /agents/kaseki-template/run-kaseki.sh \
     https://github.com/your-org/your-repo main' &
  
  ((counter++))
done

wait
```

---

## Troubleshooting

### "Permission denied (publickey)"

SSH authentication failed. Set up SSH keys:

```bash
# On your controller (if not already done)
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519

# Copy public key to each Pi host
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.88.201
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.88.202
ssh-copy-id -i ~/.ssh/id_ed25519.pub pi@192.168.88.203

# Test
ssh pi@192.168.88.201 "echo OK"
```

### "Docker daemon not running" on Remote Host

```bash
ssh pi@192.168.88.201 'sudo systemctl start docker'
```

### Bootstrap Script Hangs

If `pi-setup-remote.sh` hangs, check SSH connectivity and available disk space on the remote host:

```bash
ssh pi@192.168.88.201 'df -h'
ssh pi@192.168.88.201 'free -h'
```

### Results Directory Full on Remote

Clean up old runs:

```bash
ssh pi@192.168.88.201 \
  '/agents/kaseki-template/scripts/cleanup-kaseki.sh --keep 5'
```

---

## Convenience: Create a Management Script

Save as `~/kaseki-management.sh`:

```bash
#!/bin/bash

HOSTS=(
  "pi@192.168.88.201"
  "pi@192.168.88.202"
  "pi@192.168.88.203"
)

API_KEY_FILE=~/.kaseki/secrets/openrouter_api_key
REPO_URL="${1:-https://github.com/your-org/your-repo}"
GIT_REF="${2:-main}"

echo "Running kaseki-agent on all hosts for $REPO_URL @ $GIT_REF..."

for host in "${HOSTS[@]}"; do
  echo "Starting run on $host..."
  ssh "$host" \
    "OPENROUTER_API_KEY_FILE=$API_KEY_FILE \
     /agents/kaseki-template/run-kaseki.sh $REPO_URL $GIT_REF" &
done

wait
echo "All runs completed!"
```

Use:

```bash
bash ~/kaseki-management.sh https://github.com/org/repo main
```

---

## Next Steps

- Understand quality gates: [docs/QUALITY_GATES.md](../../docs/QUALITY_GATES.md)
- Learn task prompts: [docs/TASK_PROMPT_TEMPLATES.md](../../docs/TASK_PROMPT_TEMPLATES.md)
- Set up the REST API: [REST_API_SERVICE.md](REST_API_SERVICE.md)
- Scale to production: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)
