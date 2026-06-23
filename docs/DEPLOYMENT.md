# Kaseki Agent API Service - Deployment Guide

## Overview

The Kaseki API Service allows remote execution and monitoring of kaseki-agent runs via HTTP REST API.

**Authoritative deployment mode: Docker container runtime** (docker-compose, systemd+docker, or manual `docker run`). Host Node.js process mode is fallback/dev-only and is not the production reference path.

## 🚀 Docker Compose Quick Start

**Before deploying**, ensure the host `/agents` directory exists with correct permissions:

```bash
# 1. Create /agents on the host with UID 10000 ownership
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# 2. (Optional) Validate setup with pre-flight checks
./scripts/kaseki-preflight-docker-compose.sh

# 3. Create secrets directory with correct ownership for UID 10000
sudo mkdir -p /agents/secrets

sudo tee /agents/secrets/openrouter_api_key >/dev/null <<'EOF'
REPLACE_WITH_YOUR_OPENROUTER_API_KEY
EOF

sudo tee /agents/secrets/kaseki_api_keys >/dev/null <<'EOF'
REPLACE_WITH_YOUR_KASEKI_API_KEY
EOF

sudo chown -R 10000:10000 /agents/secrets
sudo chmod 700 /agents/secrets
sudo chmod 600 /agents/secrets/*

# 4. Deploy the API service
docker-compose up -d

# 5. Monitor startup (should complete without permission errors)
docker-compose logs -f kaseki-api
```

**Why the `/agents` prerequisite?** The container runs as UID 10000 (non-root hardening). During startup, it validates that `/agents` is writable by this UID. Without correct ownership:

- Startup checks will fail (exit code 2)
- Container will exit and Docker Compose will restart it (restart loop)
- You'll see: `✗ /agents exists but is not writable by UID 10000`

