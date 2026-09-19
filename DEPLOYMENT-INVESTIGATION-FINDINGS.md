# Kaseki-Agent Deployment Investigation - Findings Report

**Date**: September 2026  
**Status**: Investigation Complete ✅  
**Severity**: Critical (non-functional deployment, not a code defect)

---

## Summary

The deployed kaseki-agent API at `kaseki-tunnel.scheimann.xyz/api` is **non-functional** due to **incomplete host infrastructure setup**. The codebase is high-quality, but a critical deployment prerequisite was skipped.

When task `kaseki-344` was submitted (to improve README.md), it failed during worker initialization because the host's `/agents` directory structure was never created.

---

## Root Cause

**Missing Prerequisite**: `sudo scripts/kaseki-setup-host.sh --fix` was not executed on the deployment host.

### What Should Happen

```
1. git clone kaseki-agent repo ✅
2. Build image: docker build -t kaseki-agent:latest . ✅
3. *** HOST SETUP (NOT DONE) ***
   sudo scripts/kaseki-setup-host.sh --fix
   Creates: /agents, /agents/kaseki-results, /agents/kaseki-runs
   Sets ownership: 10000:10000 (container UID)
   
4. Start API: docker-compose up -d ✅
5. Submit task: Works! ✅
```

### What Actually Happened

```
1. git clone ✅
2. Build image ✅
3. *** SKIPPED ***
4. docker-compose up -d ✅
   API starts successfully (checks only run when first task submitted)
5. Task submission ❌
   Worker container tries to mount /agents/kaseki-results
   Mount fails: directory doesn't exist on host
```

---

## The Issue Chain

```
┌─ Task submitted to API (kaseki-344)
│  POST /api/runs → HTTP 202 Accepted
│
├─ API queues task ✅
│
├─ Worker container initializes
│  docker run -v /agents/kaseki-results:/results:rw ...
│
├─ Docker tries to mount host volume ❌
│  Host path /agents/kaseki-results doesn't exist
│  Mount fails
│
└─ Task marked as FAILED
   No artifacts created
   User gets generic error message
```

---

## Code Quality Assessment

### Codebase: ✅ EXCELLENT

**Strengths**:

- ✅ Good separation of concerns (API service, worker orchestration, setup)
- ✅ Proper error handling with fallbacks
- ✅ Comprehensive startup validation in `docker-entrypoint.sh`
- ✅ Clear documentation in code comments
- ✅ Unified validation infrastructure (`validation-stages.sh`)
- ✅ Security hardening (UID 10000, capability dropping)
- ✅ Multi-stage Docker build optimized for caching

**Validation Checklist Results**:

```
✅ Dockerfile ..................... Proper (Node 24, UID 10000)
✅ docker-compose.yml ............. Correct volume mount definitions
✅ Setup script ................... Exists and functional
✅ API service code ............... Has checks (ensureResultsDir, permissions)
✅ Startup validation ............ Has directory permission checks
✅ Validation framework .......... Unified infrastructure in place
```

### Deployment Readiness: ⚠️ NEEDS IMPROVEMENT

**Issues**:

1. ❌ API doesn't block startup if `/agents` is missing
   - Only fails when first task is submitted
   - Should fail at container startup with clear message

2. ❌ Error messages not actionable
   - "Results directory is not ready" (generic)
   - Should say: "Run `sudo scripts/kaseki-setup-host.sh --fix` on host"

3. ⚠️ Setup step not prominently featured in docs
   - DEPLOYMENT.md has it ✅
   - QUICK_START.md doesn't emphasize it ⚠️

4. ⚠️ Setup not automated in docker-compose
   - Requires manual intervention with sudo
   - Could be automated with init container

---

## IMMEDIATE FIX (For Deployment Host)

Run this command with sudo on the deployment host:

```bash
cd /path/to/kaseki-agent
sudo scripts/kaseki-setup-host.sh --fix
docker-compose down
docker-compose up -d
```

**What this does**:

1. Creates `/agents` directory
2. Creates subdirectories: `kaseki-results`, `kaseki-runs`, `kaseki-template`
3. Sets ownership to 10000:10000 (container UID/GID)
4. Sets correct permissions (755)
5. Creates log directories
6. Validates git safe.directory configuration

**Verify it worked**:

