# Troubleshooting Guide

This guide helps you diagnose and resolve common kaseki-agent failures using systematic decision trees and diagnostic commands.

## Quick Diagnosis Flowchart

```
Start: Run Failed
  ↓
  → Check exit code (0 = success)
  ↓
Exit Code?
  ├─ 0: Success ✓
  ├─ 1: Generic failure → Run diagnostics
  ├─ 2: Config error → Check env vars & auth
  ├─ 3: Empty diff → Code unchanged, expected
  ├─ 4: Diff too large → Increase KASEKI_MAX_DIFF_BYTES
      or use allowlist
  ├─ 5: Allowlist violation → Review changed files
  ├─ 6: Secret detected → Audit code for credentials
  ├─ 7: Validation failed → Check pre-validation.log or
      validation.log
  ├─ 86: Scouting failed → Check Docker volume mounts
      (read-only /results?)
  ├─ 124: Timeout → Increase KASEKI_AGENT_TIMEOUT_SECONDS
  └─ 127: Command not found → Verify installation
```

---

## Exit Code Troubleshooting

See [EXIT_CODES.md](EXIT_CODES.md) for detailed per-code reference. Quick lookup:

| Code | Issue | Check | Fix |
|------|-------|-------|-----|
| **0** | ✓ Success | None | N/A |
| **1** | Generic failure | metadata.json `exit_code_stage`, logs | See "Generic
  Failure" below |
| **2** | Config/auth missing | KASEKI_API_KEYS, OPENROUTER_API_KEY | Set API key in
  env or file |
| **3** | No changes made | result-summary.md | Expected if code
  unchanged |
| **4** | Diff exceeds limit | changed-files.txt, git.diff size | Use allowlist or
  increase KASEKI_MAX_DIFF_BYTES |
| **5** | File outside allowlist | quality.log, changed-files.txt | Review
  KASEKI_CHANGED_FILES_ALLOWLIST |
| **6** | Secret detected | secret-scan.log | Audit code for `sk-or-*`
  credentials |
| **7** | Validation failed | pre-validation.log or validation.log | See "Validation
  Failures" below |
| **86** | Scouting validation failed | filesystem-readonly-reason.txt, scouting-validation-errors.jsonl | Check /results volume mount flags (must be :rw) |
| **124** | Agent timeout | pi-summary.json `elapsed_seconds` | Increase
  KASEKI_AGENT_TIMEOUT_SECONDS |
| **127** | Command not found | stdout.log, stderr.log | Reinstall; verify
  Node.js v24+ |

---

## Permission Issues & Secret Path Access

### Problem: Secret Files Are Inaccessible (Permission Denied)

**Symptoms:**

- Container startup shows: `✗ /agents/secrets is not traversable by UID 10000`
- API key fails to load silently
- API service binds only to loopback (127.0.0.1) instead of 0.0.0.0
- Preflight checks fail with "Cannot read secret file"

**Root Cause:**

The `/agents/secrets` directory (or other secret paths) has restrictive permissions that prevent the container (running as UID 10000) from traversing the directory, even if the UID matches the group owner.

**Example:**

```bash
# Host filesystem:
ls -ld /home/pi/secrets
drwx------  pi  10000  /home/pi/secrets  # Mode 0700 (only owner can access)

# Inside container (UID 10000):
ls /home/pi/secrets
Permission denied  # Cannot traverse 0700 dir, even as group 10000
```

### Automatic Fix (Enabled by Default)

On startup, `scripts/startup-checks.sh` automatically detects and fixes common permission issues:

1. **Detection:** Checks if secret directories/files are traversable and readable by UID 10000
2. **Auto-fix:** Attempts to chmod directories to `0750` (owner rwx, group rx) and files to `0640` (owner rw, group r)
3. **Logging:** Shows status in startup output:
   - `✓ Fixed permissions: /agents/secrets (0700 → 0750)` — success
   - `✗ Cannot auto-fix ... (possibly on read-only mount)` — requires manual intervention

**Permission Targets:**

- **Directories: 0750** — allows group traversal without world access
- **Files: 0640** — allows group read without world read or group write

### Manual Fix (If Auto-Fix Not Possible)

