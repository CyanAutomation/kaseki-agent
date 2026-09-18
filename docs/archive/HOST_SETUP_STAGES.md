# Kaseki Host Setup: Stages & Execution Flow

**Version**: 2.0 (Phase 4-5)  
**Updated**: 2026-06-04  
**Audience**: DevOps engineers, system administrators, troubleshooting specialists

This document describes the internal structure, stages, and execution flow of the Kaseki host setup process.

---

## Quick Reference

| Stage | Name | Duration | Dependency | Parallelizable | Status |
|-------|------|----------|------------|---|---|
| 1 | Host Prerequisites | < 100ms | — | No | Gating |
| 2 | Create/Fix Directories | < 500ms | Stage 1 ✓ | No | Fixing |
| 3 | Normalize Secrets | < 200ms | Stage 2 ✓ | **Yes** | Fixing |
| 4 | Git & Checkout Perms | < 300ms | Stage 2 ✓ | **Yes** | Fixing |
| 5 | Bootstrap Checkout | 1-5s | Probe (Stage 6) ✓ | No | Conditional |
| 6 | Checkout Freshness Probe | 2-6s | Stage 2 ✓ | No | Testing |
| 7 | Verify Fixes Applied | < 200ms | Stage 2-4 ✓ | No | Verification |
| 8 | Template Verification | < 100ms | — | **Yes** | Gating |
| 9 | API Container Recreation | 5-10s | Optional | No | Optional |

**Execution Order:**

```
Stage 1 (gate) → Stage 2 (fix) → {Stage 3, Stage 4} (parallel)
                                    ↓
                            Stage 6 (probe)
                                    ↓
                    Stage 5 (conditional bootstrap)
                                    ↓
                            Stage 7 (verify)
                                    ↓
                    Stage 8 (template) + Stage 9 (optional API)
```

---

## Stage Details

### Stage 1: Host Prerequisites Validation

**Purpose**: Verify host environment is suitable for Kaseki

**Checks Performed**:

- KASEKI_ROOT directory path is traversable
- Git is installed and working
- secrets directory path is traversable
- Required system utilities are available

**Exit Codes**:

- `0` — All prerequisites met
- `1` — Fatal error (blocking operation)
- `2` — Permission/access error (likely fixable)
- `3` — Warning (non-blocking)

**When It Fails**:

- Git not installed or not in PATH
- KASEKI_ROOT path contains inaccessible directories
- Secrets directory path is blocked

**Example Output**:

```bash
✓ KASEKI_ROOT=/agents is accessible
✓ git is installed
✓ secrets path is traversable
```

**Fix Recommendation**:

- Install git: `sudo apt install git`
- Ensure KASEKI_ROOT parent directories are accessible
- Check directory permissions in secrets path

---

### Stage 2: Creating/Fixing Directories

**Purpose**: Ensure all required directory structure exists with correct permissions

**Directories Created**:

- `/agents` (root)
- `/agents/kaseki-results` (output)
- `/agents/kaseki-runs` (workspace)
- `/agents/kaseki-cache` (dependency cache)
- `/var/log/kaseki` (logs)

**Permissions Applied**:

- All directories: mode 0775 (rwxrwxr-x)
- Owner: container UID:GID (10000:10000)

**When It Runs**:

- Only when `--fix` flag is present
- Skipped in `--check-only` mode

**Phase 2: Post-Action Verification**:

- After creating/changing ownership, verifies actual permissions match expected
- Detects read-only mounts and warns user
- Gracefully handles permission change failures

**Example Output**:

```
✓ /agents
✓ /agents/kaseki-results  
✓ /agents/kaseki-runs
✓ /agents/kaseki-cache
writable: /agents/kaseki-results
```

**If It Fails**:

- Read-only file system
- Insufficient privileges (not running as root or with sudo)
- File system mounted with noexec flag

---

### Stage 3: Normalizing Secrets Directory

**Purpose**: Ensure host secrets are readable by container with proper permissions

