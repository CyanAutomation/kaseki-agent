# Troubleshooting Guide

Diagnose and resolve common kaseki-agent failures. Start with the symptom table, then drill into the matching category.

---

## Quick Reference

### Symptom Lookup

| Symptom | Likely Category | Start Here |
|---------|----------------|------------|
| Agent starts but produces no output | Gateway | [Gateway Failures](#gateway-failures) |
| Container exits immediately with code 86 | Docker | [Docker Failures](#docker-failures) |
| Permission denied or secret file errors | Authentication | [Authentication Failures](#authentication-failures) |
| Validation commands fail after agent runs | Validation | [Validation Failures](#validation-failures) |
| Agent modifies too many files or wrong files | Validation | [Validation Failures](#validation-failures) |
| Run hangs and exits with code 124 | Task-Execution | [Task-Execution Failures](#task-execution-failures) |
| Agent produces low-quality or incomplete output | Task-Execution | [Task-Execution Failures](#task-execution-failures) |
| API key errors or 401 responses | Authentication | [Authentication Failures](#authentication-failures) |
| Docker volume mount or filesystem errors | Docker | [Docker Failures](#docker-failures) |
| Provider returns 503, 429, or model-not-found | Gateway | [Gateway Failures](#gateway-failures) |

### Exit Code to Category Map

| Code | Category | Quick Diagnosis |
|------|----------|-----------------|
| 86 | Docker | Volume mount read-only |
| 127 | Docker | Command not found |
| 2 | Authentication | Config/auth missing |
| 88 | Gateway | Provider/model error |
| 3, 4, 5, 6, 7 | Validation | Diff, allowlist, secret, validation command |
| 1, 124 | Task-Execution | Generic failure, timeout |
| 0 | Success | — |

See [EXIT_CODES.md](EXIT_CODES.md) for detailed per-code reference.

### Automated Diagnostics

Run automated checks before manual troubleshooting:

```bash
# Doctor command — checks Docker, Node.js, npm, Git, auth files, image, disk space
kaseki-agent doctor --json        # Machine-readable output
kaseki-agent doctor --fix         # Auto-remediate detected issues

# Host preflight — submits to /api/preflight endpoint
kaseki-agent host preflight [--url URL]

# Preflight script — guided dependency checks
bash scripts/kaseki-preflight.sh doctor --guide
```

---

## Gateway Failures

### Problem: LLM Provider Error (Exit Code 88)

**Symptoms:**

- Run exits with code 88
- Error messages: "model is unavailable", "404 Not Found", "model is deprecated", "503 Service Unavailable" (after retry), "429 Rate limited" (after retry)
- Agent starts but produces no output

**Root Cause:**

The LLM provider (OpenRouter, gateway, etc.) returned an error. Kaseki-agent automatically retries transient errors (503, 429, connection issues) once. Exit code 88 means either the error was non-retryable (404, deprecated, auth failure) or the automatic retry also failed.

**Dynamic model resolution:**

Model selection is resolved at runtime. See:

- `scripts/lib/model-resolution.sh` — resolution logic: when `KASEKI_PROVIDER=gateway`, `KASEKI_MODEL` defaults to `dynamic/kaseki-agent`
- [ENV_VARS.md](ENV_VARS.md) — `KASEKI_MODEL`, `LLM_GATEWAY_MODEL`, `KASEKI_SCOUTING_MODEL`, `KASEKI_PROVIDER` documentation
- [GATEWAY_TEST.md](GATEWAY_TEST.md) — two-stage gateway connectivity and inference testing

**Diagnosis:**

```bash
# Check provider error details
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.provider_error_type, .provider_error_message, .provider_error_retryable, .provider_error_retry_attempt_count, .provider_error_retry_result'

# Check provider error log
cat /agents/kaseki-results/kaseki-N/quality.log | grep -A5 "provider error"
```

### Common Scenarios

**Scenario 1: Transient error with failed retry (503, 429, timeout)**

```
provider_error_retryable: "true"
provider_error_retry_attempt_count: 2
provider_error_retry_result: "failed"
provider_error_message: "503 Service Unavailable"
```

**Fix:** Provider is having issues. Wait 5-10 minutes and retry:

```bash
# Verify provider status
curl -s https://status.openrouter.io | grep -i status

# Retry
kaseki-agent run <repo> <ref> <task>
```

If it persists, contact provider support or switch providers.

**Scenario 2: Permanent error (404 model not found)**

```
provider_error_type: "model_not_found"
provider_error_message: "404 Model not found"
provider_error_retryable: "false"
```

**Fix:** Model is no longer available. Switch to a working model:

```bash
# List available models
kaseki-agent models list

# Update config — see KASEKI_MODEL in ENV_VARS.md
kaseki-agent config set model <model-id>

# Or set via environment
export KASEKI_MODEL=<model-id>
kaseki-agent run <repo> <ref> <task>
```

See `scripts/lib/model-resolution.sh` for default resolution when no model is explicitly set.

**Scenario 3: Deprecated model**

```
provider_error_message: "This model is deprecated"
provider_error_retryable: "false"
```

**Fix:** Switch to a current model version. Configure via `KASEKI_MODEL` or `LLM_GATEWAY_MODEL` (see [ENV_VARS.md](ENV_VARS.md)).

**Scenario 4: Authentication failure (invalid API key)**

```
provider_error_type: "auth_error"
provider_error_message: "401 Unauthorized: Invalid API key"
```

**Fix:**

```bash
# Check if API key is set
echo $OPENROUTER_API_KEY

# Verify it is valid at provider dashboard. Regenerate if needed.

# Update credential via wizard
kaseki-agent init

# Or set directly
export OPENROUTER_API_KEY=sk-or-...
kaseki-agent run <repo> <ref> <task>
```

**Scenario 5: Quota exceeded (out of credits)**

```
provider_error_message: "429 Quota exceeded for your account"
provider_error_retry_attempt_count: 2
```

**Fix:** Add credits to provider account or wait for quota reset.

### Prevention

- Use stable models: prefer pinned versions over floating tags
- Monitor credits in provider dashboard
- Configure gateway testing per [GATEWAY_TEST.md](GATEWAY_TEST.md) to validate connectivity before running agents
- Increase timeout for slow providers: `KASEKI_AGENT_TIMEOUT_SECONDS=1800`
- Check `provider_error_retry_result` in metadata to distinguish transient from permanent failures

---

## Docker Failures

### Problem: Scouting Fails with Exit Code 86

**Symptoms:**

- Container exits with code 86 immediately after scouting phase
- Error message: "scouting-candidate.json" missing
- stderr shows: "Read-only file system"
- File `/results/filesystem-readonly-reason.txt` exists

**Root Cause:**

The `/results` directory is mounted read-only (`:ro`), preventing the scouting agent from writing the artifact file. This is distinct from the `--read-only` container security flag, which is intentional hardening.

**Diagnosis:**

```bash
# Check filesystem status
cat /agents/kaseki-results/kaseki-N/filesystem-readonly-reason.txt
cat /agents/kaseki-results/kaseki-N/filesystem-writable-at-start.txt

# Check scouting validation errors
cat /agents/kaseki-results/kaseki-N/scouting-validation-errors.jsonl

# Verify /results volume mount (run-kaseki.sh)
grep -A 5 "RESULT_DIR.*results" run-kaseki.sh
# Must show: -v "$RESULT_DIR:/results:rw"

# Verify /results volume mount (docker-compose.yml)
grep -A 2 "volumes:" docker-compose.yml
# Must show /agents:/agents:rw (includes /results)
```

**Fixes:**

**Fix 1: For `run-kaseki.sh`**

Verify the volume mount has `:rw` flag:

```bash
# Correct:
docker run -v /path/to/results:/results:rw kaseki-template:latest

# Wrong (causes exit 86):
docker run -v /path/to/results:/results:ro kaseki-template:latest
```

**Fix 2: For `docker-compose.yml` (API service)**

Ensure `/results` is mounted as writable:

```yaml
services:
  kaseki-api:
    volumes:
      - /agents:/agents:rw  # Correct: includes /results
```

**Fix 3: For container with `--read-only` flag**

```bash
# Option A: Volume mount with :rw flag (Recommended)
docker run --read-only \
  -v /agents/kaseki-results:/results:rw \
  kaseki-template:latest

# Option B: tmpfs mount (in-memory, cleared on exit)
docker run --read-only \
  --tmpfs /results:rw,size=256m \
  kaseki-template:latest
```

**Prevention:**

- Always use `:rw` flag for artifact volume mounts
- In docker-compose.yml, mount `/agents` as writable
- Verify volume mounts: `docker inspect <container-id> | jq '.Mounts'`

### Problem: Command Not Found (Exit Code 127)

**Symptoms:** Container exits with code 127. Command not found in stdout.log.

**Root Cause:** Missing dependency or broken installation. Node.js not installed, npm not in PATH, script not executable.

**Fix:**

```bash
# Run doctor check
kaseki-agent doctor --fix
```

### Problem: Docker Volume or Permission Issues

See [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) for host-level Docker setup failures including:

- Docker daemon not running
- Volume mount permissions
- Docker socket access (`DOCKER_GID` configuration)
- Container UID mismatch

---

## Authentication Failures

### Problem: Config or Auth Missing (Exit Code 2)

**Symptoms:**

- Run exits with code 2
- Error: API key not found
- Container startup shows: "Cannot read secret file"

**Root Cause:** API key or configuration not set, or secret files are inaccessible.

**Diagnosis:**

```bash
# Check which API key is configured
echo $OPENROUTER_API_KEY              # Inline env var
echo $OPENROUTER_API_KEY_FILE         # Explicit file path
cat ~/.kaseki/secrets.json             # Default file location
```

### Problem: Secret Files Inaccessible (Permission Denied)

**Symptoms:**

- Container startup shows: "Cannot traverse /agents/secrets by UID 10000"
- API key fails to load silently
- API service binds only to loopback (127.0.0.1) instead of 0.0.0.0
- Preflight checks fail with "Cannot read secret file"

**Root Cause:**

The `/agents/secrets` directory has restrictive permissions preventing the container (UID 10000) from traversing it.

**Automatic Fix (Enabled by Default):**

`scripts/startup-checks.sh` detects and fixes common permission issues on startup:

1. Checks if secret directories/files are traversable and readable by UID 10000
2. Auto-fix: chmod directories to `0750`, files to `0640`
3. Logs status in startup output

**Manual Fix (If Auto-Fix Not Possible):**

If the container logs `Cannot auto-fix /agents/secrets (possibly on read-only mount)`, fix permissions on the host:

```bash
# Fix /agents/secrets directory
sudo chmod 0750 /agents/secrets

# Fix secret files
sudo chmod 0640 /agents/secrets/openrouter_api_key
sudo chmod 0640 ~/.kaseki/secrets.json
```

**Secret Paths (in order of resolution):**

1. `OPENROUTER_API_KEY` — Inline environment variable (preferred)
2. `OPENROUTER_API_KEY_FILE` — Explicit file path
3. `~/.kaseki/secrets.json` — Default file location (created by `kaseki-agent init`)
4. `/agents/secrets/openrouter_api_key` — Container mount point (Docker Compose)

**Migrating from Legacy Docker Secrets:**

```bash
# Use the init wizard
kaseki-agent init

# Or set OPENROUTER_API_KEY_FILE explicitly
export OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_api_key
./run-kaseki.sh
```

**Verification:**

```bash
# Inside container
/scripts/startup-checks.sh all
# Expected: All checks passed
```

### Problem: Git Safe.directory Configuration

**Symptoms:**

- Container preflight check fails: "unsafe repository (...) is owned by someone else"
- Error: "Git safe.directory not configured for /agents/kaseki-agent"
- Template doctor check fails after successful host setup

**Root Cause:**

Git enforces ownership checks. When the checkout directory is owned by root but the container runs as UID 10000, git refuses to read the repository.

**Solution: Three-Layered Approach**

**Layer 1: Automatic Remediation (Active by Default)**

Container auto-configures git safe.directory during startup (via `container-preflight.ts`). Disable with `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE=0`.

**Layer 2: System-Wide Configuration (Persistent)**

```bash
sudo kaseki-agent host setup --fix
git config --system --get-all safe.directory | grep kaseki-agent
```

**Layer 3: Pre-Configured in Docker Image**

Dockerfile pre-configures git safe.directory at build time. This eliminates runtime configuration.

**Manual Troubleshooting:**

```bash
# Check current status
sudo kaseki-agent host preflight

# Verify system config
git config --system --get-all safe.directory | grep kaseki-agent

# Manual system-wide configuration
sudo git config --system --add safe.directory /agents/kaseki-agent
```

**Environment Variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `KASEKI_STARTUP_CHECK_AUTO_REMEDIATE` | 1 | Enable auto-remediation in container |
| `KASEKI_SAFE_DIRECTORY_SCOPE` | global | Git config scope (auto-remediation) |

**Best Practices:**

1. Run `sudo kaseki-agent host setup --fix` after deploying or upgrading
2. Verify system config: `git config --system --get-all safe.directory`
3. Use system scope for containers

See [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) for additional host-level authentication failures.

---

## Validation Failures

### Exit Code 3: No Changes Made

**Problem:** Agent produced no diff.

**Diagnosis:** `cat /agents/kaseki-results/kaseki-N/result-summary.md`

**Fix:** Expected if codebase already satisfies the task. If changes were expected, refine `TASK_PROMPT`.

### Exit Code 4: Diff Exceeds Maximum Size

**Problem:** Agent changes exceed `KASEKI_MAX_DIFF_BYTES` (default 200000 bytes / ~200 KB).

**Diagnosis:**

```bash
wc -c /agents/kaseki-results/kaseki-N/git.diff
echo $KASEKI_MAX_DIFF_BYTES
```

**Fixes:**

- **Increase limit** (if diff is legitimate):

  ```bash
  export KASEKI_MAX_DIFF_BYTES=500000
  ```

- **Use allowlist** (restrict agent to specific files):

  ```bash
  export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts src/types.ts"
  ```

  See [QUALITY_GATES.md](QUALITY_GATES.md) for pattern syntax.

- **Refine task prompt** (make agent more focused):

  ```bash
  export TASK_PROMPT="Fix only the parser bug in src/lib/parser.ts. Do not modify other files."
  ```

### Exit Code 5: File Changed Outside Allowlist

**Problem:** Agent modified files not in `KASEKI_CHANGED_FILES_ALLOWLIST`.

**Diagnosis:**

```bash
cat /agents/kaseki-results/kaseki-N/quality.log | grep "not in allowlist"
cat /agents/kaseki-results/kaseki-N/changed-files.txt
echo $KASEKI_CHANGED_FILES_ALLOWLIST
```

**Fixes:**

- **Expand allowlist** (if agent changes are legitimate):

  ```bash
  export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/*.ts tests/**.ts"
  ```

- **Refine task prompt** (tell agent what files to modify):

  ```bash
  export TASK_PROMPT="Fix parser.ts bug. Only modify src/lib/parser.ts."
  ```

- **Auto-suggest allowlist** (from a test run):

  ```bash
  bash /path/to/kaseki-agent/scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-N
  ```

### Exit Code 6: Secret Detected

**Problem:** Code contains credential pattern (e.g., `sk-or-...`).

**Diagnosis:**

```bash
cat /agents/kaseki-results/kaseki-N/secret-scan.log
grep -r "sk-or-" /agents/kaseki-results/kaseki-N/
```

**Fix:**

1. Revoke leaked credentials immediately (if applicable)
2. Review agent's code changes
3. Refine task prompt to warn about credential safety:

   ```bash
   export TASK_PROMPT="Fix the parser bug. NEVER hardcode credentials or API keys."
   ```

### Exit Code 7: Validation Commands Fail

**Problem:**
Validation commands run in two phases:

- **Pre-agent validation** runs before the agent. If this fails, the baseline repo/ref was already failing and the agent was not invoked. Use `pre-validation.log`, `pre-validation-timings.tsv`.
- **Post-agent validation** runs after the agent, allowlist restoration, and quality gates. If this fails, the final output failed validation. Use `validation.log`, `validation-timings.tsv`.

**Diagnosis:**

```bash
# Which validation phase failed?
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.failed_command, .pre_validation_failure_reason, .validation_failure_reason'

# Pre-agent baseline logs
cat /agents/kaseki-results/kaseki-N/pre-validation.log | head -20

# Post-agent final-diff logs
cat /agents/kaseki-results/kaseki-N/validation.log | head -20
```

**Common Issues:**

**Issue: `npm run check` / `npm run test` exits with "not found"**

```
npm ERR! missing script: check
```

**Fix:** Script does not exist in package.json; this is non-fatal by design. Validation continues to the next command.

**Issue: Pre-agent validation fails before agent starts**

```
FAIL: src/__tests__/index.test.ts
TypeError: expected X to be Y
```

**Fix:** Baseline problem, not an agent regression. Either:

- Re-run against a known-good ref
- Fix the baseline repository state
- Adjust `KASEKI_PRE_AGENT_VALIDATION_COMMANDS`
- Set `KASEKI_PRE_AGENT_VALIDATION=0` to accept baseline failures

**Issue: Post-agent validation fails due to code changes**

```
FAIL: src/__tests__/index.test.ts
```

**Fix:** Final diff failed validation; agent introduced or failed to resolve a regression. Either:

- Adjust task prompt (see [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md))
- Adjust allowlist (see [QUALITY_GATES.md](QUALITY_GATES.md))
- Review agent's changes manually

**Issue: Validation fails due to missing dependencies**

```
FAIL: Module not found: react
npm ERR! code E401 Unauthorized
```

**Fix:** Dependency cache may be stale:

- Increase timeout: `KASEKI_AGENT_TIMEOUT_SECONDS=2400`
- Force clean install: `KASEKI_CACHE_ENABLED=0`

### Quality Gate Failures

**Problem:** Too many files restored before validation, or allowlist violations.

See [QUALITY_GATES.md](QUALITY_GATES.md) for:

- Allowlist pattern syntax and examples
- Pre-built templates by task type
- `scripts/suggest-allowlist.sh` and `scripts/dry-run-allowlist.sh`
- Decision tree for choosing the right allowlist

**Restoration troubleshooting:**

```bash
# Count restored files
grep "restore:" /agents/kaseki-results/kaseki-N/restoration.jsonl | wc -l

# Review restoration report
cat /agents/kaseki-results/kaseki-N/restoration-report.md
```

Solutions:

1. Use pre-flight validation to preview changes: `bash /path/to/scripts/dry-run-allowlist.sh`
2. Use suggested allowlist from a test run: `bash /path/to/scripts/suggest-allowlist.sh`
3. Auto-generate from templates: `bash /path/to/scripts/allowlist-helper.sh --type "bug-fix"`

---

## Task-Execution Failures

### Problem: Generic Failure (Exit Code 1)

**Step 1: Check stage where failure occurred**

```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.stages'
```

**Step 2: Locate failure details by stage**

Agent phase failed:

```bash
tail -100 /agents/kaseki-results/kaseki-N/stdout.log | grep -i error
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.elapsed_seconds, .timeout_seconds'
```

Pre-agent or post-agent validation failed:

```bash
cat /agents/kaseki-results/kaseki-N/pre-validation.log
cat /agents/kaseki-results/kaseki-N/validation.log
```

**Step 3: Read structured failure reason**

```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.pre_validation_failure_reason, .validation_failure_reason, .quality_failure_reason'
```

### Problem: Agent Timeout (Exit Code 124)

**Symptoms:** Run exits with code 124 after `KASEKI_AGENT_TIMEOUT_SECONDS`.

**Diagnosis:**

```bash
# Time elapsed vs timeout
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.elapsed_seconds, .timeout_seconds'

# What was the agent doing?
tail -50 /agents/kaseki-results/kaseki-N/progress.log
```

**Fixes:**

- **Increase timeout:**

  ```bash
  export KASEKI_AGENT_TIMEOUT_SECONDS=2400  # 40 minutes
  ```

- **Simplify task** (make it smaller/faster):

  ```bash
  export TASK_PROMPT="Fix only the parser bug in src/lib/parser.ts. Minimal changes."
  ```

- **Scope allowlist** (agent won't search unnecessary files):

  ```bash
  export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"
  ```

See [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) for writing focused, scoped prompts and anti-patterns that cause scope creep.

### Performance & Resource Issues

**Slow validation:**

```bash
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
awk -F'\t' '{print $1, $3 " seconds"}' /agents/kaseki-results/kaseki-N/validation-timings.tsv
```

**Fix:** See [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md).

**High API queue backlog:**

```bash
curl http://localhost:8080/health | jq '.queue'
export KASEKI_API_MAX_CONCURRENT_RUNS=5  # Default: 3
docker-compose restart kaseki-api
```

---

## Monitoring & Debugging Commands

### Check Run Status

```bash
kaseki-cli list
kaseki-cli status kaseki-5
kaseki-cli errors kaseki-5
kaseki-cli analysis kaseki-5
```

### Live Monitoring

```bash
kaseki-cli watch kaseki-5 --interval=2
kaseki-cli follow kaseki-5 | grep -i error
```

### Post-Run Analysis

```bash
kaseki-report /agents/kaseki-results/kaseki-5
cat /agents/kaseki-results/kaseki-5/git.diff | head -100
cat /agents/kaseki-results/kaseki-5/validation-timings.tsv
```

---

## Getting Help

### Collecting Diagnostic Info for Support

```bash
mkdir kaseki-debug-kaseki-N
cd kaseki-debug-kaseki-N

cp /agents/kaseki-results/kaseki-N/metadata.json .
cp /agents/kaseki-results/kaseki-N/result-summary.md .
cp /agents/kaseki-results/kaseki-N/validation.log .
cp /agents/kaseki-results/kaseki-N/quality.log .
cp /agents/kaseki-results/kaseki-N/stdout.log .
cp /agents/kaseki-results/kaseki-N/pi-summary.json .

# Sanitize credentials
sed -i 's/sk-or-[^ ]*/sk-or-REDACTED/g' *

zip -r kaseki-debug-kaseki-N.zip .
```

### Review Key Diagnostics in Order

1. `result-summary.md` — Human-readable status
2. `metadata.json` — Per-stage exit codes, failure reasons
3. `validation.log` — Validation phase output
4. `quality.log` — Quality gate violations
5. `pi-summary.json` — Agent activity, elapsed time
6. `stdout.log` / `stderr.log` — Raw execution output

---

## See Also

- [EXIT_CODES.md](EXIT_CODES.md) — Detailed exit code reference
- [QUALITY_GATES.md](QUALITY_GATES.md) — Allowlist configuration & patterns
- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Writing better task prompts
- [CLI.md](CLI.md) — Monitoring with kaseki-cli
- [GATEWAY_TEST.md](GATEWAY_TEST.md) — Gateway connectivity and inference testing
- [HOST_SETUP_TROUBLESHOOTING.md](HOST_SETUP_TROUBLESHOOTING.md) — Host-level setup failures
- [ENV_VARS.md](ENV_VARS.md) — Environment variable reference, dynamic model resolution
