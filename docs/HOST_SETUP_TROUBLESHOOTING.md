# Kaseki Host Setup: Troubleshooting Guide

**Version**: 2.0 (Phase 1-5)  
**Updated**: 2026-06-04  
**Audience**: DevOps engineers, system administrators troubleshooting setup issues

This guide provides diagnosis and remediation for 10+ common failure scenarios in the Kaseki host setup process.

---

## Quick Diagnosis

**Step 1: Run check-only to see current state**

```bash
kaseki-agent host setup --check-only
```

**Step 2: Review output and identify which stage failed**

```
✓ Stage 1: Host Prerequisites
✓ Stage 2: Creating/fixing directories
✗ Stage 3: Normalizing secrets directory  ← FAILED HERE
```

**Step 3: Look up failure scenario below matching your symptoms**

**Step 4: Follow the remediation steps**

---

## Failure Scenarios

### Scenario 1: "permission denied" during Stage 2 (Directory Creation)

**Symptoms**:

```
✗ Error: permission denied when creating /agents
missing: /agents
```

**Root Cause**:

- Not running with sufficient privileges (missing `sudo`)
- /agents already exists with restrictive ownership
- SELinux or AppArmor blocking directory creation

**Diagnosis**:

```bash
# Check current /agents ownership
ls -ld /agents
# Output: drwxr-xr-x 3 root root 4096 Jun 4 10:00 /agents

# Check if we're root
id
# Output: uid=1000(user) gid=1000(user) groups=1000(user)
```

**Remediation**:

**Option 1: Run with sudo**

```bash
sudo kaseki-agent host setup --fix
```

**Option 2: Change /agents ownership to your user (not recommended for production)**

```bash
sudo chown -R $USER:$USER /agents
sudo chmod -R 0755 /agents
./scripts/kaseki-setup-host.sh --fix
```

**Option 3: Check SELinux (if applicable)**

```bash
getenforce
# If output is "Enforcing", check SELinux contexts
ls -ldZ /agents
# Fix if needed: sudo chcon -t admin_home_t /agents
```

---

### Scenario 2: "read-only file system" during Stage 2-4

**Symptoms**:

```
⚠ Stage 2: Creating/fixing directories
warning: directory permissions not updated as expected (actual: 0755, expected: 0775)
(May be on read-only mount)
```

**Root Cause**:

- `/agents` or parent mounted read-only
- Docker read-only file system
- NFS mounted without write permissions
- Immutable file system flag set

**Diagnosis**:

```bash
# Check mount status
mount | grep -E "/agents|/$"
# Output: /dev/sda1 on / type ext4 (ro,relatime)  ← READ-ONLY!

# Check for immutable flag
lsattr -d /agents
# Output: ----i---------- /agents  ← IMMUTABLE!

# Check docker mount info
docker inspect kaseki-api | jq '.[] | .Mounts'
```

**Remediation**:

**Option 1: Remount read-write**

```bash
# If mounted read-only, remount rw
sudo mount -o remount,rw /

# Verify
mount | grep " / "
# Output should show rw, not ro
```

**Option 2: Remove immutable flag**

```bash
sudo chattr -i /agents
sudo chattr -i /agents/*
lsattr -d /agents
# Verify flag is gone
```

**Option 3: Use Docker volume (for containerized setup)**

```bash
# In docker-compose.yml
volumes:
  - /data/agents:/agents:rw  # Use external writable volume
```

---

### Scenario 3: "unknown user" or "unknown group" during Stage 6 (Probe)

**Symptoms**:

```
✗ Stage 6: Checkout freshness probe
checkout-freshness-probe: failed
Checkout freshness probe failed: probe could not impersonate UID:GID 10000:10000
Unknown user "10000" when using privilege tool setpriv
```

**Root Cause**:

- Container UID 10000 doesn't exist in host /etc/passwd
- Privilege tool (setpriv, runuser, sudo) can't find user mapping
- NSS (name service switch) configuration issues
- Container UID mismatch with host

**Diagnosis**:

```bash
# Check if UID 10000 exists in host
id 10000
# Output: id: '10000': no such user  ← MISSING!

# List all users
getent passwd | grep 10000
# (empty output = user doesn't exist)

# Check container's UID in Dockerfile
grep "USER\|uid=" Dockerfile
```

**Remediation**:

**Option 1: Create the user in host** (recommended)

```bash
sudo useradd -u 10000 -s /sbin/nologin -d /nonexistent kaseki-container
# Verify
id 10000
# Output: uid=10000(kaseki-container) gid=10000(kaseki-container)
```