**Scenario: Read-Only Mount or No Auto-Fix Permission**

If the container logs:

```
✗ Cannot auto-fix /agents/secrets (possibly on read-only mount)
Fix on host: sudo chmod 0750 /agents/secrets
```

Fix permissions **on the host**:

```bash
# Fix /agents/secrets directory
sudo chmod 0750 /agents/secrets

# Fix secret files (if present)
sudo chmod 0640 /agents/secrets/openrouter_api_key
sudo chmod 0640 /agents/secrets/github_app_*

# Fix fallback paths
sudo chmod 0750 ~/.kaseki/secrets
sudo chmod 0640 ~/.kaseki/secrets.json
```

**For Docker Compose:**

If using Docker Compose and containers don't have permission to modify mounts:

```bash
# On host, before starting container:
docker-compose down

# Fix permissions
sudo chmod 0750 /home/pi/secrets
sudo chmod 0750 ~/.kaseki/secrets

# Restart
docker-compose up -d
```

**For Kubernetes:**

If running in Kubernetes with PersistentVolumes:

```bash
# Check PV owner/permissions
kubectl exec -it <pod> -- ls -ld /agents/secrets

# If owned by root:
kubectl exec -it <pod> -- sudo chmod 0750 /agents/secrets

# If PV is mounted read-only, update the PersistentVolume:
kubectl patch pv <pv-name> -p '{"spec":{"accessModes":["ReadWriteOnce"]}}'
# Then update the Pod to allow permission modifications
```

### Secret Paths (Modern)

Startup checks verify these paths (in order):

1. `OPENROUTER_API_KEY` — Inline environment variable (preferred for security)
2. `OPENROUTER_API_KEY_FILE` — Explicit file path (can be set to any location)
3. `~/.kaseki/secrets.json` — Default file location (created by `kaseki-agent init`)
4. `/agents/secrets/openrouter_api_key` — Container mount point (Docker Compose)

### Migrating from Legacy Docker Secrets

If you are using Docker's native `secrets:` feature with `/run/secrets/openrouter_api_key`:

```bash
# Option 1: Use the new init wizard
kaseki-agent init

# Option 2: Set OPENROUTER_API_KEY_FILE explicitly
export OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_api_key
./run-kaseki.sh

# Option 3: Migrate to file-based secrets
cp /run/secrets/openrouter_api_key ~/.kaseki/secrets.json
chmod 600 ~/.kaseki/secrets.json
```

The modern approach (file-based) is more portable and works across Docker Compose, Kubernetes, and local execution.

### Verification

After fixing permissions, verify the startup checks pass:

```bash
# Inside container
/scripts/startup-checks.sh all
# Expected: ✓ All checks passed

# Or restart the service
docker-compose restart kaseki-api
```

---

## Read-Only Filesystem Issues (Exit Code 86)

### Problem: Scouting Fails with Exit Code 86

**Symptoms:**

- Container exits with code 86 immediately after scouting phase
- Error message: "scouting-candidate.json" missing
- stderr shows: "Read-only file system"
- File `/results/filesystem-readonly-reason.txt` exists and indicates read-only mount

**Root Cause:**

The `/results` directory is mounted with read-only (`:ro`) flag, preventing the scouting Pi agent from writing the artifact file. This is different from the `--read-only` container security flag, which is intentional security hardening. The issue is an accidental read-only mount flag on the `/results` volume.

### Diagnosis

1. **Check filesystem status:**

   ```bash
   cat /agents/kaseki-results/kaseki-N/filesystem-readonly-reason.txt
   cat /agents/kaseki-results/kaseki-N/filesystem-writable-at-start.txt
   ```

2. **Check scouting validation errors:**

   ```bash
   cat /agents/kaseki-results/kaseki-N/scouting-validation-errors.jsonl
   ```

3. **Verify /results volume mount (if using run-kaseki.sh):**

   ```bash
   # Check the run-kaseki.sh script:
   grep -A 5 "RESULT_DIR.*results" run-kaseki.sh
   
   # Should show:
   # -v "$RESULT_DIR:/results:rw"  ← must have :rw flag
   ```

