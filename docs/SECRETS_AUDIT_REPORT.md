# Kaseki Agent: Complete Secrets Management Audit

**Date**: May 19, 2026  
**Status**: Comprehensive audit completed  
**Key Finding**: GitHub App credential path mismatch identified; all other secrets correctly configured

---

## Executive Summary

This report documents the **complete secrets handling architecture** across all three execution layers of kaseki-agent:

1. **API Service Layer** (Docker container) - reads from `/run/secrets/kaseki/`
2. **Controller Layer** (run-kaseki.sh on host) - creates ephemeral mounts
3. **Worker Layer** (kaseki-agent.sh in container) - receives secrets via mounts

**Critical Finding**: GitHub App credentials have a path mismatch between where they're mounted by the controller and where the worker looks for them. OpenRouter API keys and Kaseki API keys are correctly configured.

---

## Part 1: Secret Types and Inventory

### All Secrets Currently Managed

| Secret | Purpose | Type | API Service Mount | Worker Mount | Env Var | Status |
|--------|---------|------|-------------------|--------------|---------|--------|
| OpenRouter API Key | AI model inference | File-based | `/run/secrets/kaseki/openrouter_api_key` | `/agents/secrets/openrouter_api_key` | `OPENROUTER_API_KEY_FILE` | ✓ Working |
| GitHub App ID | GitHub OAuth identifier | File-based | `/run/secrets/github_app_id` | `/run/secrets/github_app_id` | `GITHUB_APP_ID_FILE` | ✗ Mismatch |
| GitHub App Client ID | GitHub OAuth client | File-based | `/run/secrets/github_app_client_id` | `/run/secrets/github_app_client_id` | `GITHUB_APP_CLIENT_ID_FILE` | ✗ Mismatch |
| GitHub App Private Key | GitHub signing key | File-based (PEM) | `/run/secrets/github_app_private_key` | `/run/secrets/github_app_private_key` | `GITHUB_APP_PRIVATE_KEY_FILE` | ✗ Mismatch |
| Kaseki API Keys | External agent auth | File-based (newline-separated) | `/run/secrets/kaseki/kaseki_api_keys` | N/A (API only) | `KASEKI_API_KEYS` (inline or file) | ✓ Working |

---

## Part 2: Docker Volume Mounts (Complete Inventory)

### Docker Compose Volume Mounts (API Service)

**File**: `docker-compose.yml` lines 54-71

```yaml
volumes:
  # OpenRouter and other API service secrets
  - ${KASEKI_HOST_SECRETS_DIR:-/home/pi/secrets}:/run/secrets/kaseki:ro
  
  # GitHub App secrets (individual file mounts at root level)
  - ${KASEKI_HOST_GITHUB_APP_ID:-/home/pi/secrets/github_app_id}:/run/secrets/github_app_id:ro
  - ${KASEKI_HOST_GITHUB_APP_CLIENT_ID:-/home/pi/secrets/github_app_client_id}:/run/secrets/github_app_client_id:ro
  - ${KASEKI_HOST_GITHUB_APP_PRIVATE_KEY:-/home/pi/secrets/github_app_private_key}:/run/secrets/github_app_private_key:ro
```

**Environment Variables Set in API Container**:
```yaml
KASEKI_SECRETS_DIR: "/run/secrets/kaseki"
OPENROUTER_API_KEY_FILE: "/run/secrets/kaseki/openrouter_api_key"
GITHUB_APP_ID_FILE: "/run/secrets/github_app_id"
GITHUB_APP_CLIENT_ID_FILE: "/run/secrets/github_app_client_id"
GITHUB_APP_PRIVATE_KEY_FILE: "/run/secrets/github_app_private_key"
```

### Controller (run-kaseki.sh) Volume Mounts

**File**: `run-kaseki.sh` lines 1095-1115

**OpenRouter Mount**:
```bash
-v "$SECRET_FILE:/agents/secrets/openrouter_api_key:ro"
-e OPENROUTER_API_KEY_FILE="/agents/secrets/openrouter_api_key"
```