```bash
sudo scripts/kaseki-setup-host.sh --check-only
# Should report: ok: /agents, ok: /agents/kaseki-results, etc.
```

---

## Code Improvements (Priority Order)

### 🔴 CRITICAL: Add Fail-Fast Validation in API Startup

**File**: `src/kaseki-api-service.ts` (line ~127)

**Current behavior**:

```typescript
try {
  ensureResultsDir(config.resultsDir);
} catch (err) {
  logger.error('Results directory is not ready:', {...});
  process.exit(1);  // This works, but message isn't actionable
}
```

**Improvement**: Block API startup and provide remediation:

```typescript
function validateHostSetup(resultsDir: string): void {
  const requiredDirs = [
    path.dirname(resultsDir),           // /agents
    resultsDir,                         // /agents/kaseki-results
    path.join(path.dirname(resultsDir), 'kaseki-runs'),
  ];
  
  const missing = requiredDirs.filter(d => !fs.existsSync(d));
  if (missing.length > 0) {
    throw new Error(
      `Host setup incomplete. Run this on the host:\n` +
      `  sudo scripts/kaseki-setup-host.sh --fix\n` +
      `Missing directories: ${missing.join(', ')}`
    );
  }
}
```

**Impact**: Catches deployment issues at boot time, not after first task submission.

---

### 🟠 HIGH: Improve Error Messages in Run Submission

**File**: `src/kaseki-api-routes.ts` (run submission handler)

**When task submission fails due to missing `/agents`:**

Current:

```json
{
  "error": "Results directory is not ready",
  "requestId": "req-123"
}
```

Better:

```json
{
  "error": "Cannot initialize worker: /agents/kaseki-results not accessible",
  "remedy": "Host must run: sudo scripts/kaseki-setup-host.sh --fix",
  "details": "Worker container needs /agents directory mounted from host",
  "requestId": "req-123"
}
```

---

### 🟡 MEDIUM: Add Pre-flight Check for `/agents` Directory Structure

**File**: `src/kaseki-api-health-checks.ts`

Add to pre-flight validation:

- Check `/agents` directory exists
- Check `/agents/kaseki-results` is writable
- Check `/agents/kaseki-runs` exists
- Report in `/api/preflight` response

**Current**: Checks Docker, Pi CLI, GitHub App  
**Better**: Also checks `/agents` subdirectory readiness

---

### 🟡 MEDIUM: Automate Setup in docker-compose

**File**: `docker-compose.yml`

Option 1: Add init container (with `--profile init`):

```yaml
services:
  kaseki-init:
    image: alpine:latest
    command: mkdir -p /agents/{kaseki-template,kaseki-results,kaseki-runs}
    volumes:
      - /agents:/agents:rw
    profiles: ["init"]

  kaseki-api:
    # ... existing config
```

Option 2: Document in docker-compose comments more prominently

---

### 🟢 LOW: Update Documentation

**File**: `docs/QUICK_START.md`

Add prominent section at top:

```markdown
## ⚠️ CRITICAL: Host Setup Required

Before starting kaseki-agent, your host MUST run this setup command once:

    sudo scripts/kaseki-setup-host.sh --fix

This creates the required `/agents` directory structure that kaseki needs.
Skipping this step will cause task submissions to fail.
```

---

## Key Files Involved

### Infrastructure & Setup

- `scripts/kaseki-setup-host.sh` .......... Creates `/agents` directory structure
- `scripts/docker-entrypoint.sh` ........ Validates permissions on startup
- `docker-compose.yml` ................ Volume mount definitions
- `Dockerfile` ...................... Container user/group setup

### API Service

- `src/kaseki-api-service.ts` ........ Checks `ensureResultsDir()`
- `src/kaseki-api-config.ts` ....... Loads `KASEKI_RESULTS_DIR` env var
- `src/kaseki-api-routes.ts` ...... Handle run submission errors
- `src/kaseki-api/setup-orchestrator.ts` . Auto-initialization logic

### Validation & Health

- `scripts/validation-stages.sh` ..... Unified validation framework
- `src/kaseki-api-health-checks.ts` .. Pre-flight diagnostics
- `src/startup/container-preflight.ts` .. Startup checks

---

## What Works Well

✅ **Dockerfile**  