**Option 2: Change container UID to match existing user**

```bash
# Change Dockerfile
FROM node:24-bookworm-slim
RUN useradd -u 1000 -m app
USER 1000  # Use existing user UID

# Rebuild image
docker build -t kaseki-agent:latest .

# Update environment variable
export KASEKI_CONTAINER_UID=1000
export KASEKI_CONTAINER_GID=1000
```

**Option 3: Use numeric UID directly (last resort)**

```bash
# This method doesn't require user to exist
timeout 2 sudo -u "#10000" -g "#10000" git ...
# (Kaseki already does this as fallback)
```

---

### Scenario 4: "dubious ownership" during Stage 5 (Bootstrap)

**Symptoms**:

```
✗ Stage 5: Bootstrap checkout
fatal: detected dubious ownership in repository at '/agents/kaseki-agent'
```

**Root Cause**:

- Git 2.35.2+ requires explicit safe.directory configuration
- Checkout directory owned by different user than current
- Stage 4 (configure git safe.directory) failed or was skipped

**Diagnosis**:

```bash
# Check checkout ownership
ls -ld /agents/kaseki-agent
# Output: drwxr-xr-x 5 root root ...  ← OWNED BY ROOT

# Check current user
id
# Output: uid=10000(kaseki-container) ...  ← RUNNING AS DIFFERENT USER

# Check git safe.directory config
git config --global --list | grep safe.directory
# (empty output = not configured)
```

**Remediation**:

**Option 1: Configure safe.directory** (recommended)

```bash
# Add checkout to safe.directory
git config --global --add safe.directory "/agents/kaseki-agent"

# Verify
git config --global --list | grep safe.directory
# Output: safe.directory=/agents/kaseki-agent

# Test bootstrap again
cd /agents && git clone -b main https://github.com/CyanAutomation/crudmapper kaseki-agent
```

**Option 2: Fix ownership** (more permanent)

```bash
# Change ownership to container UID
sudo chown -R 10000:10000 /agents/kaseki-agent
sudo chmod -R u+rwX /agents/kaseki-agent

# Rerun setup
sudo kaseki-agent host setup --fix
```

**Option 3: Disable git ownership check** (not recommended, security risk)

```bash
git config --global --add safe.directory "*"
```

---

### Scenario 5: "timed out" during Stage 6 (Probe)

**Symptoms**:

```
✗ Stage 6: Checkout freshness probe
checkout-freshness-probe: failed
Checkout freshness probe failed: ... timeout

remediation: If the issue is timeout, try increasing KASEKI_PRIV_TOOL_TIMEOUT.
```

**Root Cause**:

- Privilege tool (setpriv, runuser, sudo) is slow on system
- Virtualization overhead (slow context switching)
- Filesystem is slow (NFS, network storage)
- System under heavy load

**Diagnosis**:

```bash
# Test privilege tool speed
time timeout 2 sudo -u "#10000" git --version
# real    0m0.500s  ← Normal
# real    0m2.100s  ← TIMEOUT RISK!

# Check system load
uptime
# Load average should be < CPU count

# Check filesystem
df -h /agents
# Should NOT be NFS or network mount (unless expected)
```

**Remediation**:

**Option 1: Increase privilege tool timeout** (recommended)

```bash
# Increase timeout from default 2s to 5s
export KASEKI_PRIV_TOOL_TIMEOUT=5
kaseki-agent host setup --check-only

# Or permanently in /etc/environment
echo 'KASEKI_PRIV_TOOL_TIMEOUT=5' | sudo tee -a /etc/environment
```

**Option 2: Optimize filesystem**

```bash
# If using NFS, enable read caching
sudo mount -o remount,readahead=1024 /agents

# If using network storage, move to local disk
sudo mkdir -p /var/lib/kaseki
sudo mount --bind /var/lib/kaseki /agents
```

**Option 3: Reduce system load**

```bash
# Stop unnecessary services
sudo systemctl stop unnecessary-service

# Rerun probe
kaseki-agent host setup --check-only
```

---

### Scenario 6: "missing: /agents/kaseki-agent" during Stage 5 (Bootstrap Not Run)

**Symptoms**:

```
⚠ Stage 5: Bootstrap skipped (probe failed)
remediation: Fix permissions and rerun: sudo kaseki-agent host setup --fix
```

**Root Cause**:

- Stage 6 probe failed (preceding scenarios)
- Bootstrap was skipped as safety measure (Phase 2 conditional execution)
- This is **not an error** — it's designed behavior to prevent bootstrap on failed prerequisites

