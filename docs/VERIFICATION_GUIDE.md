# Verification & Testing Guide

## Quick Verification Checklist

### ✅ Phase 1: Host Setup Verification
```bash
# Run host setup
sudo kaseki-agent host setup --fix

# Check system-wide git config was set
git config --system --get-all safe.directory
# Expected output: /agents/kaseki-agent

# Check user-level config as fallback
git config --global --get-all safe.directory
# May or may not show /agents/kaseki-agent (depends on setup behavior)
```

### ✅ Phase 2: Host Preflight Verification
```bash
# Run preflight check
sudo kaseki-agent host preflight

# Expected output pattern:
# - All checks should pass (ok=true)
# - Template doctor should pass
# - Status should be "ok" (not "degraded")
```

### ✅ Phase 3: Container Startup Verification
```bash
# Restart the API container
docker-compose restart kaseki-api

# Check logs for successful startup
docker-compose logs kaseki-api | tail -20

# Expected: NO errors about git config or permissions
# Expected: "✅ All container preflight checks passed" or similar
```

### ✅ Phase 4: API Endpoint Verification
```bash
# Check the /api/preflight endpoint
curl http://localhost:8080/api/preflight | jq .

# Expected:
{
  "status": "ok",           # Not "degraded"
  "checks": [
    {
      "name": "git-safe-directory",
      "ok": true,
      "detail": "Git safe.directory is configured for /agents/kaseki-agent"
    },
    // ... other checks all ok=true
  ]
}
```

### ✅ Phase 5: Test Execution Verification
```bash
# Run the container preflight tests
npm test -- src/startup/container-preflight.test.ts --no-coverage

# Expected: All tests pass
# - Read-only mode tests
# - Auto-remediation tests
# - Environment variable control tests
# - Error handling tests
```

---

## Detailed Testing Scenarios

### Scenario A: Fresh Setup (Happy Path)
**Steps:**
1. Clean host: remove `/agents` directory
2. Run `sudo kaseki-agent host setup --fix`
3. Run `sudo kaseki-agent host preflight`
4. Check `docker-compose` logs
5. Query `/api/preflight` endpoint

**Expected Result:** All checks pass, status="ok"

### Scenario B: Pre-Configured Container (Dockerfile + Host Setup)
**Steps:**
1. Run host setup: `sudo kaseki-agent host setup --fix`
2. Build Docker image: `docker build -t kaseki-test:latest .`
3. Start container with new image
4. Check preflight endpoint

**Expected Result:** 
- Container starts immediately without remediation
- Git safe.directory already configured from Dockerfile
- All checks pass on first boot

### Scenario C: Auto-Remediation (Container Startup)
**Steps:**
1. Clear system git config: `sudo git config --system --remove-section safe || true`
2. Start container
3. Check logs for auto-remediation attempt
4. Verify `/api/preflight` eventually reports ok=true

**Expected Result:** 
- Container detects missing git config
- Auto-remediation runs automatically
- Eventually passes checks
- No user intervention needed

### Scenario D: Diagnostic Mode (Auto-Remediation Disabled)
**Steps:**
1. Set environment: `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0`
2. Clear system git config: `sudo git config --system --remove-section safe || true`
3. Start container
4. Check logs and preflight endpoint

**Expected Result:**
- Container reports git safe.directory is not configured
- Does NOT attempt auto-remediation
- Returns ok=false with remediation hint
- Status="degraded" (due to failed check)

### Scenario E: Custom Checkout Directory
**Steps:**
1. Setup with custom dir: `KASEKI_CHECKOUT_DIR=/custom/path sudo kaseki-agent host setup --fix`
2. Verify git config: `git config --system --get-all safe.directory | grep custom`
3. Start container with same custom dir
4. Check preflight

**Expected Result:**
- Git config has custom path
- Container auto-remediation respects custom path
- All checks pass for custom directory

### Scenario F: Directory Permission Issue
**Steps:**
1. Create `/agents` with restrictive permissions: `sudo mkdir -p /agents && sudo chmod 0700 /agents`
2. Start container
3. Check docker-entrypoint.sh validation output
4. Check `/api/preflight` endpoint

**Expected Result:**
- docker-entrypoint.sh permission validation fails with clear error
- API does NOT start
- Error message includes remediation: "run 'sudo kaseki-agent host setup --fix'"
- Container exits with code 1

---

## Manual Troubleshooting Commands