4. **Verify /results volume mount (if using docker-compose.yml):**

   ```bash
   # Check the docker-compose.yml:
   grep -A 2 "volumes:" docker-compose.yml
   
   # Should show /results as writable:
   # /agents:/agents:rw
   # (or /results:/results:rw if mounted separately)
   ```

### Fixes

#### Fix 1: For `run-kaseki.sh` (single-run execution)

Verify the volume mount has `:rw` flag:

```bash
# Correct:
docker run -v /path/to/results:/results:rw kaseki-template:latest

# Wrong (causes exit 86):
docker run -v /path/to/results:/results:ro kaseki-template:latest
```

The `run-kaseki.sh` script should automatically set `:rw`, but if it doesn't, edit the script and verify line ~1104:

```bash
-v "$RESULT_DIR:/results:rw"  # ← Must have :rw flag
```

#### Fix 2: For `docker-compose.yml` (API service)

Ensure `/results` is mounted as writable:

```yaml
services:
  kaseki-api:
    volumes:
      - /agents:/agents:rw  # ← Correct: includes /results
      # or explicitly:
      - /agents/kaseki-results:/results:rw  # ← Also correct
```

Do NOT mount `/results` with `:ro` flag.

#### Fix 3: For container with `--read-only` flag

The `--read-only` container flag is intentional security hardening. To make it compatible with artifact writing:

**Option A: Use volume mount with :rw flag** (Recommended)

```bash
docker run --read-only \
  -v /agents/kaseki-results:/results:rw \  # ← Override read-only for /results
  kaseki-template:latest
```

**Option B: Use tmpfs mount** (In-memory, cleared on container exit)

```bash
docker run --read-only \
  --tmpfs /results:rw,size=256m \  # ← tmpfs allows writes even in read-only container
  kaseki-template:latest
```

**Option C: Remove --read-only flag** (Less secure)

```bash
docker run \
  -v /agents/kaseki-results:/results:rw \
  kaseki-template:latest
```

### Prevention

1. Always use `:rw` flag for artifact volume mounts:

   ```bash
   -v "$RESULT_DIR:/results:rw"  # Always add :rw
   ```

2. In docker-compose.yml, mount `/agents` as writable (which includes `/results`):

   ```yaml
   volumes:
     - /agents:/agents:rw  # ← Covers /agents/kaseki-results too
   ```

3. Verify volume mounts before running:

   ```bash
   # Check what's mounted in the container
   docker inspect <container-id> | jq '.Mounts'
   ```

---

## Generic Failure Diagnosis (Exit Code 1)

### Step 1: Check Stage Where Failure Occurred

```bash
# Extract per-stage exit codes
cat /agents/kaseki-results/kaseki-N/metadata.json |
  jq '.stages'

# Output example:
# {
#   "agent_phase": {"exit_code": 0},
#   "validation_phase": {"exit_code": 1, "failed_command": "npm run test"},
#   "secret_scan": {"exit_code": 0},
#   "quality_gates": {"exit_code": 0}
# }
```

### Step 2: Locate Failure Details by Stage

**Agent Phase Failed** (exit_code_stage: agent):

```bash
tail -100 /agents/kaseki-results/kaseki-N/stdout.log |
  grep -i error
tail -50 /agents/kaseki-results/kaseki-N/pi-stderr.log

# Agent timeout?
cat /agents/kaseki-results/kaseki-N/pi-summary.json |
  jq '.elapsed_seconds, .timeout_seconds'
```

**Pre-Agent Validation Failed** (baseline failure before Pi):

```bash
cat /agents/kaseki-results/kaseki-N/pre-validation.log
cat /agents/kaseki-results/kaseki-N/pre-validation-timings.tsv
  # Which baseline command failed?
```

This means the requested repo/ref failed validation before Pi
made any changes. Fix the baseline or choose a passing ref
before judging agent output.

**Post-Agent Validation Failed** (final diff failed
  validation):

```bash
cat /agents/kaseki-results/kaseki-N/validation.log
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
  # Which final-diff command failed?
```

**Quality Gates Failed** (exit_code_stage: quality_gates):

```bash
cat /agents/kaseki-results/kaseki-N/quality.log
# Check:
#   - Diff size in bytes?
#   - Which files outside allowlist?
#   - Secret patterns detected?
```