**Secrets Files Checked**:

- openrouter_api_key
- github_app_id
- github_app_client_id
- github_app_private_key
- kaseki_api_keys

**Permissions Applied** (when `--fix`):

- Directory: mode 0750 (rwxr-x---)
- Files: mode 0640 (rw-r-----)
- Owner group: container GID (10000)

**Phase 4: Parallelization**:

- **Runs in parallel with Stage 4**
- No dependencies on Stage 4
- Results are independent

**Example Output**:

```
ok: host secrets directory found at /root/secrets
✓ secret present: openrouter_api_key
✓ secret present: github_app_id
⚠ secret missing: kaseki_api_keys
```

**If It Fails**:

- Secrets directory doesn't exist (warning only)
- Required secrets are missing (warning only)
- Permission changes blocked (read-only mount)

---

### Stage 4: Configuring Git & Checkout Permissions

**Purpose**: Fix checkout directory permissions and ensure git can access it

**Operations Performed**:

1. **Fix Checkout Ownership**: Change checkout directory to container UID:GID
2. **Configure safe.directory**: Add checkout to git safe.directory config
3. **Verify Configuration**: Check git can access the checkout

**Phase 4: Parallelization**:

- **Runs in parallel with Stage 3**
- No dependencies on Stage 3
- Results are independent

**Example Output**:

```
✓ Fixed checkout ownership to 10000:10000
✓ git safe.directory configured
✓ git safe.directory verified
```

**If It Fails**:

- Checkout directory inaccessible
- Git not installed
- safe.directory already configured with conflicting path

**Key Detail: safe.directory**:
Git 2.35.2+ requires explicitly marking directories as safe to prevent "dubious ownership" errors. Kaseki auto-configures this, but if bootstrap fails with that error, you may need to manually add:

```bash
git config --global --add safe.directory "/agents/kaseki-agent"
```

---

### Stage 5: Bootstrap Checkout (Conditional)

**Purpose**: Clone or update the target Git repository in the checkout directory

**When It Runs**:

- Only when `--fix` flag is set
- **Only if Stage 6 probe succeeds** (Phase 2 conditional execution)
- Skipped if probe indicates checkout is inaccessible

**Bootstrap Command**:

```bash
git clone <REPO_URL> -b <GIT_REF> /agents/kaseki-agent
# or if directory exists:
git fetch && git checkout <GIT_REF>
```

**Environment Variables**:

- `REPO_URL` — Repository to clone (defaults to CyanAutomation/crudmapper)
- `GIT_REF` — Branch/tag/commit to check out (defaults to main)

**Phase 2: Conditional Execution**:

- Bootstrap only runs if `checkout_probe_status = "ok"`
- If probe failed, bootstrap is **skipped** with advisory message
- Prevents bootstrap from running on inaccessible checkouts
- User gets clear message: "Fix permissions and rerun: sudo kaseki-agent host setup --fix"

**Example Output (Success)**:

```
✓ Stage 5: Bootstrap checkout (probe passed, proceeding)
Cloning repository...
checkout-branch: main (commit abc123def)
```

**Example Output (Skipped)**:

```
⚠ Stage 5: Bootstrap skipped (probe failed)
remediation: Fix permissions and rerun: sudo kaseki-agent host setup --fix
```

---

### Stage 6: Checkout Freshness Probe

**Purpose**: Test if container can access the checkout directory with required permissions

**Phase 4: Parallel Privilege Tool Testing**:

- **Runs privilege tool tests in parallel** instead of sequentially
- Tests: setpriv (fast), runuser (medium), sudo (fallback)
- Returns on **first success** (vs. waiting for all)
- Reduces probe time from ~6 seconds to ~2 seconds (median)

**Test Command**:

```bash
git -C /agents/kaseki-agent rev-parse HEAD
```

**Test Methods** (tried in order, first success wins):