**GitHub App Mounts**:
```bash
if [ "$GITHUB_APP_ENABLED" = "1" ]; then
  docker_args+=(
    -v "$GITHUB_APP_ID_FILE:/run/secrets/github_app_id:ro"
    -v "$GITHUB_APP_CLIENT_ID_FILE:/run/secrets/github_app_client_id:ro"
    -v "$GITHUB_APP_PRIVATE_KEY_MOUNTED_FILE:/run/secrets/github_app_private_key:ro"
  )
fi
```

**Critical**: No `KASEKI_SECRETS_DIR` or explicit `GITHUB_APP_*_FILE` env vars passed to worker!

### Worker Container Mounts (Received)

**Expected mounts**:
- OpenRouter: `/agents/secrets/openrouter_api_key` ✓ explicit
- GitHub App: `/run/secrets/github_app_*` ✓ mounted but no env var passed

---

## Part 3: Environment Variable Passing Between Layers

### Layer Flow

```
Docker Compose (API Service)
    ↓
    ├─ Sets: GITHUB_APP_ID_FILE=/run/secrets/github_app_id (API service context)
    │
Job Scheduler (Node.js in API Service)
    ↓
    ├─ Resolves secrets via host-secrets-reader.ts
    ├─ Passes: GITHUB_APP_ID_FILE=<resolved-path> to worker
    │
Controller (run-kaseki.sh)
    ↓
    ├─ Receives job request with env vars
    ├─ Mounts secrets at: /run/secrets/github_app_id
    ├─ Does NOT pass GITHUB_APP_ID_FILE env var
    │
Worker Container (kaseki-agent.sh)
    ↓
    └─ Calls: resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id"
       └─ Defaults to: /run/secrets/kaseki/github_app_id (WRONG!)
```

### Job Scheduler Resolution

**File**: `src/job-scheduler.ts` lines 448-465

```typescript
private populateGitHubAppEnv(env: NodeJS.ProcessEnv): void {
  const githubAppSecretFiles = [
    ['GITHUB_APP_ID_FILE', 'github_app_id'],
    ['GITHUB_APP_CLIENT_ID_FILE', 'github_app_client_id'],
    ['GITHUB_APP_PRIVATE_KEY_FILE', 'github_app_private_key'],
  ] as const;

  for (const [envName, secretName] of githubAppSecretFiles) {
    const configuredPath = env[envName];
    if (configuredPath) {
      continue;  // Skip if already configured
    }
    
    const secretPath = getSecretFilePath(secretName);  // ← Resolves from host-secrets-reader
    if (fs.existsSync(secretPath)) {
      env[envName] = secretPath;  // ← Passes to worker
    }
  }
}
```

**Resolution via host-secrets-reader.ts**:

For GitHub App secrets, `getSecretFilePath()` returns:
1. `/run/secrets/github_app_id` if it exists (root level, API service layer)
2. Falls back to `/run/secrets/kaseki/github_app_id` if needed
3. Falls back to `~/.kaseki/secrets/github_app_id` (local dev)

The resolved path is then passed via environment variable to the worker.

---

## Part 4: Worker Secret Resolution

### OpenRouter API Key Resolution

**File**: `kaseki-agent.sh` line 2889

```bash
openrouter_api_key_file="${OPENROUTER_API_KEY_FILE:-/agents/secrets/openrouter_api_key}"
```

**Status**: ✓ Works because:
- Environment variable is **always explicitly set** by controller
- Defaults to `/agents/secrets/openrouter_api_key` if not set (matches controller mount)

### GitHub App Secret Resolution

**File**: `kaseki-agent.sh` lines 1934-1959

```bash
resolve_github_secret_file() {
  local env_name="$1"
  local default_name="$2"
  local explicit_value="" canonical_path local_dev_path
  
  # Step 1: Check for explicit environment variable
  explicit_value="${!env_name:-}"
  if [ -n "$explicit_value" ]; then
    printf '%s' "$explicit_value"
    return 0
  fi
  
  # Step 2: Default to KASEKI_SECRETS_DIR subdirectory
  canonical_path="${KASEKI_SECRETS_DIR:-/run/secrets/kaseki}/$default_name"
  if [ -r "$canonical_path" ]; then
    printf '%s' "$canonical_path"
    return 0
  fi
  
  # Step 3: Fallback to local dev (if enabled)
  if [ "$KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK" = "1" ]; then
    local_dev_path="$HOME/.kaseki/secrets/$default_name"
    if [ -r "$local_dev_path" ]; then
      printf '%s' "$local_dev_path"
      return 0
    fi
  fi
  
  # Step 4: Return canonical path (even if unreadable)
  printf '%s' "$canonical_path"
}
```