**Secret Scan Failed** (exit_code_stage: secret_scan):

```bash
cat /agents/kaseki-results/kaseki-N/secret-scan.log
# Lists files with detected credential patterns
# (sk-or-*)
```

### Step 3: Read Structured Failure Reason

```bash
# Machine-readable failure reason
cat /agents/kaseki-results/kaseki-N/metadata.json |
  jq '.pre_validation_failure_reason, .validation_failure_reason, .quality_failure_reason'

# Examples:
# "pre_validation_failure_reason": "pre_agent_validation_failed: npm run check (exit 1)"
# "validation_failure_reason": "validation_command_failed: npm run test (exit 1)"
# "quality_failure_reason": "max_diff_bytes: 250000 exceeds limit of 200000"
```

---

## Validation Failures (Exit Code 7)

### Problem: Validation Commands Fail

Validation commands are executed sequentially (default: `npm run check;npm run test`). Kaseki runs them in two phases:

- **Pre-agent validation** runs before Pi. If this phase fails, the baseline repo/ref was already failing and Pi was not invoked. Use `pre-validation.log`, `pre-validation-raw.log`, `pre-validation-env.log`, and `pre-validation-timings.tsv`.
- **Post-agent validation** runs after Pi, allowlist restoration, and quality gates. If this phase fails, the final agent output failed validation. Use `validation.log`, `validation-raw.log`, `validation-env.log`, and `validation-timings.tsv`.

**Note on Log Output:** Validation command output is automatically filtered in real-time Docker logs to show only key milestones (test results, errors, warnings) and command boundaries, while preserving full unfiltered output in `/agents/kaseki-results/kaseki-N/pre-validation.log` and `/agents/kaseki-results/kaseki-N/validation.log`. This keeps `docker logs kaseki-N` clean while enabling full debugging via the stored log files.

### Diagnosis

```bash
# 1. Which validation phase failed?
cat /agents/kaseki-results/kaseki-N/metadata.json |
  jq '.failed_command, .pre_validation_failure_reason, .validation_failure_reason'
cat /agents/kaseki-results/kaseki-N/stage-timings.tsv

# 2. If failed_command is "pre-agent validation", inspect
#    baseline logs
cat /agents/kaseki-results/kaseki-N/pre-validation.log |
  head -20
cat /agents/kaseki-results/kaseki-N/pre-validation-timings.tsv

# 3. If failed_command is "validation", inspect final-diff logs
cat /agents/kaseki-results/kaseki-N/validation.log |
  head -20
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv

# 4. Full error output for a specific command
grep -A 50 "npm run test" /agents/kaseki-results/kaseki-N/validation.log
```

### Common Issues

**Issue: `npm run check` / `npm run test` exits with "not found"**

```
npm ERR! missing script: check
npm ERR! missing script: test
```

**Fix:** The script doesn't exist in package.json; this is non-fatal by design. Validation continues to next command.

**Issue: Pre-agent validation fails before Pi starts**

```
FAIL: src/__tests__/index.test.ts
TypeError: expected X to be Y
```

**Fix:** This is a baseline problem, not an agent regression. The
selected repo/ref failed before Pi changed anything. Either:

- Re-run against a known-good ref
- Fix the baseline repository state
- Adjust `KASEKI_PRE_AGENT_VALIDATION_COMMANDS` if the
  baseline phase is intentionally narrower than final validation
- Set `KASEKI_PRE_AGENT_VALIDATION=0` only when you knowingly
  accept baseline failures

**Issue: Post-agent validation fails due to code changes**

```
FAIL: src/__tests__/index.test.ts
TypeError: expected X to be Y
```

**Fix:** The final diff failed validation, so the agent likely
introduced or failed to resolve a regression. Either:

- Adjust agent task prompt (see
  [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md))
- Adjust allowlist to restrict agent changes (see
  [QUALITY_GATES.md](QUALITY_GATES.md))
- Review agent's changes and accept/modify them manually

**Issue: Validation fails due to missing dependencies**

```
FAIL: Module not found: react
npm ERR! code E401 Unauthorized
```

**Fix:** Dependency cache may be stale. Try:

- Increase timeout: `KASEKI_AGENT_TIMEOUT_SECONDS=2400`
- Force clean install: `KASEKI_CACHE_ENABLED=0`

---

## Goal Check Artifact Validation Failures

### Problem: Goal Check Fails with "goal_check_artifact_invalid"

Goal check validation happens after initial validation, before attempting retry. If the goal-check artifact (JSON verdict) fails schema validation, the run logs exit code **86** and may retry (if `KASEKI_GOAL_CHECK_MAX_RETRIES > 0`).

**Symptoms:**

```json
{
  "exit_code": 86,
  "goal_check_failure_reason": "goal_check_artifact_invalid",
  "goal_check_met": false
}
```

### Diagnosis

Goal check errors are recorded in `/results/goal-check-validation-errors.jsonl` with per-field details:

```bash
# 1. View validation errors
cat /agents/kaseki-results/kaseki-N/goal-check-validation-errors.jsonl | jq .

# Output includes:
# {
#   "timestamp": "2026-05-25T23:30:00Z",
#   "attempt": 1,
#   "summary": "critical",
#   "errors": [
#     {"field": "confidence", "expected": "low|medium|high", "actual": "MEDIUM", ...},
#     {"field": "retry_prompt", "expected": "non-empty string (when met=false)", ...}
#   ]
# }

# 2. View all attempted verdicts
cat /agents/kaseki-results/kaseki-N/goal-check-attempts.jsonl | jq .

# 3. Check raw goal-check output
tail -100 /agents/kaseki-results/kaseki-N/goal-check-stderr.log

# 4. Check goal-check prompt that was sent
grep -A 200 "build_goal_check_prompt" /results/metadata.jsonl 2>/dev/null || echo "N/A"
```

### Common Issues & Fixes

**Issue: Confidence value is wrong case** (`"MEDIUM"` instead of `"medium"`)

```
errors: [
  {"field": "confidence", "expected": "low|medium|high", "actual": "MEDIUM", ...}
]
```

**Fix:** Goal check model is generating the wrong case. This usually happens due to ambiguous instructions. The model will be retried with clarified instructions.

**Issue: Retry prompt missing when met=false**

```
errors: [
  {"field": "retry_prompt", "expected": "non-empty string (when met=false)", "actual": "empty string", ...}
]
```

**Fix:** When the goal is unmet, the evaluator must provide guidance. If this persists, the agent may need clearer task instructions or simpler goals.

**Issue: Summary is empty**

```
errors: [
  {"field": "summary", "expected": "non-empty string", "actual": "empty string", ...}
]
```

**Fix:** Goal check verdict summary cannot be empty. The evaluator will retry.

**Issue: Root artifact is not an object** (null, array, primitive)

```
errors: [
  {"field": "root", "expected": "object", "actual": "null", "severity": "critical", ...}
]
```

**Fix:** Goal check output was malformed JSON or not an object. Check `goal-check-stderr.log` for parse errors.

### Prevention

- Goal check validation is automatic and transparent
- Errors are logged but retries proceed if `KASEKI_GOAL_CHECK_MAX_RETRIES > 0` (default: 1)
- If retries are exhausted (exit code 8), review the artifact structure in `goal-check-attempts.jsonl`
- To disable goal check entirely: `KASEKI_GOAL_CHECK=0`

---

## TypeScript Pre-Check Failures

### Problem: TypeScript Pre-Check Fails Before Agent Runs

TypeScript pre-check runs automatically after dependencies install, before the agent is invoked. It catches TypeScript compilation errors early (within ~30 seconds) instead of wasting 15+ minutes on agent invocation.

**Symptoms:**

```json
{
  "typescript_precheck": {
    "enabled": true,
    "exit_code": 1,
    "duration_seconds": 25,
    "log_file": "pre-validation-ts-check.log"
  }
}
```

If `KASEKI_TS_PRE_CHECK=1` (default), TypeScript detection is **automatic**:

- Non-TypeScript projects skip gracefully (no fatal error)
- Missing npm scripts are warned about but don't fail
- Only genuine compilation failures trigger exit (fatal if scouting disabled)

### Diagnosis