- Multi-stage build optimized  
- UID 10000 configured properly  
- Node 24 base image  
- Security hardening in place  

✅ **Docker Compose**  

- Volume mounts defined correctly  
- User/group permissions set  
- Port mapping configured  

✅ **Setup Script**  

- Functional and comprehensive  
- Creates all needed directories  
- Sets correct ownership/permissions  
- Has `--check-only` mode for verification  

✅ **API Service Code**  

- Has directory validation checks  
- Good error handling  
- Multiple fallback strategies  

✅ **Startup Validation**  

- `docker-entrypoint.sh` validates permissions (lines 60-104)  
- Checks for UID 10000 write access  
- Clear error messages about what's missing  

---

## What Needs Work

❌ **API doesn't block startup if `/agents` missing**  

- Only detected when first task submitted  
- Should be fail-fast at container startup  

❌ **Error messages lack remediation guidance**  

- Users don't know to run `kaseki-setup-host.sh --fix`  
- Generic message: "Results directory is not ready"  

❌ **Documentation doesn't emphasize setup step**  

- QUICK_START.md should highlight this prerequisite  
- Some users miss setup step entirely  

❌ **Setup not automated in standard deployment flow**  

- Requires manual `sudo` command  
- Opportunity for automation with init container  

---

## Testing Validation Checklist

### Test 1: Verify Current Deployment Issue

```bash
# Verify that /agents doesn't exist (or isn't writable)
ls -la /agents 2>&1 | head -5
# Expected: "No such file or directory"

# Verify API started despite this
curl http://localhost:8080/api/health
# Expected: 200 OK (hides the real problem)

# Try to submit a task
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer <token>" \
  -d '{"repoUrl":"https://github.com/example/repo"}'
# Expected: 202 Accepted (but worker fails)
```

### Test 2: Verify Fix Works

```bash
# Run setup
sudo scripts/kaseki-setup-host.sh --fix

# Verify directories created
ls -la /agents/kaseki-{results,runs,template}

# Check ownership
stat /agents/kaseki-results | grep Uid
# Expected: Uid: 10000(kaseki)

# Restart API
docker-compose down
docker-compose up -d

# Now tasks should work
curl -X POST http://localhost:8080/api/runs \
  -H "Authorization: Bearer <token>" \
  -d '{"repoUrl":"https://github.com/example/repo"}'
# Expected: 202 Accepted, task actually processes
```

### Test 3: Fresh Deployment Test

```bash
# On a clean host without /agents:
docker-compose up -d
# Should either:
# A) Start and report not ready in pre-flight
# B) Fail with clear message about missing setup

# Then setup and retry
sudo scripts/kaseki-setup-host.sh --fix
docker-compose down && docker-compose up -d
# Should work now
```

---

## Summary of Issues

| Issue | Severity | Type | Fix |
| ------- | ---------- | ------ | ----- |
| `/agents` not created | **CRITICAL** | Setup | Run `kaseki-setup-host.sh --fix` |
| API doesn't block startup | High | Code | Add fail-fast validation |
| Error messages not actionable | High | UX | Include remediation steps |
| Setup not highlighted in docs | Medium | Doc | Update QUICK_START.md |
| Setup not automated | Medium | DevOps | Add init container option |

---

## Conclusion

**The kaseki-agent codebase is HIGH QUALITY and well-designed.**

The deployment failure is due to:

- ✅ Infrastructure setup checklist (thorough and functional)
- ✅ Code quality (excellent separation of concerns)
- ❌ **Deployment process missing a critical prerequisite step**
- ❌ **Fail-fast validation not in place**

**One-line immediate fix**:  
`sudo scripts/kaseki-setup-host.sh --fix`

**Long-term improvements**:

1. Add fail-fast validation in API startup
2. Improve error messages with actionable remediation
3. Automate setup in docker-compose or deployment CI/CD
4. Prominently document setup requirement

---

## References

- **Setup Script**: `scripts/kaseki-setup-host.sh`
- **Docker Entrypoint**: `scripts/docker-entrypoint.sh` (validation at lines 60-104)
- **API Service**: `src/kaseki-api-service.ts` (directory checks at line 127)
- **Documentation**: `docs/DEPLOYMENT.md`, `docs/QUICK_START.md`
- **Docker Compose**: `docker-compose.yml` (volume mount definitions)
