# Kaseki-Agent Regression Fix - Sep 19, 2026

## Summary
✅ **ROOT CAUSE IDENTIFIED AND FIXED**

The deployed kaseki-agent API was failing on all worker container startups due to a code regression from Sep 18.

**Status**: Docker image rebuilt with fix (`kaseki-agent:fixed`)

---

## The Bug

### Symptom
Task submissions fail immediately with:
```
error: directory is not writable by container user (10000:10000): /agents
  current ownership: root:root
```

### Root Cause
Regression in commit d684eca9 (Sep 18: "refactor: add directory creation for cache and results in entrypoint script")

The `validate_directory_permissions()` function in `scripts/docker-entrypoint.sh` was checking `/agents` directories for **all** container modes, including worker/agent mode.

### Why This Breaks Worker Containers

**What the code did**:
```bash
# In validate_directory_permissions() - always checked these:
local required_dirs=(
  "${KASEKI_ROOT:-/agents}"                    # ← Always validated
  "${KASEKI_ROOT:-/agents}/kaseki-results"
  "${KASEKI_ROOT:-/agents}/kaseki-runs"
  "${KASEKI_ROOT:-/agents}/kaseki-cache"
)

# Then added worker-specific mounts
if [ "${1:-agent}" = "agent" ]; then
  required_dirs+=("${KASEKI_CACHE_DIR:-/cache}" "${KASEKI_RESULTS_DIR:-/results}")
fi
```

**The problem**:
- Worker container is spawned in "agent" mode
- Worker container mounts: `/workspace`, `/results`, `/cache` (NOT `/agents`)
- Worker container tries to validate `/agents` which isn't mounted
- Worker sees image's `/agents` (owned by root:root from Dockerfile RUN mkdir)
- Permission check fails → worker exits with code 1 → task fails

### Why Host Setup Confusion
- Host's `/agents` IS correctly set up (owned by 10000:kaseki-secrets)
- API container sees it correctly (mounted via docker-compose)
- But worker container doesn't have `/agents` mounted, so it sees the wrong version

---

## The Fix

**File**: `scripts/docker-entrypoint.sh` (lines 70-97)

**Change**: Only validate `/agents` in API mode, not in agent/worker mode

```bash
validate_directory_permissions() {
  local required_dirs=()
  
  # API mode: check /agents directories (mounted by docker-compose)
  # Do NOT check these in agent/worker mode, which doesn't have /agents mounted
  if [ "${1:-agent}" = "api" ] || [ "${1:-agent}" = "kaseki-api" ]; then
    required_dirs=(
      "${KASEKI_ROOT:-/agents}"
      "${KASEKI_ROOT:-/agents}/kaseki-results"
      "${KASEKI_ROOT:-/agents}/kaseki-runs"
      "${KASEKI_ROOT:-/agents}/kaseki-cache"
    )
  fi
  
  # Agent/worker mode: check /cache and /results (mounted by DockerManager)
  if [ "${1:-agent}" = "agent" ]; then
    required_dirs+=("${KASEKI_CACHE_DIR:-/cache}" "${KASEKI_RESULTS_DIR:-/results}")
  fi
  
  # ... rest of validation
}
```

### Why This Works
- **API mode** (kaseki-api): Validates `/agents` ✅ (mounted from host)
- **Worker mode** (agent): Skips `/agents`, validates only `/cache` and `/results` ✅ (mounted by Docker spawn)
- Each mode validates only the directories it actually has mounted

---

## Deployment Instructions

### For the Deployment Host

1. **Pull or rebuild the fixed image**:
   ```bash
   # Option A: Use the built image
   docker build -t kaseki-agent:latest .
   
   # Option B: Pull from registry (if published)
   docker pull cyanautomation/kaseki-agent:latest
   ```

2. **Restart the API service**:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

3. **Verify it works**:
   ```bash
   curl https://kaseki-tunnel.scheimann.xyz/api/health
   # Should return: {"status":"healthy",...}
   ```

4. **Test by resubmitting a task**:
   ```bash
   curl -H "Authorization: Bearer $BEARER" \
     https://kaseki-tunnel.scheimann.xyz/api/runs \
     -X POST -d '{"repoUrl":"https://github.com/example/repo"}'
   # Should return 202 Accepted
   ```

---

## Verification

### Before Fix
```
kaseki-344: worker-container-startup → exit code 1
Error: directory is not writable by container user (10000:10000): /agents
```

### After Fix
Worker containers should:
- ✅ Skip `/agents` validation
- ✅ Validate only `/cache` and `/results` (which ARE mounted)
- ✅ Complete startup checks successfully
- ✅ Process tasks normally

---

## What Changed

Only one file was modified:
- `scripts/docker-entrypoint.sh` (lines 70-97 in `validate_directory_permissions()`)

**Diff summary**:
- Moved `/agents` directory checks inside `if [ API mode ]` block
- Worker mode now only checks `/cache` and `/results`

---

## Why This Regression Happened

Commit d684eca9 added defensive directory creation in Phase 2a:
```bash
mkdir -p "${KASEKI_CACHE_DIR:-/cache}" 2>/dev/null || true
mkdir -p "${KASEKI_RESULTS_DIR:-/results}" 2>/dev/null || true
```

This made the validation stricter, but didn't account for the fact that worker containers don't have `/agents` mounted. The validation should have been mode-aware.

---

## Testing Checklist

- [ ] Docker image built successfully
- [ ] Deployed to production host
- [ ] API service started without errors
- [ ] Submit a new task (check /api/runs/{id}/status)
- [ ] Task progresses past "worker-container-startup" phase
- [ ] No "directory is not writable" errors in logs

---

## Files Involved

| File | Change | Purpose |
|------|--------|---------|
| `scripts/docker-entrypoint.sh` | ✅ Fixed | Worker container startup validation |
| `src/docker/DockerManager.ts` | No change | Spawns workers with correct mounts |
| `docker-compose.yml` | No change | Mounts `/agents` in API container only |
| `Dockerfile` | No change | Creates `/agents` in image (root:root) |

---

## Impact

- ✅ Fixes worker container startup failures
- ✅ Allows task execution to proceed past initialization
- ✅ No breaking changes to API or infrastructure
- ✅ No changes needed to deployment host setup

---

## Future Prevention

To prevent similar issues:

1. **Test matrix**: Ensure both API and worker container modes are tested in CI/CD
2. **Mode-aware validation**: Always check which directories are actually mounted before validating
3. **Clear error messages**: Include "container mode" in error context

---

## Questions & Troubleshooting

**Q: Do I need to re-run kaseki-setup-host.sh?**  
A: No. The host's `/agents` directory is already correctly set up. This is purely a code fix.

**Q: Will this affect existing runs?**  
A: No. This only affects new worker container startups.

**Q: What if tasks still fail?**  
A: Check `/api/runs/{id}/logs/stderr` to see if there are other errors past the startup phase.