1. **setpriv** (preferred): `setpriv --reuid 10000 --regid 10000 git ...`
2. **runuser** (medium): `runuser -u cassette -g cassette git ...`
3. **sudo** (fallback): `sudo -u cassette -g cassette git ...`

**Timeout Protection** (Phase 2):

- Each tool test has 2-second timeout (default, configurable via `KASEKI_PRIV_TOOL_TIMEOUT`)
- Prevents hangs on slow systems or missing tools
- Detects timeout errors and suggests increasing timeout

**Exit Codes**:

- `ok` — Checkout is accessible and readable
- `failed` — Probe could not run command (see remediation)
- `skipped` — Bootstrap was not run

**Example Output (Success)**:

```
checkout-freshness-probe: ok
Checkout freshness probe passed for /agents/kaseki-agent as UID:GID 10000:10000.
```

**Example Output (Failure)**:

```
checkout-freshness-probe: failed
Checkout freshness probe failed: probe could not impersonate UID:GID 10000:10000 ...
remediation: Configure a valid host method to run commands as UID:GID 10000:10000...
```

---

### Stage 7: Verifying Fixes Applied

**Purpose**: Confirm that permission changes and configurations from Stages 2-4 actually took effect

**Checks**:

- Directory ownership matches expected (10000:10000)
- Directory permissions match expected (0775)
- Git configuration is accessible
- Secrets permissions are correct

**Phase 2: Post-Action Verification**:

- Detects read-only mounts that prevent permission changes
- Identifies partial failures (some dirs updated, others not)
- Warns about mismatches without failing overall setup

**Example Output (Success)**:

```
✓ /agents ownership verified (10000:10000)
✓ /agents permissions verified (0775)
✓ Secrets permissions verified
```

**Example Output (Partial Failure)**:

```
⚠ ownership mismatch for /agents/kaseki-results
  Actual: root:root, Expected: 10000:10000
  (May be on read-only mount)
```

---

### Stage 8: Template Verification

**Purpose**: Verify Kaseki agent template is ready and executable

**Phase 2: Hardened Verification**:

- Checks **both** existence AND executability
- Automatically fixes permissions with `chmod +x` when `--fix` is set
- Distinguishes between "missing" and "not-executable" states

**File Checked**:

- `/agents/kaseki-template/run-kaseki.sh`

**Checks Performed**:

1. File exists
2. File is executable (`-x` permission)
3. File is readable (`-r` permission)

**Exit Codes**:

- `ok` — Template is ready
- `missing` — Template runner doesn't exist
- `not-executable` — File exists but is not executable
- `unknown` — Unable to determine status

**Example Output (Success)**:

```
✓ Template runner is ready and executable
```

**Example Output (Not Executable)**:

```
error: template runner exists but is not executable
remediation: run chmod +x /agents/kaseki-template/run-kaseki.sh
```

---

### Stage 9: API Container Recreation (Optional)

**Purpose**: Optionally recreate the kaseki-api Docker container with updated bind mounts

**When It Runs**:

- Only when `--recreate-api` flag is present
- Requires Docker to be installed
- Requires kaseki-api container to exist or docker-compose.yml

**Operations**:

1. Remove existing kaseki-api container (if exists)
2. Spawn new container via `docker compose up -d kaseki-api`

**Example Output (Success)**:

```
recreating: removing existing kaseki-api container
recreating: docker compose up -d --no-deps kaseki-api
Creating kaseki-api ... done
```

**Example Output (No Docker)**:

```
warning: docker is unavailable; cannot recreate kaseki-api
```

---

## Execution Modes

### Check-Only Mode (`--check-only`)

**Purpose**: Validate current state without making any changes

**Stages Run**:

- Stage 1: Prerequisites (required)
- Stage 2-4: Report current state (no fixes)
- Stage 6: Probe (tests but doesn't fix)
- Stage 8: Template check (no fix)
- Stage 9: Skipped

**Stages Skipped**:

- Stage 5: Bootstrap (conditional)
- Stage 7: Verify fixes (N/A, no fixes made)

**Use Cases**:

- Pre-flight check before running setup
- Verify current host state
- Diagnose problems without changing anything

**Example**:

```bash
kaseki-agent host setup --check-only
```

### Fix Mode (`--fix`)

**Purpose**: Validate and optionally fix host environment

**Stages Run**: All stages 1-9

**Use Cases**:

- First-time host setup
- Repair broken setup
- Reconfigure permissions

**Example**:

```bash
sudo kaseki-agent host setup --fix
```

### Combined Workflow (Recommended)

```bash
# 1. Check current state without changes
kaseki-agent host setup --check-only

# 2. Review output, then fix
sudo kaseki-agent host setup --fix

# 3. Verify fixes took effect
kaseki-agent host setup --check-only

# 4. Optionally recreate API container
sudo kaseki-agent host setup --fix --recreate-api
```

---

## Performance Metrics (Phase 4)

### Typical Execution Times

**Check-Only Mode**:

- Stage 1: ~50ms
- Stage 6 (probe): ~2-3s (with parallel privilege tools)
- **Total**: ~2-3 seconds

**Fix Mode** (first run):

- Stage 1: ~50ms
- Stage 2: ~200ms
- Stage 3-4 (parallel): ~250ms combined
- Stage 5: 1-5s (depends on repo size)
- Stage 6: ~2-3s (parallel probe)
- Stage 7: ~150ms
- Stage 8: ~50ms
- **Total**: 4-11 seconds

**Fix Mode** (subsequent runs):

- Stages 1-4, 7-8: ~1 second
- Stage 5: skipped (already bootstrapped)
- Stage 6: ~2-3s (probe still needed)
- **Total**: ~3-4 seconds

### Performance Optimization (Phase 4)

**Parallel Stages**:

- Stages 3 & 4 run in parallel, saving ~300-500ms

**Parallel Privilege Tool Testing**:

- Tests setpriv, runuser, sudo in parallel
- First success wins (vs. trying all sequentially)
- Reduces probe time from ~6s to ~2s (typical)

### JSON Performance Data

The `setup-results.json` file includes timing metrics:

```json
{
  "performance": {
    "stage_1_ms": 45,
    "probe_duration_ms": 2150
  }
}
```

---

## Exit Codes

| Code | Meaning | Typical Cause | Recovery |
|------|---------|---------------|----------|
| 0 | Success | All stages passed | N/A |
| 1 | Fatal error | Check failed, stage error | Review logs, rerun with --fix |
| 2 | Permission error | Access denied, insufficient privileges | Run with `sudo`, fix permissions |
| 3 | Warning | Non-blocking issue (missing optional secret) | Informational, can continue |
| 4+ | Specific error | Depends on stage | See stage-specific guidance |

---

## Common Failure Scenarios

See [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) for detailed diagnosis and remediation of 10+ common failure scenarios.

---

## JSON Schema

See [HOST_SETUP_API_REFERENCE.md](HOST_SETUP_API_REFERENCE.md) for complete JSON schemas, function signatures, and API reference.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `KASEKI_ROOT` | `/agents` | Base directory for all kaseki data |
| `KASEKI_CONTAINER_UID` | `10000` | Container user ID (must match Dockerfile) |
| `KASEKI_CONTAINER_GID` | `10000` | Container group ID (must match Dockerfile) |
| `KASEKI_PRIV_TOOL_TIMEOUT` | `2` | Timeout in seconds for privilege tools (Phase 2) |
| `KASEKI_CHECK_ONLY` | `0` | Enable check-only mode (no changes) |
| `KASEKI_FIX` | `0` | Enable fix mode (make changes) |
| `KASEKI_RECREATE_API` | `0` | Recreate kaseki-api container (Stage 9) |

---

## See Also

- [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) — Failure diagnosis & recovery
- [HOST_SETUP_API_REFERENCE.md](HOST_SETUP_API_REFERENCE.md) — JSON schemas & function reference
- [QUICK_START.md](QUICK_START.md) — User-facing quick start guide