```bash
# 1. View TypeScript pre-check output
cat /agents/kaseki-results/kaseki-N/pre-validation-ts-check.log

# Output examples:
# - "skipped (no TypeScript detected)" → Non-TS project, skipped safely
# - "skipped (npm script 'build' not found)" → TS project but script missing
# - "error TS2307: Cannot find module 'missing-dep'" → Real compilation error

# 2. Check metadata for detail status
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.typescript_precheck'

# Possible detail values:
# - success: Check passed
# - failed: Genuine TypeScript compilation errors
# - skipped_no_typescript: Non-TS project (no tsconfig.json, no typescript dependency)
# - skipped_missing_script: TS detected but npm script not defined
# - skipped_by_config: KASEKI_TS_PRE_CHECK=0

# 3. Check stage timings for all pre-check details
cat /agents/kaseki-results/kaseki-N/stage-timings.tsv | grep "typescript precheck"
```

### Common Scenarios & Fixes

**Scenario: TypeScript pre-check skipped, non-TS project**

```
✓ typescript precheck: skipped (no TypeScript detected)
detail: skipped_no_typescript
```

Expected for Python, Go, pure JS projects. No action needed.

**Scenario: TypeScript detected but npm script missing (warning)**

```
⚠ typescript precheck: skipped (npm script 'build' not found)
detail: skipped_missing_script
error event: typescript_precheck_skipped_missing_script
```

**Fix (optional):** Either:

- Define the script in `package.json`: `"build": "tsc"`
- Use a different existing script: `KASEKI_TS_CHECK_COMMAND="npm run compile"`
- Explicitly use tsc: `KASEKI_TS_CHECK_COMMAND="tsc --noEmit"`

**Scenario: "Cannot find module" error (actual compilation failure)**

```
error TS2307: Cannot find module '@types/node' or its corresponding type declarations
```

**Fix:** Missing type definitions:

- Run `npm install @types/node` to add missing dependency
- Use `npm ci --include=optional` in your build script
- Verify `tsconfig.json` has correct `types` array

**Scenario: Build script doesn't exist in non-TS project**

```
✓ typescript precheck: skipped (no TypeScript detected)
```

This is normal. Non-TS projects skip even if `npm run build` doesn't exist.

**Scenario: TypeScript configuration error**

```
error TS5024: 'rootDir' is not specified, and there are files found in the project.
```

**Fix:** `tsconfig.json` misconfiguration:

- Add `"rootDir": "src"` to tsconfig.json
- Verify tsconfig.json is in repo root
- Check for conflicting tsconfig files

**Scenario: Type errors in source code**

```
error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
```

**Fix:** Genuine type errors:

- Fix the source code
- Disable TS pre-check if not critical: `KASEKI_TS_PRE_CHECK=0`
- Use lighter check: `KASEKI_TS_CHECK_COMMAND="tsc --noEmit"`

### Configuration & Prevention

**Disable TS pre-check entirely** (not recommended, defeats early error detection):

```bash
KASEKI_TS_PRE_CHECK=0
```

**Use lighter TS check** (type-check only, no emit):

```bash
KASEKI_TS_CHECK_COMMAND="tsc --noEmit"
```

**Custom build command** (must exist in package.json):

```bash
KASEKI_TS_CHECK_COMMAND="npm run build:validate"
```

**Continue despite TS failures** (experimental, only with scouting):

```bash
KASEKI_TS_PRE_CHECK=1
KASEKI_SCOUTING=1
```

**Multi-language repos** (Python, Go, JS mixed):

```bash
# Default is safe - TS auto-detection skips non-TS projects
KASEKI_TS_PRE_CHECK=1  # stays enabled, works safely
```

---

## Quality Gate Failures

### Exit Code 4: Diff Exceeds Maximum Size

**Problem:** Agent made changes totaling > 200 KB (default KASEKI_MAX_DIFF_BYTES)

**Diagnosis:**

```bash
# Check actual diff size
wc -c /agents/kaseki-results/kaseki-N/git.diff

# Review changed files
cat /agents/kaseki-results/kaseki-N/changed-files.txt

# Check configured limit
echo $KASEKI_MAX_DIFF_BYTES  # Default: 200000
```

**Fixes (pick one):**

