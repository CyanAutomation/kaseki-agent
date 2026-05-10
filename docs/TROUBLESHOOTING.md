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
  ├─ 4: Diff too large → Increase KASEKI_MAX_DIFF_BYTES or use allowlist
  ├─ 5: Allowlist violation → Review changed files
  ├─ 6: Secret detected → Audit code for credentials
  ├─ 7: Validation failed → Check validation.log
  ├─ 124: Timeout → Increase KASEKI_AGENT_TIMEOUT_SECONDS
  └─ 127: Command not found → Verify installation
```

---

## Exit Code Troubleshooting

See [EXIT_CODES.md](EXIT_CODES.md) for detailed per-code reference. Quick lookup:

| Code | Issue | Check | Fix |
|------|-------|-------|-----|
| **0** | ✓ Success | None | N/A |
| **1** | Generic failure | metadata.json `exit_code_stage`, logs | See "Generic Failure" below |
| **2** | Config/auth missing | KASEKI_API_KEYS, OPENROUTER_API_KEY | Set API key in env or file |
| **3** | No changes made | result-summary.md | Expected if code unchanged |
| **4** | Diff exceeds limit | changed-files.txt, git.diff size | Use allowlist or increase KASEKI_MAX_DIFF_BYTES |
| **5** | File outside allowlist | quality.log, changed-files.txt | Review KASEKI_CHANGED_FILES_ALLOWLIST |
| **6** | Secret detected | secret-scan.log | Audit code for `sk-or-*` credentials |
| **7** | Validation failed | validation.log | See "Validation Failures" below |
| **124** | Agent timeout | pi-summary.json `elapsed_seconds` | Increase KASEKI_AGENT_TIMEOUT_SECONDS |
| **127** | Command not found | stdout.log, stderr.log | Reinstall; verify Node.js v24+ |

---

## Generic Failure Diagnosis (Exit Code 1)

### Step 1: Check Stage Where Failure Occurred

```bash
# Extract per-stage exit codes
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.stages'

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
tail -100 /agents/kaseki-results/kaseki-N/stdout.log | grep -i error
tail -50 /agents/kaseki-results/kaseki-N/pi-stderr.log

# Agent timeout?
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.elapsed_seconds, .timeout_seconds'
```

**Validation Phase Failed** (exit_code_stage: validation):

```bash
cat /agents/kaseki-results/kaseki-N/validation.log
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv  # Which command failed?
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
# Lists files with detected credential patterns (sk-or-*)
```

### Step 3: Read Structured Failure Reason

```bash
# Machine-readable failure reason
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.validation_failure_reason, .quality_failure_reason'

# Example:
# "validation_failure_reason": "validation_command_failed: npm run test (exit 1)"
# "quality_failure_reason": "max_diff_bytes: 250000 exceeds limit of 200000"
```

---

## Validation Failures (Exit Code 7)

### Problem: Validation Commands Fail

Validation commands are executed sequentially (default: `npm run check;npm run test;npm run build`). If any exits non-zero, validation fails.

### Diagnosis

```bash
# 1. Which command failed?
cat /agents/kaseki-results/kaseki-N/validation.log | head -20  # Shows first failure

# 2. What exit code?
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
# Columns: command, exit_code, elapsed_seconds

# 3. Full error output?
grep -A 50 "npm run test" /agents/kaseki-results/kaseki-N/validation.log
```

### Common Issues

**Issue: `npm run check` / `npm run test` exits with "not found"**

```
npm ERR! missing script: check
npm ERR! missing script: test
```

**Fix:** The script doesn't exist in package.json; this is non-fatal by design. Validation continues to next command.

**Issue: Validation fails due to code changes**

```
FAIL: src/__tests__/index.test.ts
TypeError: expected X to be Y
```

**Fix:** This is expected — agent made changes that broke tests. Either:

- Adjust agent task prompt (see [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md))
- Adjust allowlist to restrict agent changes (see [QUALITY_GATES.md](QUALITY_GATES.md))
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
kaseki-cli follow kaseki-5 | grep -i error
```

### Post-Run Analysis

```bash
# Generate diagnostic report
kaseki-report /agents/kaseki-results/kaseki-5

# Review what changed
cat /agents/kaseki-results/kaseki-5/git.diff | head -100

# Check validation results
cat /agents/kaseki-results/kaseki-5/validation-timings.tsv
```

---

## Allowlist Troubleshooting

### Too Many Files Being Restored

When validation runs, files outside the allowlist are restored to their original state. If many files are restored, it means the agent modified files outside the intended scope.

```bash
# Count restored files
grep "restore:" /agents/kaseki-results/kaseki-N/restoration.jsonl | wc -l

# Review restoration report
cat /agents/kaseki-results/kaseki-N/restoration-report.md
```

**Solutions:**

1. **Use pre-flight validation** to preview what agent will change:

   ```bash
   bash /path/to/scripts/dry-run-allowlist.sh <repo_url> <git_ref> "<task>"
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
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.elapsed_seconds, .timeout_seconds'

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

**Fix:** Check [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) for optimization tips.

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

## See Also

- [EXIT_CODES.md](EXIT_CODES.md) — Detailed exit code reference
- [QUALITY_GATES.md](QUALITY_GATES.md) — Allowlist configuration & patterns
- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Writing better task prompts
- [CLI.md](CLI.md) — Monitoring with kaseki-cli