**Diagnosis**:

```bash
# Check why probe failed
kaseki-agent host setup --check-only | grep -A5 "Stage 6"

# Check if directory exists
ls -ld /agents/kaseki-agent
# missing: error (doesn't exist yet)

# Check parent directory
ls -ld /agents
# Should show permissions and ownership
```

**Remediation**:

**Fix the preceding probe failure first** (see Stage 6 scenarios above), then:

```bash
# Rerun setup with --fix to bootstrap
sudo kaseki-agent host setup --fix

# Verify bootstrap succeeded
ls -la /agents/kaseki-agent
# Should now exist with .git directory
```

---

### Scenario 7: "secret missing" warnings during Stage 3

**Symptoms**:

```
✓ Stage 3: Normalizing secrets directory
✓ secret present: openrouter_api_key
✓ secret present: github_app_id
⚠ secret missing: kaseki_api_keys
⚠ secret missing: github_app_private_key
```

**Root Cause**:

- Required secret files don't exist in `~/.kaseki/secrets/` directory
- Setup script expects files but they're optional (warnings only)
- Secrets may be provided via environment variables instead

**Diagnosis**:

```bash
# List secrets directory
ls -la ~/.kaseki/secrets/
# Output shows which files exist vs. missing

# Check if API keys are set as environment variables instead
env | grep -i kaseki
# (environment variables are alternative to files)
```

**Remediation**:

**Option 1: Create required secret files**

```bash
# Create directory if missing
mkdir -p ~/.kaseki/secrets
chmod 0700 ~/.kaseki/secrets

# Add secret files
echo "sk-or-..." > ~/.kaseki/secrets/openrouter_api_key
chmod 0600 ~/.kaseki/secrets/openrouter_api_key

# Verify
ls -la ~/.kaseki/secrets/
```

**Option 2: Provide secrets via environment variables** (for CI/CD)

```bash
export KASEKI_API_KEYS="sk-or-..."
export OPENROUTER_API_KEY="sk-or-..."
kaseki-agent host setup --check-only
```

**Option 3: Ignore warnings** (if secrets will be provided later)

```bash
# Secrets are optional for host setup
# Just proceed with setup
sudo kaseki-agent host setup --fix
```

---

### Scenario 8: "writable: /agents/kaseki-results" check fails

**Symptoms**:

```
✗ Stage 2: Creating/fixing directories
not writable: /agents/kaseki-results
```

**Root Cause**:

- Directory exists but is not writable by current user
- Directory owned by root but process running as non-root
- Permission mode doesn't include write bit

**Diagnosis**:

```bash
# Check directory permissions
ls -ld /agents/kaseki-results
# Output: drwxr-xr-x (755) — other users can't write

# Check ownership
stat /agents/kaseki-results
# Output: Uid: (0/root), Gid: (0/root)

# Check if we can write
touch /agents/kaseki-results/test.txt 2>&1
# Output: Permission denied
```

**Remediation**:

**Option 1: Fix ownership and permissions** (recommended)

```bash
sudo chown -R 10000:10000 /agents/kaseki-results
sudo chmod -R 0775 /agents/kaseki-results

# Verify
ls -ld /agents/kaseki-results
# Should show: drwxrwxr-x ... 10000 10000
```

**Option 2: Run as root**

```bash
sudo kaseki-agent host setup --fix
```

**Option 3: Use different results directory**

```bash
export KASEKI_RESULTS_DIR=/tmp/kaseki-results
kaseki-agent host setup --fix
```

---

### Scenario 9: Stage 8 Template verification fails

**Symptoms (Template missing)**:

```
✗ Stage 8: Template verification
missing: template runner at /agents/kaseki-template/run-kaseki.sh
remediation: run kaseki-agent host setup --fix
```

**Symptoms (Template not executable)**:

```
✗ Stage 8: Template verification
error: template runner exists but is not executable: /agents/kaseki-template/run-kaseki.sh
remediation: run chmod +x /agents/kaseki-template/run-kaseki.sh
```

**Root Cause**:

- Docker image wasn't fully extracted to /agents/kaseki-template
- Template files corrupted or missing
- run-kaseki.sh lost executable bit (filesystem issue or copy)

**Diagnosis**:

```bash
# Check if directory exists
ls -ld /agents/kaseki-template
# missing: directory doesn't exist
# or: permissions issue

# Check files
ls -la /agents/kaseki-template/
# Should show run-kaseki.sh with -rwxr-xr-x permissions (755)

# Test executability
file /agents/kaseki-template/run-kaseki.sh
# Output: should say "shell script"
```