- **Increase limit** (if diff is legitimate):

  ```bash
  export KASEKI_MAX_DIFF_BYTES=500000  # 500 KB
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

**Problem:** Agent modified files not in KASEKI_CHANGED_FILES_ALLOWLIST

**Diagnosis:**

```bash
# Which files are outside allowlist?
cat /agents/kaseki-results/kaseki-N/quality.log | grep "not in allowlist"

# All changed files
cat /agents/kaseki-results/kaseki-N/changed-files.txt

# Current allowlist
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
  bash /path/to/kaseki-agent/scripts/suggest-allowlist.sh \
    /agents/kaseki-results/kaseki-N
  ```

### Exit Code 6: Secret Detected

**Problem:** Code contains credential pattern (e.g., `sk-or-...`)

**Diagnosis:**

```bash
# Which files have credentials?
cat /agents/kaseki-results/kaseki-N/secret-scan.log

# Audit for leaked keys
grep -r "sk-or-" /agents/kaseki-results/kaseki-N/  # Search result artifacts
```

**Fix:**

1. **Revoke leaked credentials immediately** (if applicable)
2. Review agent's code changes — likely unintentional
3. Refine task prompt to warn about credential safety:

   ```bash
   export TASK_PROMPT="Fix the parser bug. NEVER hardcode credentials or API keys."
   ```

---

## API Service Issues

### API Won't Start

```bash
docker-compose logs kaseki-api --tail 50
```

**Common Issues:**

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Permission denied /agents/kaseki-results` | Host dir not writable by UID 10000 | `sudo chmod 777 /agents` |
| `Cannot connect to Docker daemon` | No Docker socket access | Set `DOCKER_GID` in env |
| `EADDRINUSE: address already in use :::8080` | Port 8080 in use | Change `KASEKI_API_PORT=8081` |
| `Error: ENOENT: no such file or directory, mkdir '/agents'` | Host mount missing | `mkdir -p /agents` |

### API Runs Fail with Permission Error

```bash
# Inside container: check permission to /agents
docker exec kaseki-api ls -ld /agents

# Fix: make writable
sudo chmod 777 /agents
docker-compose restart kaseki-api
```

---

## Monitoring & Debugging Commands

### Check Run Status

```bash
# List all runs
kaseki-cli list

# Get detailed status of a running/completed run
kaseki-cli status kaseki-5

# Check for errors
kaseki-cli errors kaseki-5

# Get post-run analysis
kaseki-cli analysis kaseki-5
```

### Live Monitoring

```bash
# Watch a running instance in real-time
kaseki-cli watch kaseki-5 --interval=2

# Stream logs as they happen
kaseki-cli follow kaseki-5

# Follow with search filter (e.g., only errors)
kaseki-cli follow kaseki-5 |
  grep -i error
```

### Post-Run Analysis

```bash
# Generate diagnostic report
kaseki-report /agents/kaseki-results/kaseki-5

# Review what changed
cat /agents/kaseki-results/kaseki-5/git.diff |
  head -100

# Check validation results
cat /agents/kaseki-results/kaseki-5/validation-timings.tsv
```

---

## Allowlist Troubleshooting

### Too Many Files Being Restored

When validation runs, files outside the allowlist are
restored to their original state. If many files are restored,
it means the agent modified files outside the intended scope.

```bash
# Count restored files
grep "restore:" /agents/kaseki-results/kaseki-N/restoration.jsonl |
  wc -l

# Review restoration report
cat /agents/kaseki-results/kaseki-N/restoration-report.md
```

**Solutions:**

1. **Use pre-flight validation** to preview what agent will
   change:

   ```bash
   bash /path/to/scripts/dry-run-allowlist.sh <repo_url> 
     <git_ref> "<task>"
   ```

2. **Use suggested allowlist** from a test run:

   ```bash
   bash /path/to/scripts/suggest-allowlist.sh \
     /agents/kaseki-results/kaseki-N > allowlist.txt
   ```

3. **Auto-generate from templates**:

   ```bash
   # See QUALITY_GATES.md for templates by task type
   bash /path/to/scripts/allowlist-helper.sh --type "bug-fix"
   ```

---

## Agent Timeout

### Problem: Agent Takes Longer Than Timeout

```
Exit code 124: command timed out after KASEKI_AGENT_TIMEOUT_SECONDS
```