**Usage**: Called at three points in worker:
- Line 1784: `github_app_id_file="$(resolve_github_secret_file "GITHUB_APP_ID_FILE" "github_app_id")"`
- Line 1785: `github_app_client_id_file="$(resolve_github_secret_file "GITHUB_APP_CLIENT_ID_FILE" "github_app_client_id")"`
- Line 1786: `github_app_private_key_file="$(resolve_github_secret_file "GITHUB_APP_PRIVATE_KEY_FILE" "github_app_private_key")"`

**Status**: ✗ Path mismatch when:
- Env var NOT explicitly set (controller doesn't pass it)
- Defaults to `/run/secrets/kaseki/github_app_id` (wrong!)
- File actually at `/run/secrets/github_app_id` (mounted by controller)

---

## Part 5: Host-Secrets-Reader Implementation

**File**: `src/secrets/host-secrets-reader.ts` lines 67-125

### GitHub App Secret Resolution (Root-Level Priority)

```typescript
if (isGitHub) {
  // GitHub App secrets: check root level first (matches run-kaseki.sh controller mounts)
  const rootPath = path.join('/run/secrets', secretName);          // /run/secrets/github_app_id
  const kasekiSubdirPath = path.join(getPrimarySecretsDir(), secretName);  // /run/secrets/kaseki/github_app_id
  const fallbackPath = path.join(getFallbackSecretsDir(), secretName);     // ~/.kaseki/secrets/github_app_id

  // Try root level first (where run-kaseki.sh mounts them)
  if (fs.existsSync(rootPath)) {
    logger.info(`✓ Found ${secretName} at ${rootPath} (root level)`);
    return rootPath;  // ← RETURNS ROOT LEVEL
  }

  // Try kaseki subdirectory (legacy, for compatibility)
  if (fs.existsSync(kasekiSubdirPath)) {
    logger.info(`⚠ Found ${secretName} at ${kasekiSubdirPath} (kaseki subdir)`);
    return kasekiSubdirPath;
  }

  // Try local dev
  if (fs.existsSync(fallbackPath)) {
    logger.info(`⚠ Found ${secretName} at ${fallbackPath} (local dev)`);
    return fallbackPath;
  }

  return null;
}
```

**Key insight**: The host-secrets-reader **correctly** prefers `/run/secrets/github_app_id` (root level) over `/run/secrets/kaseki/github_app_id` (subdirectory) because it knows where the controller mounts them.

This resolved path is then passed to the worker via job scheduler, but the **worker doesn't receive the env var** unless it's explicitly set in docker_args.

---

## Part 6: Reference Count by Type

### By Secret Type

| Secret | Path References | File Count | Key Files |
|--------|---|---|---|
| OpenRouter API Key | 20+ | 8 | docker-compose.yml, README.md, run-kaseki.sh, kaseki-agent.sh |
| GitHub App ID | 15+ | 6 | docker-compose.yml, run-kaseki.sh, kaseki-agent.sh, tests/* |
| GitHub App Client ID | 15+ | 6 | docker-compose.yml, run-kaseki.sh, kaseki-agent.sh, tests/* |
| GitHub App Private Key | 15+ | 6 | docker-compose.yml, run-kaseki.sh, kaseki-agent.sh, tests/* |
| Kaseki API Keys | 15+ | 6 | kaseki-api-config.ts, docker-compose.yml, .env.example |

### By Function/Variable

| Reference | Count | Files |
|---|---|---|
| `KASEKI_SECRETS_DIR` | 16 | docker-compose.yml, kaseki-agent.sh, startup-checks.sh, tests/*, docs/* |
| `resolve_github_secret_file()` | 14 | kaseki-agent.sh, startup-checks.sh, tests/* (call sites) |
| `getSecretFilePath()` | 7 | src/job-scheduler.ts, src/job-scheduler.test.ts, src/secrets/host-secrets-reader.ts |
| Docker volume mounts (`-v`) | 7 | run-kaseki.sh, docker-compose.yml, src/docker/DockerManager.ts, src/cli/launchers/ContainerLauncher.ts |
| `KASEKI_ALLOW_LOCAL_DEV_SECRET_FALLBACK` | 7 | kaseki-agent.sh, startup-checks.sh, tests/* |

---

## Part 7: Documentation Path References

### Stale or Inconsistent References

| File | Line | Path | Correct Path | Status |
|---|---|---|---|---|
| [.env.example](/.env.example#L14) | 14 | `/agents/secrets/{secret-name}` | Context-dependent | ⚠️ INCOMPLETE |
| [.env.example](/.env.example#L37-L39) | 37-39 | `/agents/secrets/github_app_*` | `/run/secrets/github_app_*` | ⚠️ STALE |
| [README.md](README.md#L1277) | 1277 | `/agents/secrets/github_app_private_key` | `/run/secrets/github_app_private_key` | ⚠️ STALE |
| [README.md](README.md#L125-L127) | 125-127 | Various paths | **Mixed** | ⚠️ NEEDS AUDIT |
| [CLAUDE.md](CLAUDE.md#L198-L211) | 198-211 | `KASEKI_API_KEYS` | Correct | ✓ Accurate |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#L399-L408) | 399-408 | `KASEKI_SECRETS_DIR` | Correct | ✓ Accurate |

---

## Part 8: Path Mismatches - Complete Status

### ✓ No Issues

**OpenRouter API Key**:
- API Service: `/run/secrets/kaseki/openrouter_api_key` ✓
- Controller: `/agents/secrets/openrouter_api_key` (temp) ✓
- Worker: `/agents/secrets/openrouter_api_key` ✓
- **Reason**: Environment variable explicitly set by controller, so path is always known

**Kaseki API Keys**:
- API Service: `/run/secrets/kaseki/kaseki_api_keys` ✓
- Controller: N/A (API service only)
- **Reason**: Only used in API service layer, no multi-layer complexity

### ✗ Issues Identified

**GitHub App Credentials**:

| Layer | Mounts At | Expects | Mismatch |
|---|---|---|---|
| Docker Compose | `/run/secrets/github_app_id` | N/A | N/A |
| Job Scheduler | Resolves to `/run/secrets/github_app_id` | N/A | N/A |
| Controller | `/run/secrets/github_app_id` | N/A | N/A |
| Worker default lookup | N/A | `/run/secrets/kaseki/github_app_id` | ✗ WRONG |

**Problem**: Worker's `resolve_github_secret_file()` defaults to `KASEKI_SECRETS_DIR=/run/secrets/kaseki` when env var not set.

**Root Cause**: Controller doesn't pass `GITHUB_APP_*_FILE` env vars to worker (unlike OpenRouter).

**Solution Options**:
1. **Option A** (Recommended): Set `-e KASEKI_SECRETS_DIR=/run/secrets` in controller's docker_args
2. **Option B**: Pass explicit `-e GITHUB_APP_ID_FILE=/run/secrets/github_app_id` in controller's docker_args
3. **Option C**: Mount GitHub secrets under `/run/secrets/kaseki/` instead (more invasive)

---

## Part 9: Test Coverage

### Test Files Covering Secrets

| Test File | Coverage |
|---|---|
| [tests/github-preflight-secrets-dir-resolution.test.sh](tests/github-preflight-secrets-dir-resolution.test.sh) | Tests KASEKI_SECRETS_DIR resolution defaults and fallbacks |
| [tests/github-preflight-auth.test.sh](tests/github-preflight-auth.test.sh) | Tests GitHub auth with secret file patching |
| [tests/github-preflight-helper-load.test.sh](tests/github-preflight-helper-load.test.sh) | Tests helper loading with path substitution |
| [tests/github-operations-failures.test.sh](tests/github-operations-failures.test.sh) | Tests operations with mount verification |
| [src/job-scheduler.test.ts](src/job-scheduler.test.ts) | Tests GitHub App env var population |
| [src/kaseki-api-service.test.ts](src/kaseki-api-service.test.ts) | Tests API service secret handling |
| [src/secrets/host-secrets-reader.test.ts](src/secrets/host-secrets-reader.test.ts) | Tests secret path resolution |

### Test Anomaly

**File**: [tests/github-preflight-helper-load.test.sh](tests/github-preflight-helper-load.test.sh#L42-L47)

```bash
# Patches BOTH old and new paths!
-e "s#/agents/secrets/github_app_id#$SECRETS_DIR/github_app_id#g"       # Old path
-e "s#/run/secrets/github_app_id#$SECRETS_DIR/github_app_id#g"         # Current path
```

**Implication**: Suggests code transitioned between mount schemes. Should clean up old path once stable.

---

## Part 10: Summary Table

| Aspect | OpenRouter | GitHub App | Kaseki API Keys |
|--------|---|---|---|
| **API Service Mount** | `/run/secrets/kaseki/openrouter_api_key` | `/run/secrets/github_app_*` | `/run/secrets/kaseki/kaseki_api_keys` |
| **Controller Mount** | `/agents/secrets/openrouter_api_key` | `/run/secrets/github_app_*` | N/A |
| **Worker Mount Receives** | `/agents/secrets/openrouter_api_key` | `/run/secrets/github_app_*` | N/A |
| **Worker Lookup Path** | Explicit env var | Default (wrong!) | N/A |
| **Status** | ✓ Working | ✗ Mismatch | ✓ Working |
| **Env Var Explicit?** | Yes | No | N/A |
| **Path Consistency** | ✓ All layers aligned | ✗ Worker lookup wrong | ✓ Correct |

---

## Recommendations

### Immediate Actions

1. **Fix GitHub App Path Mismatch**: Add to `run-kaseki.sh` around line 1040:
   ```bash
   -e KASEKI_SECRETS_DIR="/run/secrets"  # Add this line
   ```
   This tells the worker to look for secrets at `/run/secrets/` instead of the default `/run/secrets/kaseki/`.

2. **Update Documentation**:
   - [.env.example](/.env.example): Add context labels (API vs Worker)
   - [README.md](README.md): Update GitHub App paths to `/run/secrets/`
   - Add new [docs/SECRETS_ARCHITECTURE.md](docs/SECRETS_ARCHITECTURE.md) with complete reference

3. **Clean Up Tests**:
   - Remove old `/agents/secrets/github_app_*` path patches from [tests/github-preflight-helper-load.test.sh](tests/github-preflight-helper-load.test.sh)
   - Verify tests pass with only current paths

### Future Improvements

1. **Standardize Mount Locations**: Consider moving all secrets to consistent subdirectory scheme
2. **Environment Variable Validation**: Add startup check to validate all secret paths are readable before worker starts
3. **Path Documentation**: Create master reference showing exact paths at each layer
4. **Automated Path Testing**: Add integration tests that verify mounts match lookup paths at startup

---

## Files Modified by This Audit

- ✓ Comprehensive secrets inventory created
- ✓ All 5 secret types documented
- ✓ All 7 docker volume mounts catalogued
- ✓ Environment variable passing flow documented
- ✓ Path resolution logic analyzed
- ✓ Reference counts and file locations provided
- ✓ Documentation stale references identified
- ✓ No new TODOs/FIXMEs found (issue already known)

---

## Conclusion

The kaseki-agent secrets management architecture is **well-designed with proper layering and fallbacks**. The GitHub App credential path mismatch is the only real issue, and it's already been identified. All other secrets are correctly configured and follow consistent patterns across the three execution layers.

The comprehensive documentation provided here can serve as:
- **Reference** for future developers
- **Troubleshooting guide** for deployment issues
- **Basis** for documenting the secrets architecture in user documentation
- **Template** for auditing other parts of the codebase

---

*Report generated: May 19, 2026*  
*Audit scope: Complete secrets handling across API, controller, and worker layers*