See [Troubleshooting Startup Failures](#troubleshooting-startup-failures) for diagnosis if issues persist.

## Prerequisites

- Docker + Docker Compose (for docker-compose deployment)
- Host `/agents` directory with UID 10000 ownership (see Docker Compose Quick Start above)
- Node.js ≥ 24.x (for Node.js fallback deployment only)
- OpenRouter API key for Pi agent invocation (inherited from kaseki-agent)

## Volume Mounts & Directory Structure

The kaseki-api service uses a persistent host volume to store run artifacts and spawn ephemeral worker containers.

### Volume Mount Requirement

When deploying the API container, mount the host's `/agents`
directory as read-write:

```yaml
volumes:
  - /agents:/agents:rw                    # Host → Container bridge
  - /var/run/docker.sock:/var/run/docker.sock
```

The container will **automatically create** the required
subdirectories:

- `/agents/kaseki-results/` — Persistent run artifacts (metadata,
  diffs, logs)
  - **Auto-created** on API startup (no pre-setup needed)
  - Contains per-run subdirectories: `kaseki-1/`, `kaseki-2/`, …
  - Written to by the API service and spawned worker containers

- `/agents/kaseki-runs/` — Per-run workspace directories (cloned
  repos, node_modules)
  - Created by ephemeral worker containers (not used by API service
  itself)
  - Cleaned up after each run (if `KASEKI_KEEP_WORKSPACE=0`, the
  default)

- `/agents/kaseki-cache/` — Optional dependency cache (npm packages)
  - Created by worker containers if `KASEKI_CACHE_ENABLED=1`
  - Speeds up repeated runs by sharing npm dependencies across
  instances

### Docker User & Permissions

The container runs as **UID 10000** (kaseki user, non-root):

```yaml
user: "10000:10000"  # Consistent across API service, kaseki-agent,
                     # and docker-compose
```

**Important:** This UID (10000) is chosen to avoid conflicts with reserved system UIDs (GID 1000 is already taken by www-data in the base image). The UID must match the container image build (Dockerfile) and docker-compose configuration to avoid permission errors.

**Critical:** Ensure the host `/agents` directory is owned by UID 10000:

```bash
# Before docker-compose up -d, run on the host:
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# Verify:
ls -ld /agents  # Should show: drwxr-xr-x 2 10000 10000 ...
```

## Troubleshooting Startup Failures

### Symptom: Container repeatedly restarts with permission errors

**Logs show:**

```
✗ /agents exists but is not writable by UID 10000
✗ Fix: Run on host: sudo chown 10000:10000 /agents
⚠ Some warnings detected; continuing anyway
```

**Cause:** The host `/agents` directory is owned by root or another user, not UID 10000.

**Fix:**

```bash
# On the host (not in container):
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# Restart the container:
docker-compose down
docker-compose up -d

# Monitor:
docker-compose logs -f kaseki-api
```

### Symptom: Container startup warnings in logs

**Logs show:**

```
⚠️ Container preflight diagnostics completed with X warning(s):
  • git-freshness: FAIL — Permission denied
  → Remediation: Fix permissions: sudo chown -R 10000:10000 /agents
  
  • git-safe-directory: FAIL — Git safe.directory not configured
  → Remediation: Configure: git config --global --add safe.directory /agents/kaseki-agent

The API will continue to start. See /api/preflight for full details.
```

**Cause:** These are **non-blocking warnings** from container startup diagnostics. They indicate that:

1. **Setup completeness issue**: `sudo kaseki-agent host setup --fix` may not have run, or permissions have drifted since then
2. **Setup staleness issue**: Git configuration or permissions need refreshing

The container startup diagnostics automatically check for these conditions and log warnings **without blocking the API from starting**. This allows the API to serve requests while you remediate background issues.

**Fix:** Run the host setup command to resolve all warnings:

```bash
# On the host (not in container):
sudo kaseki-agent host setup --fix --recreate-api

# Or if you don't have the CLI installed:
cd /path/to/kaseki-agent && sudo ./scripts/kaseki-setup-host.sh --fix --recreate-api
```

**Verify fix:** After remediation, restart the container and check logs for "All container preflight checks passed":

```bash
docker-compose down
docker-compose up -d

# Check for success message:
docker-compose logs kaseki-api | grep "preflight"
```

**For programmatic access:** Call the `/api/preflight` endpoint to see full diagnostic details:

```bash
curl -H "Authorization: Bearer $KASEKI_API_KEY" http://localhost:8080/api/preflight | jq '.containerStartup'
```

The `containerStartup` section is cached startup history (`scope: "startup"`, `current: false`) and is excluded from the endpoint's current readiness status. Use the top-level `checks` and `timestamp` for current `/api/preflight` readiness.

### Symptom: "Could not create /agents/kaseki-template"

**Logs show:**

```
⚠ Could not create /agents/kaseki-template (will try later)
⚠ Bootstrap incomplete: run-kaseki.sh missing at /agents/kaseki-template/run-kaseki.sh
ℹ   (This is normal on first startup; will be auto-initialized by API service)
```

**Cause:** This is **normal** on first startup. The API service will auto-initialize the template once it starts. If this warning persists after the API service finishes starting, check permissions.

**Verify fix:** After API service finishes starting, confirm the template was initialized:

```bash
ls -la /agents/kaseki-template/run-kaseki.sh  # Should exist
docker-compose logs kaseki-api | grep "Template initialized"
```

### Symptom: Permission denied errors in validation logs

**Logs show:**

```
✓ /agents is writable by UID 10000
⚠ Bootstrap incomplete
✗ Validation phase failed: Permission denied writing to /agents/kaseki-results
```

**Cause:** Some subdirectories have incorrect ownership (inherited from root).

**Fix:**

```bash
# Recursively fix all subdirectories:
sudo chown -R 10000:10000 /agents
sudo chmod -R 755 /agents

# Restart:
docker-compose down
docker-compose up -d
```

### Dockhand/Portainer Deployment

When deploying via a container management UI (Dockhand, Portainer), you have two approaches:

#### **Approach 1: Automatic Fix via Init Container (Recommended)**

Modern kaseki-agent versions include an init container that automatically attempts to fix `/agents` permissions before the API service starts.

**Steps:**

1. In Portainer/Dockhand UI, deploy the docker-compose stack as-is
2. API service starts and runs startup-checks to validate `/agents` and secrets
3. If checks fail, the logs will show a clear error with the fix command

**To verify success:**

```bash
docker-compose logs kaseki-api    # API service logs
```

#### **Approach 2: Manual Host Setup (If Init Container Fails)**

If your environment is too restricted (read-only volumes, no permission escalation), manually pre-create `/agents` on the host:

**Steps:**

1. **SSH into the Dockhand/Portainer host** (the machine running Docker)

2. **Create the directory with correct ownership:**

   ```bash
   sudo mkdir -p /agents
   sudo chown 10000:10000 /agents
   sudo chmod 755 /agents
   
   # Verify:
   ls -ld /agents  # Should show: drwxr-xr-x 10000 10000
   ```

3. **In Portainer/Dockhand UI:**
   - Deploy or restart the kaseki-agent stack
   - The API service should now start without permission errors

4. **Verify deployment:**

   ```bash
   # On the host, check that subdirectories were auto-created
   ls -la /agents/
   # Should show: kaseki-template/, kaseki-results/, kaseki-runs/
   
   # Or via curl from within the container:
   curl -H "Authorization: Bearer $KASEKI_API_KEYS" \
     http://localhost:8080/api/preflight
   ```

#### **Troubleshooting Init Container Failures**

If you see init container logs like:

```
✗ /agents exists but is not writable by container
✗ Fix: Run on host: sudo chown 10000:10000 /agents
```

This is expected in read-only or restricted volume scenarios. Proceed with **Approach 2** (manual host setup) above.

**Common causes:**

- Host `/agents` owned by `root` or a different UID
- Volume mounted as read-only
- Filesystem doesn't support permission changes (e.g., NFS with no_root_squash)
- Container platform doesn't allow permission escalation

See [Kubernetes Deployment](#kubernetes-deployment) if using Kubernetes instead of Docker Compose.

## Bootstrap Requirement

**⚠️ Critical:** Before starting the Kaseki API service, you MUST run the bootstrap process on the host. This extracts the run-kaseki.sh script and other deployment files from the Docker image to the host filesystem.

### Bootstrap Checklist

**Step 1: Run Bootstrap**

```bash
# From the kaseki-agent repository directory
./scripts/kaseki-activate.sh --controller bootstrap
```

This command:

- Clones the kaseki-agent repository to `/agents/kaseki-agent`
- Extracts the Docker image to `/agents/kaseki-template/`
- Verifies all critical files are present
- Runs a health check via `/agents/kaseki-template/run-kaseki.sh --doctor`

**Step 2: Verify Bootstrap Completed Successfully**

Check for the critical file:

```bash
# Must exist and be executable
ls -la /agents/kaseki-template/run-kaseki.sh

# Check status
./scripts/kaseki-activate.sh status
```

**Step 3: Fix Common Bootstrap Issues**

| Error | Remediation |
|-------|-------------|
| `mkdir: cannot create directory '/agents'` | Run as root or ensure `/agents` exists: `sudo mkdir -p /agents && sudo chown $USER:$USER /agents` |
| `Docker image not found` | Pull image first: `docker pull docker.io/cyanautomation/kaseki-agent:latest` |
| `run-kaseki.sh not found after bootstrap` | Image may be corrupted; try: `docker pull --no-cache docker.io/cyanautomation/kaseki-agent:latest` and re-run bootstrap |
| `/api/runs` returns 400 "bootstrap not complete" | File is missing; run bootstrap again |

**Step 4: Start the API Service**

Only after bootstrap verification passes, start the API service:

```bash
docker-compose up -d
```

If the API starts before bootstrap, it will log a warning but continue running. Job submissions will fail with a 400 error until bootstrap is complete. Restart the API after bootstrap:

```bash
docker-compose restart kaseki-api
```

## Quick Start

### ✅ Recommended: Docker Compose

```bash
# Navigate to kaseki-agent repository
cd /agents/kaseki-template

# Set API key
export KASEKI_API_KEYS=sk-your-secret-key-here

# Build image from this repo
docker build -t kaseki-agent:node24-local .

# Start services (uses KASEKI_API_IMAGE, default:
# kaseki-agent:node24-local)
docker-compose up -d

# View logs
docker-compose logs -f kaseki-api

# Stop services
docker-compose down
```

On a fresh host, run the host setup helper before starting the API, or any time
`/api/preflight` reports missing results/template directories:

```bash
sudo npm install -g @cyanautomation/kaseki-agent@latest
sudo kaseki-agent host setup --fix --recreate-api --wait-ready
```

The API container runs as the `/agents` owner by default
(`10000:10000`) and must also be able to use the host Docker socket
so it can launch ephemeral `kaseki-N` containers. Set `DOCKER_GID`
to the group owner of `/var/run/docker.sock`:

```bash
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
docker-compose up -d
```

In Dockhand, Portainer, or another compose manager, keep the same
shape:

```yaml
services:
  kaseki-api:
    user: "10000:10000"
    group_add:
      - "${DOCKER_GID:-985}"
    volumes:
      - /agents:/agents:rw
      - /var/run/docker.sock:/var/run/docker.sock
```

After deployment, verify controller readiness with the
authenticated preflight endpoint:

```bash
sudo kaseki-agent host preflight
```

Use `/ready` and authenticated `/api/preflight` for readiness. Docker health is
useful, but preflight explains host path, secret, Docker socket, template, and
worker-container problems directly.

## Secret File Setup

Kaseki Agent reads all secrets from host-based files instead of environment variables. This improves security by separating secrets from configuration.

> **Docker deployments:** Always use `/agents/secrets` as the canonical secret directory. The Docker Compose configuration mounts `/agents:/agents:rw`, so `/agents/secrets` is accessible inside the container. The `~/secrets` path is supported only for non-Docker (host Node.js) deployments and is **not** reliably mounted into containers.

### Multi-Path Secret Resolution

Secrets are resolved from the host filesystem in this priority order:

1. **Discovered path** (from `.kaseki/host-state.json`): When you run `kaseki-agent host setup`, it records where it normalized your secrets to a state file (`~/.kaseki/host-state.json`). Preflight commands discover and use this path automatically.
2. **Explicit environment variable**: `$KASEKI_SECRETS_DIR` (highest priority override)
3. **SUDO_USER home fallback**: `~/secrets/{secret-name}` (non-Docker only; when running with sudo)
4. **Container default**: `/agents/secrets/{secret-name}` (canonical Docker path; used when no state file exists)

**Recommended workflow**:

1. Run `sudo kaseki-agent host setup --fix` once during initial setup
2. This normalizes secrets and creates `.kaseki/host-state.json`
3. Subsequent `sudo kaseki-agent host preflight` calls automatically use the discovered path
4. If you need to override, use `KASEKI_SECRETS_DIR=/custom/path` before any kaseki commands

The system will check each location in order and use the first that contains the secret.

### State File

When you run `sudo kaseki-agent host setup --fix`, it creates:

```
~/.kaseki/host-state.json
```

> **Note on `sudo` and home directory:** When you run a command with `sudo`, the shell's `~` expands to the **effective user's** home directory. Depending on your `sudo` configuration and shell settings, `~` may resolve to `/root` (if `sudo` drops to root) or `/home/pi` (if `sudo -E` preserves the environment). If you are unsure, check `echo ~` before and after `sudo` to confirm where the state file is written. Docker deployments should use `/agents/secrets` directly to avoid this ambiguity.

This file (created with 0644 permissions) records where setup normalized your secrets:

```json
{
  "normalized_secrets_dir": "/home/pi/secrets",
  "timestamp": "2026-05-16T12:34:56Z",
  "version": "2",
  "checkout_freshness_probe": {
    "status": "ok",
    "detail": "Checkout freshness probe passed for /agents/kaseki-agent as UID:GID 10000:10000.",
    "remediation": "",
    "checkout_dir": "/agents/kaseki-agent",
    "uid": "10000",
    "gid": "10000"
  }
}
```

**What it does**: Preflight commands read this file to find where setup put your secrets, eliminating guesswork about secret locations between setup and preflight runs.

**Checkout freshness note**: A successful `host setup --fix` is necessary but not sufficient for freshness enforcement. Runtime preflight still needs read access to `/agents/kaseki-agent/.git` as the service UID/GID (default `10000:10000`). If ownership or permissions drift after setup, preflight will report the contextualized failure recorded in host state and suggest remediation.

**Checkout freshness troubleshooting**:

- If the probe fails with git metadata/readability signals (for example `permission denied`, `not a git repository`, or inaccessible `.git`), remediation remains ownership/permission focused.
- If the probe fails with identity-switch/tooling signals (for example unknown user/group or `sudo`/`runuser` invocation errors), remediation will explicitly indicate that the host could not impersonate UID:GID `10000:10000` and instruct you to configure a valid impersonation method (or passwd/group mapping) before rerunning setup.

**Important**: Do not manually edit or delete this file unless you're resetting your setup. If you change where secrets are stored, rerun `sudo kaseki-agent host setup --fix` to update it.

### Required Secret Files

Create these files on your host machine:

#### 1. OpenRouter API Key (Required)

File: `/agents/secrets/openrouter_api_key`

> **Docker deployments:** Use `/agents/secrets` (mounted via `/agents:/agents:rw`). The `~/secrets` path is for non-Docker (host Node.js) deployments only.

```bash
# Get your API key from: https://openrouter.ai/keys

sudo mkdir -p /agents/secrets

sudo tee /agents/secrets/openrouter_api_key >/dev/null <<'EOF'
sk-or-your-actual-key
EOF

sudo chown -R 10000:10000 /agents/secrets
sudo chmod 700 /agents/secrets
sudo chmod 600 /agents/secrets/openrouter_api_key

# Verify (without exposing the key in terminal history)
sudo test -s /agents/secrets/openrouter_api_key && echo "OpenRouter key exists"
```

#### 2. Kaseki API Keys (Required)

File: `/agents/secrets/kaseki_api_keys`

> **Docker deployments:** Use `/agents/secrets` (mounted via `/agents:/agents:rw`). The `~/secrets` path is for non-Docker (host Node.js) deployments only.

Format: One API key per line (newline-separated). Comment lines
starting with `#` are ignored.

```bash
sudo mkdir -p /agents/secrets

sudo tee /agents/secrets/kaseki_api_keys >/dev/null <<'EOF'
# Kaseki API Keys
sk-api-key-1
sk-api-key-2
sk-api-key-3
EOF

sudo chown -R 10000:10000 /agents/secrets
sudo chmod 700 /agents/secrets
sudo chmod 600 /agents/secrets/kaseki_api_keys

# Verify (without exposing keys in terminal history)
sudo test -s /agents/secrets/kaseki_api_keys && echo "Kaseki API keys exist"
```

#### 3. GitHub App Credentials (Optional, for PR creation)

If you want to enable GitHub App authentication for PR creation,
create these files in `/agents/secrets`:

> **Docker deployments:** Use `/agents/secrets` (mounted via `/agents:/agents:rw`). The `~/secrets` path is for non-Docker (host Node.js) deployments only.

```bash
sudo mkdir -p /agents/secrets

# GitHub App ID (numeric)
sudo tee /agents/secrets/github_app_id >/dev/null <<'EOF'
123456
EOF

# OAuth Client ID
sudo tee /agents/secrets/github_app_client_id >/dev/null <<'EOF'
Iv1.abcdef...
EOF

# PEM private key
sudo cp your-private-key.pem /agents/secrets/github_app_private_key

sudo chown -R 10000:10000 /agents/secrets
sudo chmod 700 /agents/secrets
sudo chmod 600 /agents/secrets/github_app_id \
               /agents/secrets/github_app_client_id \
               /agents/secrets/github_app_private_key
```

### GitHub App Credential Auto-Detection

GitHub App credentials are now **enabled by default** if available.
Kaseki Agent automatically searches for credentials in multiple
locations, reducing setup friction:

**Search Order (by priority):**

1. **Environment variables** (highest priority)
   - `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
     `GITHUB_APP_PRIVATE_KEY`

2. **Standard secret paths**
   - `/agents/secrets/github_app_*`
   - `~/secrets/github_app_*`

3. **Convenience auto-detect locations** (private key only)
   - `~/.ssh/github-app-private-key` — SSH directory for easy
     key management
   - `$PWD/.github-app-secrets/private-key` — Workspace-local
     secrets
   - `/etc/kaseki-secrets/github_app_private_key` — System-wide
     secrets

**Examples:**

Option 1 — Use standard paths (recommended):

```bash
sudo mkdir -p /agents/secrets

sudo tee /agents/secrets/github_app_id >/dev/null <<'EOF'
123456
EOF

sudo tee /agents/secrets/github_app_client_id >/dev/null <<'EOF'
Iv1.abc...
EOF

sudo cp your-key.pem /agents/secrets/github_app_private_key
sudo chown -R 10000:10000 /agents/secrets
sudo chmod 600 /agents/secrets/github_app_*
```

Option 2 — Use SSH directory (convenient for development):

```bash
mkdir -p ~/.ssh
cat your-key.pem > ~/.ssh/github-app-private-key
chmod 600 ~/.ssh/github-app-private-key
# Still need ID and Client ID in env vars or standard paths
export GITHUB_APP_ID="123456"
export GITHUB_APP_CLIENT_ID="Iv1.abc..."
```

Option 3 — Disable auto-detection (explicit control):

```bash
export GITHUB_APP_ENABLED=0  # Skips GitHub operations entirely
```

**Behavior by Mode:**

- `KASEKI_PUBLISH_MODE=pr` (default) — Creates a normal pull request; requires
  all 3 GitHub credentials, fails with exit code 7 if missing
- `KASEKI_PUBLISH_MODE=draft_pr` — Creates a draft PR for review; requires
  all 3 credentials, fails with exit code 7 if missing
- `KASEKI_PUBLISH_MODE=branch` — Pushes to a branch without creating a PR; requires
  all 3 credentials, fails with exit code 7 if missing
- `KASEKI_PUBLISH_MODE=auto` (legacy) — Enables GitHub ops if all
  3 credentials found; gracefully skips if missing
- `KASEKI_PUBLISH_MODE=none` — Always skips GitHub operations
  (ignores credentials)

### Verification

**Step 1: Verify host-side permissions**

```bash
# Check ownership and permissions
sudo ls -la /agents/secrets/
# Expected: drwx------ 10000 10000 /agents/secrets
# Expected: -rw------- 10000 10000 /agents/secrets/openrouter_api_key
# Expected: -rw------- 10000 10000 /agents/secrets/kaseki_api_keys

# Confirm files are non-empty (without exposing secret values)
sudo test -s /agents/secrets/openrouter_api_key && \
  echo "✓ OpenRouter key found" || echo "✗ OpenRouter key missing"
sudo test -s /agents/secrets/kaseki_api_keys && \
  echo "✓ API keys found" || echo "✗ API keys missing"
```

**Step 2: Verify container readability**

After secrets are in place, confirm that the container (running as UID 10000) can read the files:

```bash
docker compose run --rm --entrypoint sh kaseki-api -lc '
  id
  ls -la /agents/secrets
  test -s /agents/secrets/openrouter_api_key && echo "OpenRouter key readable"
  test -s /agents/secrets/kaseki_api_keys && echo "API keys readable"
'
# Expected output:
#   uid=10000(kaseki) gid=10000(kaseki) groups=10000(kaseki),...
#   total ...
#   drwx------  ... 10000 10000 ...  .
#   -rw-------  ... 10000 10000 ...  kaseki_api_keys
#   -rw-------  ... 10000 10000 ...  openrouter_api_key
#   OpenRouter key readable
#   API keys readable
```

This immediately catches UID mismatches, missing mounts, incorrect permissions, and missing files.

**Step 3: Verify via API preflight**

After starting the API container, verify with the preflight endpoint:

```bash
curl -H "Authorization: Bearer sk-api-key-1" \
  http://localhost:8080/api/preflight | \
  jq '.checks[] | select(.name == "openrouter-key")'
```

Should return:

```json
{
  "name": "openrouter-key",
  "ok": true,
  "detail": "OpenRouter API key is available from host secrets."
}
```

### Troubleshooting Secrets Not Found

**Symptom**: `kaseki-agent host preflight` fails with "Could not read kaseki_api_keys from host secrets"

**Solution Steps**:

1. **Check the state file** (created by setup):

   ```bash
   sudo cat ~/.kaseki/host-state.json
   # Should show: { "normalized_secrets_dir": "/home/pi/secrets", ... }
   ```

2. **If state file doesn't exist**, re-run setup to create it:

   ```bash
   sudo kaseki-agent host setup --fix
   # This creates ~/.kaseki/host-state.json and normalizes secrets
   ```

3. **Verify secrets exist** at the discovered location:

   ```bash
   # Replace /home/pi with your actual home from the state file
   sudo ls -la /home/pi/secrets/
   sudo test -f /home/pi/secrets/kaseki_api_keys && echo "✓ Found" || echo "✗ Missing"
   ```

4. **If using a custom secrets path**:

   ```bash
   # Re-run setup with the custom path
   sudo KASEKI_HOST_SECRETS_DIR=/custom/path kaseki-agent host setup --fix
   # Then preflight will find it via the updated state file
   ```

5. **If secrets are in `/agents/secrets` but preflight checks elsewhere**:

   ```bash
   # Force preflight to use the correct path
   sudo KASEKI_SECRETS_DIR=/agents/secrets kaseki-agent host preflight
   ```

**Debug Mode**: Enable logging to see where preflight is checking:

```bash
sudo KASEKI_DEBUG=1 kaseki-agent host preflight
# Will show: "Discovered secrets directory from setup: /home/pi/secrets"
```

---

## Configuration

**Configuration** (via environment variables):

```bash
# Secrets (read from files, see "Secret File Setup" section)
# Kaseki API keys are read from /agents/secrets/kaseki_api_keys or ~/secrets/kaseki_api_keys
OPENROUTER_API_KEY_FILE=/agents/secrets/openrouter_api_key # Path to OpenRouter key
GITHUB_APP_ID_FILE=/agents/secrets/github_app_id           # Optional: Path to GitHub App ID
GITHUB_APP_CLIENT_ID_FILE=/agents/secrets/github_app_client_id   # Optional
GITHUB_APP_PRIVATE_KEY_FILE=/agents/secrets/github_app_private_key # Optional

# Core settings
KASEKI_API_PORT=8080                        # API listen port (default: 8080)
KASEKI_API_LOG_LEVEL=info                  # Log level: debug/info/warn/error
KASEKI_API_IMAGE=kaseki-agent:node24-local # Must be built from
                                            # this repo's Dockerfile
KASEKI_TEMPLATE_DOCTOR_TIMEOUT_MS=15000    # Pi-safe template doctor timeout

# Performance
KASEKI_API_MAX_CONCURRENT_RUNS=3           # Max concurrent jobs (default: 3)
KASEKI_AGENT_TIMEOUT_SECONDS=1200          # Agent timeout in seconds (default: 20 min)
KASEKI_MAX_DIFF_BYTES=200000               # Max diff size (default: 200 KB)

# Paths (usually inherited from docker-compose)
KASEKI_RESULTS_DIR=/agents/kaseki-results
KASEKI_API_LOG_DIR=/var/log/kaseki-api
```

**Note on secrets:** Kaseki API keys are read from the fixed host-secret locations. For Docker deployments, the canonical path is `/agents/secrets/kaseki_api_keys`; the `~/secrets/kaseki_api_keys` fallback is for non-Docker (host Node.js) deployments only. Other supported secret file variables are optional if their files are in `/agents/secrets/`; set them only for non-standard locations.

### LLM Provider Configuration

Kaseki Agent uses a two-tier LLM provider system:

1. **Primary Provider** (selected via `KASEKI_PROVIDER`):
   - `gateway` (default): LLM Gateway for all agent runs
   - `openrouter`: OpenRouter for all agent runs

2. **Fallback Provider**: OpenRouter is always validated during startup as a backup, regardless of primary selection

**Provider Selection & Startup Behavior:**

When the API service starts, it logs the active LLM provider:

```
ℹ Active LLM provider: gateway (with OpenRouter fallback)
```

Startup checks are organized by category:

- **Primary LLM Provider** — validates the active provider (gateway or openrouter)
- **Fallback LLM Provider** — always validates OpenRouter availability
- **GitHub Integration** — separate from provider choice
- **Platform Infrastructure** — /agents paths, git config

**Configuration Examples:**

**Using Gateway (recommended, default):**

```bash
# docker-compose.yml or .env
KASEKI_PROVIDER=gateway
LLM_GATEWAY_URL=https://gateway.example.com/v1
LLM_GATEWAY_API_KEY_FILE=/agents/secrets/llm_gateway_api_key

# Also configure OpenRouter as optional fallback
OPENROUTER_API_KEY_FILE=/agents/secrets/openrouter_api_key
```

Then set up secrets:

```bash
sudo tee /agents/secrets/llm_gateway_api_key >/dev/null <<'EOF'
your-gateway-api-key-here
EOF

sudo tee /agents/secrets/openrouter_api_key >/dev/null <<'EOF'
your-openrouter-api-key-here
EOF

sudo chown 10000:10000 /agents/secrets/llm_gateway_api_key /agents/secrets/openrouter_api_key
sudo chmod 600 /agents/secrets/llm_gateway_api_key /agents/secrets/openrouter_api_key
```

**Using OpenRouter:**

```bash
# docker-compose.yml or .env
KASEKI_PROVIDER=openrouter
OPENROUTER_API_KEY_FILE=/agents/secrets/openrouter_api_key

# Optionally keep Gateway configured for reference/fallback testing
LLM_GATEWAY_URL=https://gateway.example.com/v1
LLM_GATEWAY_API_KEY_FILE=/agents/secrets/llm_gateway_api_key
```

**Startup Log Example (Gateway Primary):**

```
ℹ Active LLM provider: gateway (with OpenRouter fallback)

ℹ Checking primary LLM provider...
✓ LLM_GATEWAY_URL is set
✓ Gateway API key found and readable: /run/secrets/kaseki/llm_gateway_api_key
✓ Pi provider registration verified

ℹ Checking fallback LLM provider (OpenRouter)...
✓ OpenRouter API key found and readable: /run/secrets/kaseki/openrouter_api_key

ℹ Checking GitHub integration...
✓ GitHub App credentials found
```

---

## Fallback Deployment Options

### Option 1: Node.js Process (Fallback)

Quick alternative if Docker/docker-compose is unavailable:

```bash
cd /agents/kaseki-template

# Install dependencies (lockfile-enforced)
npm ci --omit=dev

# Verify runtime
node -v  # Must report v24.x or newer

# Start API
KASEKI_API_KEYS=sk-dev-key npm run kaseki-api
```

**Environment variables:**

```bash
# Secrets (must be set up in host files first, see "Secret File Setup" section)
# Kaseki API keys are read from /agents/secrets/kaseki_api_keys or ~/secrets/kaseki_api_keys
OPENROUTER_API_KEY_FILE=/agents/secrets/openrouter_api_key # Path to OpenRouter key
GITHUB_APP_ID_FILE=/agents/secrets/github_app_id           # Optional
GITHUB_APP_CLIENT_ID_FILE=/agents/secrets/github_app_client_id    # Optional
GASEKI_APP_PRIVATE_KEY_FILE=/agents/secrets/github_app_private_key # Optional

# Core settings
KASEKI_API_PORT=8080                        # Default: 8080
KASEKI_API_LOG_LEVEL=info                  # Default: info
KASEKI_API_MAX_CONCURRENT_RUNS=3           # Default: 3
KASEKI_AGENT_TIMEOUT_SECONDS=1200          # Default: 1200
KASEKI_MAX_DIFF_BYTES=200000               # Default: 200000
```

**Production considerations:**

- Use a process manager (systemd, supervisor, PM2) for restart/recovery
- Run with `NODE_ENV=production` for optimal performance
- Monitor logs and uptime independently

### Option 2: systemd Service (Alternative)

Deploy as a systemd service on the host (advanced):

```bash
# 1. Build image from this repository
cd /agents/kaseki-template
npm ci --omit=dev
npm run build
docker build -t kaseki-agent:node24-local .

# 2. (Registry workflow) push/pull image before service restart
# docker tag kaseki-agent:node24-local registry.example.com/kaseki-agent:node24-2026-05-03
# docker push registry.example.com/kaseki-agent:node24-2026-05-03
# On target host: docker pull registry.example.com/kaseki-agent:node24-2026-05-03

# 3. Install systemd service (Docker mode only)
sudo cp scripts/kaseki-api.service /etc/systemd/system/
sudo systemctl daemon-reload

# 4. Create environment file
sudo mkdir -p /etc/kaseki-api
sudo tee /etc/kaseki-api/kaseki-api.env << EOF
KASEKI_API_KEYS=sk-your-secret-key
KASEKI_API_PORT=8080
KASEKI_API_LOG_LEVEL=info
KASEKI_RESULTS_DIR=/agents/kaseki-results
KASEKI_API_IMAGE=kaseki-agent:node24-local
EOF

# 5. Set appropriate permissions
sudo chown root:root /etc/kaseki-api/kaseki-api.env
sudo chmod 600 /etc/kaseki-api/kaseki-api.env

# 6. Start service
sudo systemctl enable kaseki-api
sudo systemctl start kaseki-api

# 7. Check status
sudo systemctl status kaseki-api
sudo journalctl -u kaseki-api -f
```

**Important behavior in Docker mode:**

- The unit executes `node /app/dist/kaseki-api-service.js` inside the container image.
- `/etc/kaseki-api/kaseki-api.env` only supplies environment variables; it does not mount over `/app/dist`.
- Mounted host volumes are `/agents`, `/agents/kaseki-results`, `/var/log/kaseki-api`, and `/var/run/docker.sock`; none are mounted at `/app`, so `/app/dist` always comes from the image artifact.

### Option 3: Manual Docker Container (Advanced)

Run the API container directly without docker-compose:

```bash
docker run --rm \
  --name kaseki-api \
  -p 8080:8080 \
  -v /agents:/agents:rw \
  -v /agents/kaseki-results:/agents/kaseki-results:rw \
  -v /var/log/kaseki-api:/var/log/kaseki-api:rw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e KASEKI_API_KEYS=sk-your-key \
  -e KASEKI_API_PORT=8080 \
  -e KASEKI_CONTAINER_USER=10000:10000 \
  -e KASEKI_AGENT_TIMEOUT_SECONDS=1200 \
  --user 10000:10000 \
  --group-add "$(stat -c '%g' /var/run/docker.sock)" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --read-only \
  --entrypoint node \
  ${KASEKI_API_IMAGE:-kaseki-agent:node24-local} \
  /app/dist/kaseki-api-service.js
```

---

## Security Best Practices

1. **API Key Management**
   - Store keys in environment files with mode `0600` (or use
     Docker secrets)
   - Never commit keys to version control
   - Rotate keys regularly
   - Use separate keys for different environments (dev/staging/prod)
   - For GitHub App authentication, prefer mounted files:
     `GITHUB_APP_ID_FILE`, `GITHUB_APP_CLIENT_ID_FILE`, and
     `GITHUB_APP_PRIVATE_KEY_FILE`. Avoid placing the private key
     PEM directly in `.env`; environment variables are more likely
     to appear in process inspection output, container metadata,
     and deployment UI history.

2. **Network Security**
   - Expose API only on trusted networks (localhost or VPN)
   - Use firewall rules to restrict access:

     ```bash
     sudo ufw allow from 10.0.0.0/8 to any port 8080
       # Example: allow from private network
     ```

   - Consider putting API behind a reverse proxy (nginx)
     with authentication

3. **Container Hardening**
   - All Docker deployments use:
     - `--cap-drop ALL` — Remove all Linux capabilities
     - `--security-opt no-new-privileges:true` — Prevent privilege
       escalation
     - `--read-only` — Read-only root filesystem
     - `tmpfs` — Temporary write-able directories
   - API runs as a non-root user that owns `/agents`
   - Add only the host Docker socket group as a supplemental group;
     do not run the API as root just to reach Docker

4. **TLS/HTTPS**
   - Forward HTTPS traffic via reverse proxy (e.g., nginx):

     ```nginx
     upstream kaseki_api {
       server localhost:8080;
     }

     server {
       listen 443 ssl http2;
       server_name api.kaseki.local;
       ssl_certificate /etc/letsencrypt/live/api.kaseki.local/
         fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.kaseki.local/
         privkey.pem;

       location / {
         proxy_pass http://kaseki_api;
         proxy_set_header Authorization $http_authorization;
       }
     }
     ```

   - Or use **Traefik** for dynamic routing and automatic certificate management:

     **docker-compose.yml with Traefik:**

     ```yaml
     version: "3.8"

     services:
       traefik:
         image: traefik:v3.0
         container_name: traefik
         command:
           - "--api.insecure=false"
           - "--providers.docker=true"
           - "--providers.docker.exposedbydefault=false"
           - "--entrypoints.web.address=:80"
           - "--entrypoints.websecure.address=:443"
           - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
           - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
           - "--certificatesresolvers.letsencrypt.acme.email=your-email@example.com"
           - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
         ports:
           - "80:80"
           - "443:443"
         volumes:
           - /var/run/docker.sock:/var/run/docker.sock:ro
           - traefik-letsencrypt:/letsencrypt
         networks:
           - kaseki-network

       kaseki-api:
         image: "${KASEKI_API_IMAGE:-docker.io/cyanautomation/kaseki-agent:latest}"
         container_name: kaseki-api
         user: "${KASEKI_API_USER:-10000:10000}"
         group_add:
           - "${DOCKER_GID:-985}"
         command: ["api"]
         environment:
           KASEKI_API_PORT: "8080"
           KASEKI_API_LOG_LEVEL: "${KASEKI_API_LOG_LEVEL:-warn}"
           KASEKI_STREAM_PROGRESS: "${KASEKI_STREAM_PROGRESS:-1}"
           KASEKI_API_MAX_CONCURRENT_RUNS: "${KASEKI_API_MAX_CONCURRENT_RUNS:-3}"
           KASEKI_RESULTS_DIR: /agents/kaseki-results
           KASEKI_SECRETS_DIR: "${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}"
           KASEKI_AGENT_TIMEOUT_SECONDS: "${KASEKI_AGENT_TIMEOUT_SECONDS:-10800}"
           KASEKI_MAX_DIFF_BYTES: "${KASEKI_MAX_DIFF_BYTES:-400000}"
           OPENROUTER_API_KEY_FILE: "${OPENROUTER_API_KEY_FILE:-/run/secrets/kaseki/openrouter_api_key}"
           GITHUB_APP_ID_FILE: "${GITHUB_APP_ID_FILE:-/run/secrets/kaseki/github_app_id}"
           GITHUB_APP_CLIENT_ID_FILE: "${GITHUB_APP_CLIENT_ID_FILE:-/run/secrets/kaseki/github_app_client_id}"
           GITHUB_APP_PRIVATE_KEY_FILE: "${GITHUB_APP_PRIVATE_KEY_FILE:-/run/secrets/kaseki/github_app_private_key}"
         volumes:
           - /agents:/agents:rw
           - ${KASEKI_HOST_SECRETS_DIR:-/home/pi/secrets}:/run/secrets/kaseki:ro
           - kaseki-logs:/var/log/kaseki-api
           - /var/run/docker.sock:/var/run/docker.sock
         restart: unless-stopped
         cap_drop:
           - ALL
         security_opt:
           - no-new-privileges:true
         read_only: true
         tmpfs:
           - /tmp
           - /var/tmp
           - /run
           - /results
         labels:
           - "traefik.enable=true"
           - "traefik.http.routers.kaseki.rule=Host(`kaseki-api.example.com`)"
           - "traefik.http.routers.kaseki.entrypoints=websecure"
           - "traefik.http.routers.kaseki.tls.certresolver=letsencrypt"
           - "traefik.http.services.kaseki.loadbalancer.server.port=8080"
           - "traefik.http.routers.kaseki-http.rule=Host(`kaseki-api.example.com`)"
           - "traefik.http.routers.kaseki-http.entrypoints=web"
           - "traefik.http.routers.kaseki-http.middlewares=kaseki-redirect"
           - "traefik.http.middlewares.kaseki-redirect.redirectscheme.scheme=https"
           - "traefik.http.middlewares.kaseki-redirect.redirectscheme.permanent=true"
         networks:
           - kaseki-network
         healthcheck:
           test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/ready').then(r=>r.json()).then(d=>process.exit(d.status==='ready'?0:1)).catch(()=>process.exit(1))"]
           interval: 30s
           timeout: 10s
           retries: 3
           start_period: 40s

     volumes:
       kaseki-logs:
         driver: local
       traefik-letsencrypt:
         driver: local

     networks:
       kaseki-network:
         driver: bridge
     ```

     **Environment Setup (.env):**

     ```bash
     # Traefik + Kaseki Configuration
     KASEKI_API_IMAGE=docker.io/cyanautomation/kaseki-agent:latest
     KASEKI_API_LOG_LEVEL=warn
     KASEKI_API_MAX_CONCURRENT_RUNS=3
     KASEKI_AGENT_TIMEOUT_SECONDS=10800
     KASEKI_MAX_DIFF_BYTES=400000
     KASEKI_STREAM_PROGRESS=1

     # Secrets directory (host path)
     KASEKI_HOST_SECRETS_DIR=/home/pi/secrets

     # Docker group ID (for socket access)
     DOCKER_GID=985
     ```

     **Deployment Steps:**

     1. Update the docker-compose.yml with your domain (`kaseki-api.example.com` → your domain)
     2. Update Traefik ACME email in the `--certificatesresolvers.letsencrypt.acme.email` flag
     3. Create/verify secrets directory:

        ```bash
        sudo mkdir -p /home/pi/secrets
        sudo chown 10000:10000 /home/pi/secrets
        sudo chmod 700 /home/pi/secrets
        ```

     4. Start services:

        ```bash
        docker-compose up -d
        docker-compose logs -f traefik kaseki-api
        ```

     5. Access the Task Console at `https://kaseki-api.example.com/ui`

     **Key Features:**

     - **Automatic HTTPS**: Let's Encrypt certificate auto-renewal
     - **HTTP → HTTPS redirect**: All traffic is encrypted
     - **Service discovery**: Traefik auto-detects kaseki-api via Docker labels
     - **Easy domain management**: Change domain in one label
     - **Persistent certificates**: Stored in `traefik-letsencrypt` volume

---

## Health Checks

All deployments should monitor health:

```bash
curl http://localhost:8080/health
# Equivalent namespaced endpoint:
curl http://localhost:8080/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2026-05-02T14:30:00Z",
  "queue": {
    "pending": 0,
    "running": 0,
    "maxConcurrent": 3
  }
}
```

---

## Monitoring

### Dependency Cache Behavior

- Worker installs are lockfile-only (`npm ci --omit=dev`) and will
  fail when no `package-lock.json` or `npm-shrinkwrap.json` is present.
- Scheduler/runner containers must keep a persistent cache mount at
  `/agents/kaseki-cache` (or override with `KASEKI_CACHE_DIR`) so
  dependency cache data survives between runs.
- `run-kaseki.sh` mounts that directory into workers at `/cache`, and
  workers use:
  - `KASEKI_DEPENDENCY_CACHE_DIR=/cache/dependencies`
  - `NPM_CONFIG_CACHE=/cache/npm-cache`
- `KASEKI_DEPENDENCY_RESTORE_MODE` defaults to `auto` at worker runtime
  (not hardlink-forced by bootstrap wiring). For deployments where cache
  and workspace are on separate mounts/devices, keep `auto` (recommended)
  or pin `copy` for deterministic cross-device behavior.
- If logs show EXDEV/cross-device link failures during restore, switch to
  `auto`/`copy` and confirm recovery via dependency cache status events in
  `progress.log`/`progress.jsonl` and `dependency-cache.log`.
- Cache key is deterministic from dependency-shaping inputs: lockfile SHA-256,
  Node major version, and npm install flags. It intentionally excludes Git
  branch/ref names so feature branches with identical dependency inputs can
  share dependency cache entries.
- Progress + timing artifacts include install/cache signals:
  - `progress.jsonl` / `progress.log`: dependency install stage,
    cache hit/miss, elapsed seconds.
  - `stage-timings.tsv`: `dependency install` row with cache source
    and install flags.
  - `dependency-cache.log`: summarized cache status.

### Docker Compose

```bash
# View logs
docker-compose logs -f kaseki-api

# Check resource usage
docker stats kaseki-api
```

### Node.js Process

```bash
# Check process status
ps aux | grep kaseki-api

# View recent logs (depends on logging setup)
tail -f /var/log/kaseki-api.log
```

### systemd Service

```bash
# Check status
systemctl status kaseki-api

# View logs (last 100 lines)
journalctl -u kaseki-api -n 100

# Stream logs
journalctl -u kaseki-api -f
```

### Prometheus Metrics

Metrics endpoint coming in Phase 8:

```bash
curl -H "Authorization: Bearer $KASEKI_API_KEYS" http://localhost:8080/api/metrics
```

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: kaseki_api
    metrics_path: /api/metrics
    scheme: http
    static_configs:
      - targets: ['kaseki-api:8080']
    authorization:
      credentials: ${KASEKI_API_KEY}
```

Readiness probe (no auth required):

```bash
curl -f http://localhost:8080/ready
# or
curl -f http://localhost:8080/api/ready
```

`/ready` returns `503` with machine-readable `reasons` when dependencies like results-dir writability,
scheduler queue introspection, or webhook processing health are unavailable.

---

## Log Rotation

### Docker Compose

Logs are managed by Docker automatically. To configure retention:

```bash
# Edit daemon.json
sudo nano /etc/docker/daemon.json
```

Add:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Then restart Docker:

```bash
sudo systemctl restart docker
```

### Host Deployment (systemd/Node.js)

Configure logrotate:

```bash
sudo tee /etc/logrotate.d/kaseki-api << EOF
/var/log/kaseki-api/*.log {
  daily
  rotate 7
  compress
  delaycompress
  missingok
  notifempty
  create 0640 nobody nogroup
  sharedscripts
  postrotate
    systemctl reload kaseki-api > /dev/null 2>&1 || true
  endscript
}
EOF
```

---

## Troubleshooting

### API won't start

Check required environment variables:

```bash
# Must be set
echo $KASEKI_API_KEYS  # Should not be empty
ls -la /agents/kaseki-results  # Directory must exist
```

### Container/process is crashing

View logs for detailed error:

```bash
# Docker Compose
docker-compose logs kaseki-api | head -50

# Node.js
npm run kaseki-api  # Run in foreground to see errors

# systemd
journalctl -u kaseki-api -n 50
```

Common issues:

- Missing `/agents/kaseki-results` directory
- Invalid port (not between 1-65535)
- API key environment variable not set
- Docker daemon not running (for docker-compose)
- Node.js not installed or wrong version

### Slow performance

Check queue status:

```bash
curl -H "Authorization: Bearer sk-key" http://localhost:8080/api/runs

# Monitor running jobs
watch -n2 'curl -s http://localhost:8080/health | jq ".queue"'
```

Increase `KASEKI_API_MAX_CONCURRENT_RUNS` if jobs are queueing unnecessarily.

---

## Cleanup

### Docker Compose

```bash
cd /agents/kaseki-template
docker-compose down
docker volume prune  # Optional: delete unused volumes
```

### Node.js Process

```bash
# Stop the process
pkill -f "kaseki-api"

# Or if using npm:
# Ctrl+C in the terminal
```

### systemd Service

```bash
sudo systemctl stop kaseki-api
sudo systemctl disable kaseki-api
sudo rm /etc/systemd/system/kaseki-api.service
sudo systemctl daemon-reload
```

---

## Publishing & Release Workflows

### npm Package Publishing

The package is published to npm registry via GitHub Actions:

**Automated Flow (Recommended)**

1. Run the **Release** workflow (`.github/workflows/release.yml`) manually or via push
   - Creates semantic version tags via `semantic-release`
   - Generates GitHub release notes
2. **Publish NPM** workflow (`.github/workflows/publish-npm.yml`) runs automatically
   - Triggered when Release completes successfully
   - Builds package, publishes to npm, verifies on registry

**Manual Publishing (Recovery Scenario)**

If the automatic publish fails (e.g., transient network issue) but Release succeeded:

1. Open GitHub Actions → "Publish NPM" workflow
2. Click "Run workflow" button
3. **Tags input** (optional):
   - Leave empty to auto-detect from latest git tag (default)
   - Provide comma-separated tags to override (e.g., `1.2.3,latest`)
4. Click "Run workflow"
5. Monitor the run in the Actions tab
6. Verify on npm registry: `npm view @cyanautomation/kaseki-agent@<version>`

**Troubleshooting: 404 Not Found on npm publish**

If you get `404 Not Found - PUT https://registry.npmjs.org/@cyanautomation%2fkaseki-agent`:

This means your npm account/organization **isn't configured for OIDC trusted publishing**. The workflow uses GitHub Actions OIDC tokens (no hardcoded secrets), but npm needs to be configured to accept them.

**Setup OIDC on npm (one-time):**

1. Go to [npm settings → Access](https://npmjs.com/settings/cyanautomation/access)
2. Scroll to "GitHub Actions" section
3. Click "Authorize GitHub Actions" or "Configure"
4. Select your repository (CyanAutomation/kaseki-agent)
5. Grant npm publish permissions
6. Confirm authorization

**After setup, retry:**

```bash
# GitHub Actions → Publish NPM → Run workflow (leave tags empty or provide explicit version)
```

If OIDC still doesn't work, see [npm OIDC docs](https://docs.npmjs.com/cli/using-npm/configure-npm/configuring-your-npm-client-with-github-actions) or contact npm support.

**Note:** You only need to set this up once. After OIDC is enabled, all future publishes (automatic via Release workflow or manual) will work without additional configuration.

**Option A: Retry with new prerelease version** (recommended for testing)

1. Create a new git tag: `git tag v1.4.2-retry.1 && git push origin v1.4.2-retry.1`
2. Run Publish NPM workflow
3. Leave tags input empty (will auto-detect new version)
4. Or explicitly provide: `1.4.2-retry.1`

**Option B: Manual version override** (for recovery with explicit version)

1. Run Publish NPM workflow manually
2. In the tags input, provide the **exact new version**: `1.4.2`
3. Workflow will update package.json and publish the new version

**Manual Publishing with Custom Version (Testing)**

For one-off test publishes (alpha/beta/rc tags):

1. Create a git tag: `git tag v1.2.3-alpha.1 && git push origin v1.2.3-alpha.1`
2. Run Publish NPM workflow manually
3. Provide custom tags: `1.2.3-alpha.1` (or leave empty to auto-detect)

**Checking Published Versions**

```bash
# View current npm package info
npm view @cyanautomation/kaseki-agent

# Check specific version
npm view @cyanautomation/kaseki-agent@1.2.3

# View publication history
npm view @cyanautomation/kaseki-agent versions | tail -20

# Check if a version already exists before trying to publish
npm view @cyanautomation/kaseki-agent@1.4.1 && echo "Version already published" || echo "Version not found"
```

---

## Troubleshooting

### UID Mismatch: "Permission denied" on `/results/` (Critical Fix)

**Symptom:**

Multiple permission denied errors when running kaseki-agent:

```
/usr/local/bin/kaseki-agent: line 132: /results/stdout.log: Permission denied
/usr/local/bin/kaseki-agent: line 136: /results/validation.log: Permission denied
tee: /results/pi-stderr.log: Permission denied
/usr/local/bin/kaseki-agent: line 436: /results/git.status: Permission denied
```

**Root Cause:**
The Dockerfile creates the kaseki user with UID 10000, and docker-compose.yml runs the container as UID 10000. However, if the host `/agents` directory is owned by root (or another UID) with restrictive permissions (e.g., `755`), the container cannot write to it.

**One-Line Fix:**

```bash
sudo mkdir -p /agents && sudo chmod 777 /agents
```

**Explanation:**

- Makes `/agents` world-writable so UID 1000 (and any user) can write
- Subdirectories created by the container inherit restrictive permissions (`700`) automatically
- Safe for production because worker containers cannot read/write outside their instance directories

**Better Fix (if you own the host user):**

```bash
sudo mkdir -p /agents
sudo chown 10000:10000 /agents  # Make /agents owned by the container user (UID 10000)
sudo chmod 755 /agents           # Restrictive but sufficient
```

**Verify the fix:**

```bash
ls -ld /agents  # Should show 10000:10000 ownership (preferred) or
                # drwxrwxrwx (world-writable) if using one-line fix
touch /agents/test-write && rm /agents/test-write  # Should succeed
```

**After Fixing:**

1. **For Docker Compose API service:** Restart the service

   ```bash
   docker-compose down && docker-compose up -d
   ```

2. **For kaseki-agent CLI:** Re-run your command

   ```bash
   sudo -E kaseki-agent run <repo> <ref> "<task>"
   ```

### Permission Denied Errors Writing to `/results/` (API Service)

**Symptom:**

```
tee: /results/pi-stderr.log: Permission denied
/usr/local/bin/kaseki-agent: line 436: /results/git.status: Permission denied
```

**Root Cause:**
The container runs as UID 10000, but the host `/agents` directory is owned by root (or another user) with permissions that don't allow UID 10000 to write.

**Quick Fix:**

```bash
# On the host, make /agents writable for all users (including container UID 1000)
sudo mkdir -p /agents
sudo chmod 777 /agents

# Verify
ls -ld /agents  # Should show: drwxrwxrwx ... /agents
```

**Better Fix (if you control the host user):**

```bash
# Create /agents owned by the container user (UID 10000)
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 755 /agents
```

**After Fixing:**

1. Restart docker-compose: `docker-compose down && docker-compose up -d`
2. Verify container can write: `docker-compose logs kaseki-api | grep KASEKI_RESULTS_DIR`
3. Retry your kaseki-agent run or API request

### Startup Logs Show "Failed to create KASEKI_RESULTS_DIR"

**Check:**

```bash
docker-compose logs kaseki-api | grep "Failed to create"
```

**Verify host directory:**

```bash
# Ensure /agents exists and is writable by UID 1000
ls -ld /agents
touch /agents/test-write  # Should succeed
rm /agents/test-write
```

**If touch fails:**

- Run: `sudo chmod 777 /agents`
- Or: `sudo chown 10000:10000 /agents && sudo chmod 755 /agents`

### Container Exits with Code 1

**Check logs:**

```bash
docker-compose logs kaseki-api --tail 50
```

**Common causes:**

1. `/agents` directory doesn't exist or isn't writable (see "Permission Denied" section above)
2. `KASEKI_RESULTS_DIR` points to invalid path
3. Docker socket mount not available: verify `-v /var/run/docker.sock:/var/run/docker.sock`

**Fix:**

```bash
# Ensure /agents exists and is writable
sudo mkdir -p /agents && sudo chmod 777 /agents

# Restart service
docker-compose restart kaseki-api

# View logs
docker-compose logs -f kaseki-api
```

### Runs Fail with "Cannot write to workspace"

**Symptom:**
Worker containers fail to write to `/agents/kaseki-runs/` or `/agents/kaseki-results/`

**Cause:**
Same as above — `/agents` directory permissions

**Fix:**
See "Permission Denied Errors" section above.

### Docker Socket Permission Denied

**Symptom:**

```
permission denied while trying to connect to Docker daemon
Error response from daemon: user does not have permissions to use Docker
```

**Cause:**
Container UID 10000 doesn't have access to `/var/run/docker.sock`

**Fix:**

```bash
# Get the gid of the docker group on the host
stat -c '%g' /var/run/docker.sock  # Returns e.g., 985

# Set DOCKER_GID environment variable
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)

# Restart docker-compose with the GID
docker-compose down && docker-compose up -d
```

The docker-compose.yml should have:

```yaml
group_add:
  - "${DOCKER_GID:-999}"
```

### Volume Mount Not Available in Container

**Symptom:**

```
Error: ENOENT: no such file or directory, mkdir '/agents/kaseki-results'
```

**Verify volume mount:**

```bash
docker-compose ps  # Check if kaseki-api is running

docker inspect kaseki-api | grep -A 5 Mounts
# Should show: /agents -> /agents
```

**Fix:**

1. Ensure `/agents` exists on host: `mkdir -p /agents && chmod 777 /agents`
2. Check docker-compose.yml has: `- /agents:/agents:rw`
3. Restart: `docker-compose down && docker-compose up -d`

---

## Next Steps

1. **Choose your deployment path** — Docker Compose (recommended) or Node.js
2. **Configure for your network** — Update firewall rules, reverse proxy settings
3. **Set up monitoring** — Add health checks, alerts
4. **Test integration** — Use TypeScript client library to submit test runs
5. **Deploy kaseki-agent** — Ensure Docker base image and OpenRouter credentials are configured

## Runtime Verification

Use these checks after deployment:

```bash
# Check whether systemd is launching Docker or host Node
systemctl cat kaseki-api | sed -n "1,220p"

# Docker path: verify container runtime Node major
docker exec kaseki-api node -v

# Host-Node path: verify service user runtime (example for nobody)
sudo -u nobody /usr/bin/node -v
```

The service startup precheck logs detected Node version and exits with a clear error if the major version is less than 24.

---

## Host Setup Requirements

Before deploying, run these commands once on the Docker host:

```bash
# Create and permission the /agents directory
sudo mkdir -p /agents
sudo chown 10000:10000 /agents
sudo chmod 755 /agents

# Set group-based read access for the container GID (default: 10000)
sudo chgrp -R 10000 /home/pi/secrets
sudo chmod 0750 /home/pi/secrets
sudo chmod 0640 /home/pi/secrets/*
```

The host secret contract is intentionally small: the mounted directory is `0750`, each secret file is `0640`, and both are group-owned by the container GID. `kaseki-agent host setup --fix` and `kaseki-agent secrets fix-permissions` apply that same contract.

See [docs/QUICK_START.md](QUICK_START.md) for the full setup walkthrough.

---

## Kubernetes Deployment

For Kubernetes deployments, requires **custom volume setup**:

### Prerequisites for Kubernetes

1. **PersistentVolume (PV)** for `/agents` (must be writable by UID 10000)
2. **PersistentVolumeClaim (PVC)** mounting the PV to `/agents`

### Example Kubernetes Manifests

**Service definition with init container:**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: kaseki-api
spec:
  selector:
    app: kaseki
  ports:
    - port: 8080
      targetPort: 8080
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agents-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kaseki-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kaseki
  template:
    metadata:
      labels:
        app: kaseki
    spec:
      # Init container: Verify /agents permissions before API starts
      initContainers:
      - name: kaseki-init
        image: "docker.io/cyanautomation/kaseki-agent:latest"
        command: ["/scripts/startup-checks.sh", "permissions"]
        volumeMounts:
        - name: agents
          mountPath: /agents
        securityContext:
          runAsUser: 10000
          runAsGroup: 10000
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
      
      # Main API container
      containers:
      - name: kaseki-api
        image: "docker.io/cyanautomation/kaseki-agent:latest"
        command: ["node", "/app/dist/kaseki-api-service.js"]
        ports:
        - containerPort: 8080
        env:
        - name: KASEKI_API_PORT
          value: "8080"
        - name: KASEKI_RESULTS_DIR
          value: "/agents/kaseki-results"
        volumeMounts:
        - name: agents
          mountPath: /agents
        - name: docker-sock
          mountPath: /var/run/docker.sock
        - name: secrets
          mountPath: /run/secrets/kaseki
          readOnly: true
        securityContext:
          runAsUser: 10000
          runAsGroup: 10000
          readOnlyRootFilesystem: true
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
      
      volumes:
      - name: agents
        persistentVolumeClaim:
          claimName: agents-pvc
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
          type: Socket
      - name: secrets
        secret:
          secretName: kaseki-api-keys
          defaultMode: 0400
```

### Kubernetes Troubleshooting

**Issue: Pod stuck in Init state**

```bash
# Check init container logs
kubectl logs pod/kaseki-api-XXX -c kaseki-init

# Verify PVC is mounted and writable
kubectl exec pod/kaseki-api-XXX -- ls -ld /agents
```

**Issue: Permission denied in API service**

Ensure the PVC is mounted with correct permissions:

```bash
# Inside the pod
kubectl exec pod/kaseki-api-XXX -- id  # Should show uid=10000
kubectl exec pod/kaseki-api-XXX -- test -w /agents && echo "writable" || echo "not writable"
```

**Issue: Init container keeps restarting**

Check if PVC itself is read-only or doesn't support permission changes:

```bash
# Test chmod capability
kubectl exec pod/kaseki-api-XXX -c kaseki-init -- touch /agents/test && chmod 755 /agents/test
```

If init container can't fix permissions, manually configure the PV's underlying storage to be writable by UID 10000.