**Diagnosis:**

```bash
# How much time elapsed?
cat /agents/kaseki-results/kaseki-N/pi-summary.json |
  jq '.elapsed_seconds, .timeout_seconds'

# What was agent doing when timeout hit?
tail -50 /agents/kaseki-results/kaseki-N/progress.log
```

**Fixes:**

- **Increase timeout**:

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

---

## Performance & Resource Issues

### Slow Validation

```bash
# Check validation timing
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv

# Which command is slow?
awk -F'\t' '{print $1, $3 " seconds"}' /agents/kaseki-results/kaseki-N/validation-timings.tsv
```

**Fix:** Check [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) for
optimization tips.

### High API Queue Backlog

```bash
# Check queue
curl http://localhost:8080/health | jq '.queue'

# If many pending: increase concurrency
export KASEKI_API_MAX_CONCURRENT_RUNS=5  # Default: 3
docker-compose restart kaseki-api
```

---

## Getting Help

### Collecting Diagnostic Info for Support

```bash
# Create diagnostic bundle
mkdir kaseki-debug-kaseki-N
cd kaseki-debug-kaseki-N

# Copy key artifacts
cp /agents/kaseki-results/kaseki-N/metadata.json .
cp /agents/kaseki-results/kaseki-N/result-summary.md .
cp /agents/kaseki-results/kaseki-N/validation.log .
cp /agents/kaseki-results/kaseki-N/quality.log .
cp /agents/kaseki-results/kaseki-N/stdout.log .
cp /agents/kaseki-results/kaseki-N/pi-summary.json .

# Sanitize credentials
sed -i 's/sk-or-[^ ]*/sk-or-REDACTED/g' *

# Zip and share
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

## Understanding Output Filtering

### Real-Time Logs vs Stored Files

Kaseki-agent applies intelligent filtering to real-time Docker logs while preserving full output in stored result files. This reduces noise during execution while maintaining complete debugging information.

#### What's Filtered in Docker Logs

Real-time `docker logs kaseki-N` output filters OUT verbose lines including:

- Verbose progress indicators (e.g., build initialization, package resolution)
- Npm notice messages and warnings
- Non-critical debug output
- Progress bars and spinners

#### What's Always Shown

The following are always displayed in real-time Docker logs:

- ❌ **Error and warning lines** — ERROR, WARN, FATAL, CRITICAL, Exception
- ✅ **Test result indicators** — PASS, FAIL, passed, failed, ✓, ✗
- ℹ️ **Command boundaries** — Command start (`==> npm run X`) and exit codes
- 📊 **Summaries** — Test counts, build status, completion messages
- 🔍 **Stack traces** — Full exception stack traces

#### Finding Full Output

If you need to see the complete unfiltered output:

```bash
# Full validation output (including all verbose lines)
cat /agents/kaseki-results/kaseki-N/validation.log

# Separate by command
grep -A 500 "^==> npm run test" /agents/kaseki-results/kaseki-N/validation.log | head -100
```

#### Example: Test Run

**Docker logs** (filtered — only key milestones):

```
==> npm run test
PASS: Suite 1 - basic operations
PASS: Suite 2 - edge cases
15 tests passed, 0 failed
exit_code=0
```

**validation.log** (full — includes all output):

```
==> npm run test
npm WARN notice This is npm version 8.5.0
npm WARN notice Welcome to npm!
npm WARN notice See more at https://docs.npmjs.com/...
Loading test fixtures...
Compiling test files...
Running test suite 'basic operations'...
  Test 1: should handle empty input ... PASS
  Test 2: should handle null values ... PASS
  ...
PASS: Suite 1 - basic operations
Running test suite 'edge cases'...
  Test 3: should reject invalid types ... PASS
  ...
PASS: Suite 2 - edge cases
Test Results: 15 tests passed, 0 failed, 100% coverage
exit_code=0
```

---

## See Also

- [EXIT_CODES.md](EXIT_CODES.md) — Detailed exit code reference
- [QUALITY_GATES.md](QUALITY_GATES.md) — Allowlist configuration & patterns
- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Writing better task prompts
- [CLI.md](CLI.md) — Monitoring with kaseki-cli