**Remediation**:

**Option 1: Fix executable bit** (if file exists)

```bash
sudo chmod +x /agents/kaseki-template/run-kaseki.sh
# Rerun setup
kaseki-agent host setup --check-only
```

**Option 2: Recreate template from Docker image**

```bash
# If using Docker locally
docker run --rm -v /agents:/agents kaseki-agent:latest \
  cp -r /kaseki-template/* /agents/kaseki-template/

# Or extract from image manually
docker cp $(docker create kaseki-agent:latest):/kaseki-template /agents/

# Verify
ls -la /agents/kaseki-template/run-kaseki.sh
```

**Option 3: Full reinitialization**

```bash
# Remove corrupted template
sudo rm -rf /agents/kaseki-template

# Rerun setup
sudo kaseki-agent host setup --fix
```

---

### Scenario 10: JSON output validation fails (jq error)

**Symptoms**:

```
error: jq is required but not installed
Attempting to parse setup-results.json fails
```

**Root Cause**:

- jq command-line JSON processor is not installed
- Required for structured JSON output

**Diagnosis**:

```bash
# Check if jq is installed
which jq
# Output: /usr/bin/jq (installed) or nothing (missing)

# Test jq
echo '{}' | jq .
# Should output: {} (success) or error (not installed)
```

**Remediation**:

**Option 1: Install jq** (recommended)

```bash
# On Debian/Ubuntu
sudo apt update && sudo apt install -y jq

# On macOS
brew install jq

# On RHEL/CentOS
sudo yum install -y jq

# Verify
jq --version
```

**Option 2: Continue without JSON output**

```bash
# Kaseki gracefully skips JSON generation if jq missing
# Setup will still work, just without structured output
kaseki-agent host setup --fix
# setup-results.json won't be created, but other output is available
```

---

### Scenario 11: Docker compose exec failures (Stage 9 API Recreation)

**Symptoms**:

```
✗ Stage 9: API container recreation
error: docker-compose command failed
command not found: docker-compose
```

**Root Cause**:

- `docker compose` (new) vs `docker-compose` (old) command confusion
- Docker Compose not installed
- Docker daemon not running
- Insufficient permissions for docker commands

**Diagnosis**:

```bash
# Check docker status
sudo systemctl status docker
# Should be "active (running)"

# Check docker compose version
docker compose version
# Or: docker-compose --version

# Check docker permissions
docker ps
# If error: "permission denied", user not in docker group
```

**Remediation**:

**Option 1: Add user to docker group** (if permission denied)

```bash
sudo usermod -aG docker $USER
# Logout and login for group change to take effect
newgrp docker
docker ps  # Should work now
```

**Option 2: Install Docker Compose** (if not installed)

```bash
# Using docker (preferred)
docker --version
# Should output Docker version with Compose support

# Or install standalone (legacy)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

**Option 3: Start Docker daemon**

```bash
sudo systemctl start docker
# Or check if Docker Desktop is running (macOS/Windows)
```

---

## Advanced Troubleshooting

### Enable Debug Output

```bash
# Show all commands being executed
bash -x scripts/kaseki-setup-host.sh --fix 2>&1 | tee debug.log

# Or with specific environment debug
KASEKI_DEBUG=1 kaseki-agent host setup --fix
```

### Inspect JSON Output Directly

```bash
# View setup results
cat ~/.kaseki/setup-results.json | jq .

# View host state
cat ~/.kaseki/host-state.json | jq .

# Pretty print with colors
cat ~/.kaseki/setup-results.json | jq 'with_entries(.value |= tostring)' | colorize
```

### Manual Privilege Tool Testing

```bash
# Test setpriv directly
timeout 2 setpriv --reuid 10000 --regid 10000 git --version

# Test runuser
timeout 2 runuser -u cassette -g cassette -- git --version

# Test sudo
timeout 2 sudo -u "#10000" -g "#10000" -- git --version

# See which one works (exit code 0 = success)
echo $?  # 0=success, 124=timeout, 1=error
```

### Check Validation Functions

```bash
# Source validation infrastructure directly
source scripts/validation-stages.sh

# Run specific validation
validate_host_prerequisites

# Run container entry check
validate_container_entry all
```

---

## See Also

- [HOST_SETUP_STAGES.md](HOST_SETUP_STAGES.md) — Stage details and execution flow
- [HOST_SETUP_API_REFERENCE.md](HOST_SETUP_API_REFERENCE.md) — JSON schemas & functions
- [QUICK_START.md](QUICK_START.md) — User-facing quick start guide
