# Summary: Template Doctor Failure Fix Implementation

## Issue
After `sudo kaseki-agent host setup --fix`, the subsequent `sudo kaseki-agent host preflight` failed because:
- **Git safe.directory** was configured only for root user (`--global`), but container runs as UID 10000
- Host doctor check passed (ran on host as root), container doctor check failed (ran in container as UID 10000)
- Directory permissions prevented UID 10000 from creating subdirectories in `/agents/*`

## Root Cause: Multi-Layer User Context Mismatch
Git configuration is per-user. The host setup created git config in `/root/.gitconfig`, which UID 10000 cannot access.

## Solution: Four-Layer Defense-in-Depth Implementation

### Layer 1: Container Auto-Remediation ✅
**Files Modified:**
- `src/startup/container-preflight.ts`
- `src/kaseki-api-types.ts`
- `src/startup/container-preflight.test.ts` (NEW)

**Changes:**
- Modified `checkGitSafeDirectory()` to auto-configure git when missing
- Respects `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE` env var (default: enabled)
- Supports `KASEKI_SAFE_DIRECTORY_SCOPE` for --system vs --global scope
- Added `remediationAttemptError` field to PreflightCheck interface
- Created comprehensive test suite with TDD approach:
  - Tests for read-only mode (existing behavior)
  - Tests for auto-remediation success path
  - Tests for graceful remediation failure
  - Tests for environment variable controls
  - Tests for custom checkout directories

### Layer 2: Host-Side System-Wide Config ✅
**Files Modified:**
- `scripts/kaseki-setup-host.sh`

**Changes:**
- Updated `ensure_git_safe_directory()` function:
  - Phase 1: Configure system-wide (`git config --system`) — visible to all users including UID 10000
  - Phase 2: Fallback to user-level (`--global`) if system config fails
  - Phase 3: Configure sudo invoking user's context for multi-user scenarios
- Updated `verify_git_safe_directory()` to check system-wide config first
- This breaks the user context isolation: system config is visible everywhere

### Layer 3: Directory Permission Validation ✅
**Files Modified:**
- `scripts/docker-entrypoint.sh`

**Changes:**
- Added `validate_directory_permissions()` function
- Validates `/agents/*` directories are writable by UID 10000 before API starts
- Only runs for API mode (not for agent or one-off runs)
- Early error detection with clear remediation hints
- Directly addresses: "failed to create /agents/kaseki-runs, /agents/kaseki-results, and /cache"

### Layer 4: Dockerfile Pre-Configuration ✅
**Files Modified:**
- `Dockerfile` (both build stages)

**Changes:**
- Added pre-build time configuration: `RUN git config --system --add safe.directory /agents/kaseki-agent`
- Eliminates need for runtime configuration
- Guarantees git is configured regardless of host setup state
- Works even if host setup is incomplete or skipped
- Baked into image: every container automatically has safe.directory configured

## Files Modified

### Code Changes
1. **src/startup/container-preflight.ts**
   - Auto-remediation logic with environment variable controls
   - Support for multiple git config scopes

2. **src/kaseki-api-types.ts**
   - Added `remediationAttemptError` field to PreflightCheck

3. **src/startup/container-preflight.test.ts** (NEW)
   - TDD test suite with 10+ test cases
   - Tests auto-remediation, env var controls, error handling

4. **scripts/kaseki-setup-host.sh**
   - System-wide git config (--system) in `ensure_git_safe_directory()`
   - System config check in `verify_git_safe_directory()`

5. **scripts/docker-entrypoint.sh**
   - Directory permission validation before API starts

6. **Dockerfile** (both stages)
   - Pre-build git safe.directory configuration

### Documentation Changes
1. **docs/ADVANCED_CONFIG.md**
   - New entries for `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE`
   - New entry for `KASEKI_SAFE_DIRECTORY_SCOPE`
   - Complete explanation of auto-remediation behavior

2. **docs/TROUBLESHOOTING.md**
   - New "Git Safe.directory Configuration Issues" section
   - Root cause explanation
   - Three-layer solution documentation
   - Manual troubleshooting steps
   - Best practices

3. **docs/DOCKER_SETUP.md**
   - New "Image Configuration: Pre-Configured Git Safe.directory" section
   - Explains what's pre-configured in image
   - When and how to reconfigure for custom paths

## Behavior Changes

### For Users
1. **After host setup**: Git safe.directory is now configured at system level (not just root user)
2. **Container startup**: Auto-remediation fixes missing git config automatically
3. **Preflight checks**: Should now pass consistently after host setup
4. **New environment variables**:
   - `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0` to disable auto-fixes (diagnostic mode)
   - `KASEKI_SAFE_DIRECTORY_SCOPE=system` to use system scope (default: global)

### For Operators
1. **Backward compatible**: Breaking changes are acceptable per requirements
2. **Better diagnostics**: Permission errors now caught early in docker-entrypoint.sh
3. **Layered approach**: Works even if one layer is incomplete or skipped
4. **Defense-in-depth**: Multiple fallbacks ensure git config is always present

## Testing Approach (TDD)

Created comprehensive test file at `src/startup/container-preflight.test.ts`:
- Mock-based tests for `spawnSync` and `fs` operations
- Tests cover:
  - Already-configured safe.directory (pass-through)
  - Not-configured safe.directory with auto-remediation enabled (success)
  - Auto-remediation disabled (respects env var)
  - Remediation failure (graceful error handling)
  - Environment variable scope selection
  - Custom checkout directory detection
  - Full diagnostics run integration

## Verification Steps

1. **Host Setup**
   ```bash
   sudo kaseki-agent host setup --fix
   git config --system --get-all safe.directory | grep kaseki-agent
   # Expected: /agents/kaseki-agent
   ```

2. **Preflight Check**
   ```bash
   sudo kaseki-agent host preflight
   # Expected: status "ok", all checks pass
   ```

3. **Container Startup**
   ```bash
   docker-compose restart kaseki-api
   docker-compose logs kaseki-api | grep "preflight\|safe.directory"
   # Expected: no git errors, permission validation passes
   ```

4. **API Endpoint**
   ```bash
   curl http://localhost:8080/api/preflight
   # Expected: status "ok", template check ok=true
   ```

## Design Decisions

1. **System-wide git config**: Chosen over global because it's visible to all users (UID 10000 containers)
2. **Auto-remediation default=enabled**: Makes container startup more robust and forgiving
3. **Dockerfile pre-configuration**: Eliminates runtime setup variance across deployments
4. **Permission validation in entrypoint**: Catches issues early before API starts
5. **Three fallback layers**: Ensures git config exists through: system config, auto-remediation, or Dockerfile
6. **Environment variables for control**: Allows operators to troubleshoot by disabling auto-remediation

## No Breaking Changes
- Old deployments continue to work (host setup still sets global config)
- New deployments benefit from system-wide config + auto-remediation
- All environment variables have sensible defaults