### Check Git Configuration Scopes
```bash
# System-wide config (all users)
git config --system --list | grep safe.directory

# User-level config
git config --global --list | grep safe.directory

# Current session
git config --get-all safe.directory
```

### Check Directory Permissions
```bash
# Check /agents directory
ls -ld /agents
# Expected: drwxr-xr-x ... 10000 10000 (or similar for UID 10000)

# Check subdirectories
ls -ld /agents/kaseki-*

# Test UID 10000 access
sudo -u \#10000 ls -la /agents/kaseki-results
# Should succeed without permission errors
```

### Test Git Operations as UID 10000
```bash
# Run git command as UID 10000 (container user)
sudo -u \#10000 git -C /agents/kaseki-agent rev-parse HEAD
# Should succeed, not report "dubious ownership"
```

### View Container Environment Variables
```bash
# Check what's set in running container
docker-compose exec kaseki-api env | grep -i KASEKI_

# Check git config visible to container
docker-compose exec kaseki-api git config --system --get-all safe.directory
```

---

## Expected Test Output

### npm test output (successful)
```
PASS src/startup/container-preflight.test.ts
  ContainerPreflightDiagnostics
    checkGitSafeDirectory - Read-Only Mode
      ✓ should return ok=true when git safe.directory is already configured (15 ms)
      ✓ should return ok=false when git safe.directory is not configured (3 ms)
      ✓ should show currently configured directories in diagnostic message (2 ms)
      ✓ should return ok=false when .git directory does not exist (2 ms)
    checkGitSafeDirectory - Auto-Remediation
      ✓ should auto-remediate when config is missing and auto-remediate is enabled (8 ms)
      ✓ should respect KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 to skip remediation (4 ms)
      ✓ should gracefully handle remediation failure (6 ms)
      ✓ should use --system config if KASEKI_SAFE_DIRECTORY_SCOPE=system (5 ms)
    checkGitSafeDirectory - Custom Scope
      ✓ should detect checkout directory from environment variable (2 ms)
    Full diagnostics run
      ✓ should include checkGitSafeDirectory in full run (8 ms)

Tests: 11 passed, 11 total
```

### docker-compose logs output (successful)
```
kaseki-api    | {"timestamp":"2026-06-06T10:05:00Z","level":"info","component":"container-preflight","message":"✅ All container preflight checks passed"}
kaseki-api    | {"timestamp":"2026-06-06T10:05:01Z","level":"debug","component":"container-preflight","message":"Container preflight checks completed","checkCount":7,"totalElapsedMs":"123.4"}
kaseki-api    | {"timestamp":"2026-06-06T10:05:02Z","level":"info","component":"kaseki-api","message":"API server listening on port 8080"}
```

### curl /api/preflight output (successful)
```json
{
  "status": "ok",
  "timestamp": "2026-06-06T10:05:02.123Z",
  "checks": [
    {
      "name": "setup-completeness",
      "ok": true,
      "detail": "Required /agents subdirectories exist and are readable",
      "elapsedMs": 2.3
    },
    {
      "name": "git-safe-directory",
      "ok": true,
      "detail": "Git safe.directory is configured for /agents/kaseki-agent",
      "elapsedMs": 1.2
    }
    // ... more checks, all ok=true
  ]
}
```

---

## Rollback Plan (If Needed)

If issues arise, rollback is straightforward:

### Rollback Container Auto-Remediation
```bash
# Disable auto-remediation (still checks, doesn't fix)
KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0 docker-compose up -d
```

### Rollback Host Git Config
```bash
# Remove system-wide config (if causing issues)
sudo git config --system --remove-section safe

# Restore user-level config (old behavior)
git config --global --add safe.directory /agents/kaseki-agent
```

### Rollback Dockerfile (Rebuild Old Image)
```bash
# Use the pre-remediation image version
# OR rebuild from git before these changes
git checkout HEAD~N  # Go back to before changes
docker build -t kaseki-agent:rollback .
```

---

## Success Criteria

✅ All checklist items pass  
✅ Tests pass: `npm test -- src/startup/container-preflight.test.ts`  
✅ Preflight endpoint returns status="ok"  
✅ No git-related errors in container logs  
✅ No permission-related errors in container logs  
✅ Directory permission validation passes in docker-entrypoint  
✅ Auto-remediation respects environment variable controls  
✅ Works with custom checkout directories  
