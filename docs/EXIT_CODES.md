# Kaseki Agent Exit Codes

> **NPM CLI note:** direct `kaseki-agent run` examples submit through the configured API service. Start `kaseki-agent serve` locally or set `KASEKI_API_URL`; use `KASEKI_API_KEY` when the service requires authentication.

This document describes the exit codes returned by kaseki-agent commands and what they mean.

## Summary

| Code | Category | Name | Meaning |
|------|----------|------|---------|
| **0** | Success | N/A | Run completed successfully |
| **1** | General Error | Generic Error | Generic error (check logs for details) |
| **2** | Configuration | Configuration Error | Configuration error (missing or invalid settings) |
| **3** | Git | Empty Diff | No changes were made to the repository |
| **4** | Quality Gate | Diff Too Large | The git diff exceeded `KASEKI_MAX_DIFF_BYTES` limit |
| **5** | Quality Gate | Allowlist Violation | Changed files are outside the agent phase allowlist |
| **6** | Security | Secret Detected | Secret scan detected potential credentials in diff/workspace |
| **7** | Quality Gate | Validation Allowlist Violation | Files changed during validation are outside allowlist |
| **8** | Goal Check | Goal Unmet | Goal-check evaluator determined the scouting objective was not met after retries |
| **86** | Scouting | Scouting Validation Failed | Scouting artifact missing or invalid (check Docker volume mounts) |
| **88** | Provider | Provider/Model Error (Non-Retryable) | LLM provider error that could not be recovered after automatic retry |
| **124** | Timeout | Agent Timeout | Agent invocation exceeded `KASEKI_AGENT_TIMEOUT_SECONDS` |
| **127** | Docker | Docker Init Failed | Docker container initialization failed (missing entrypoint script) |
| **141** | Validation | SIGPIPE | Validation output filter crashed or exited unexpectedly (broken pipe) |

## Detailed Descriptions

### 0 — Success

The run completed successfully. All validation checks passed, and changes were committed.

**Action:** No action needed. View results with `kaseki-agent report <instance-id>`

---

### 1 — Generic Error

A general error occurred. This is used for unexpected failures that don't fit other categories.

**Troubleshooting:**

1. Check the run logs: `kaseki-agent report <instance-id>`
2. Check the standard output/error: `cat /agents/kaseki-results/<instance-id>/stdout.log`
3. Enable verbose logging: Set `DEBUG=1` before running the command

---

### 2 — Configuration Error

A required configuration setting is missing or invalid.

**Common causes:**

- Missing OpenRouter API key
- Incorrect directory paths
- Invalid Docker image reference

**Action:**

1. Run health check: `kaseki-agent doctor`
2. Fix any reported issues (the doctor command often provides a `--fix` option)
3. Verify configuration: `kaseki-agent config list`

---

### 3 — Empty Diff

No changes were made to the repository. The agent may have attempted modifications, but they resulted in no net changes (or all changes were reverted).

**Common causes:**

- Agent task was trivial and didn't require changes
- Agent made changes that were later reverted
- Repository was already in the desired state

**Action:**

- Review the task prompt to ensure it's clear and specific
- Check the Pi agent logs to see what the agent did: `kaseki-agent report <instance-id>`

---

### 4 — Diff Too Large

The git diff exceeded the configured maximum size (`KASEKI_MAX_DIFF_BYTES`, default: 400KB).

**Common causes:**

- Task resulted in too many changes
- Binary files were included in the changes
- Lock files (package-lock.json, yarn.lock) were modified

**Action:**

1. Check what files changed: `cat /agents/kaseki-results/<instance-id>/changed-files.txt`
2. Review the diff: `git diff <instance-id>/` or check `git.diff` in results
3. Adjust the scope of the task to make fewer changes, OR increase `KASEKI_MAX_DIFF_BYTES`

---

### 5 — Allowlist Violation (Agent Phase)

Changed files are outside the agent phase allowlist. This is
a quality gate to prevent the agent from modifying unintended
files.

**Common causes:**

- Task scope was too broad
- Agent modified files outside the intended scope
- Allowlist patterns are too restrictive

**Action:**

1. Review changed files: `cat /agents/kaseki-results/
  <instance-id>/changed-files.txt`
2. Check the allowlist: `kaseki-agent config get
  validation.allowlist`
3. Adjust either:
   - The task prompt to be more specific (prevents agent
     from making changes)
   - The `KASEKI_CHANGED_FILES_ALLOWLIST` to include the
     necessary files

See [QUALITY_GATES.md](QUALITY_GATES.md) for pattern syntax
and examples.

---

### 6 — Secret Detected

The secret scan detected a potential credential (e.g., API key, auth token) in the diff or workspace.

**Common causes:**

- Agent accidentally committed credentials
- Configuration files with secrets were modified
- Credentials were exposed in comments or logs

**Action:**

1. Review the secret scan report: `cat /agents/kaseki-results/<instance-id>/secret-scan.log`
2. Identify what was flagged: `grep "sk-or-" /agents/kaseki-results/<instance-id>/git.diff`
3. Determine the source:
   - If agent caused it: Review the task prompt, ensure it doesn't ask for credentials
   - If repository has secrets: Use `.gitignore` to exclude sensitive files
4. Never commit real credentials to the repository

---

### 7 — Validation Allowlist Violation

Files changed during the validation phase (when running
test/build commands) are outside the validation allowlist.

**Common causes:**

- Validation commands generated unexpected artifacts
- Test commands modified source files
- Build processes created/modified files outside the
  expected locations

**Action:**

1. Check the restoration report: `cat /agents/kaseki-results/
  <instance-id>/restoration-report.md`
2. Review what validation commands ran: `cat /agents/kaseki-results/
  <instance-id>/validation.log`
3. Adjust `KASEKI_VALIDATION_ALLOWLIST` to include the
  necessary patterns, OR
4. Adjust validation commands to not modify unintended
  files

---

### 83 — Scouting Prerequisite Validation Failed

The scouting phase was never invoked because the filesystem prerequisites failed. This is an **early exit** that prevents expensive Pi invocation when the environment is misconfigured.

**Root causes:**

1. **Read-only `/results` volume mount** — The `/results` directory is mounted as read-only (`:ro` flag or `--read-only` container flag without writable volume mount).
2. **Missing `/results` directory** — The `/results` directory was not mounted or created in the container.
3. **Permission denied** — The container user cannot write to `/results` due to incorrect file permissions or filesystem restrictions.

**Diagnosis:**

1. Check the early validation error message in container stderr:

   ```bash
   # Error message will include:
   # [SCOUTING PREREQUISITE FAILED] /results is not writable
   # Fix: docker run -v /path/to/results:/results:rw kaseki-agent
   ```

2. Check filesystem diagnostics:

   ```bash
   cat /agents/kaseki-results/<instance-id>/metadata.json | jq '.filesystem_diagnostics'
   ```

3. Verify the `/results` mount:

   ```bash
   docker inspect <container-id> | jq '.Mounts'
   ```

**Action:**

1. **For read-only `/results` mount — MOST COMMON:**

   - If using `docker run` directly:

     ```bash
     # ❌ WRONG: read-only mount
     docker run -v /path/to/results:/results:ro kaseki-agent

     # ✅ CORRECT: read-write mount with :rw flag
     docker run -v /path/to/results:/results:rw kaseki-agent
     ```

   - If using `docker-compose.yml`:

     ```yaml
     volumes:
       kaseki-results:
     
     services:
       kaseki:
         volumes:
           - kaseki-results:/results:rw  # Must have :rw flag
     ```

   - If using `--read-only` container flag:

     ```bash
     docker run --read-only \
       -v /path/to/results:/results:rw \  # Explicit :rw required
       -v /tmp:/tmp:rw \                  # Also mount /tmp for temp files
       kaseki-agent
     ```

2. **For missing `/results` directory:**

   - Create the directory and mount it:

     ```bash
     mkdir -p /agents/kaseki-results/kaseki-1
     docker run -v /agents/kaseki-results/kaseki-1:/results:rw kaseki-agent
     ```

3. **For permission issues:**

   - Ensure the host directory is writable by the container:

     ```bash
     chmod 755 /agents/kaseki-results
     docker run -v /agents/kaseki-results:/results:rw kaseki-agent
     ```

**Prevention:**

- Use `run-kaseki.sh` (which handles volume mounts automatically) instead of manual `docker run`
- Use `docker-compose.yml` with explicit `:rw` flags
- When using `--read-only`, always explicitly mount `/results:rw`
- Run `./run-kaseki.sh --doctor` to validate your setup before running tasks

---

### 86 — Scouting Validation Failed

The scouting phase failed because the scouting artifact file (`/results/scouting-candidate.json`) was not created or is invalid.

**Root causes:**

1. **Read-only `/results` volume mount** — The `/results` directory is mounted as read-only (`:ro` flag or `--read-only` container flag without writable volume mount). This prevents the Pi agent from writing the artifact file.
2. **Missing volume mount** — The `/results` directory is not mounted as a volume or tmpfs, causing writes to fail silently.
3. **Permissions issue** — The container user (UID 10000) cannot write to `/results` due to incorrect permissions.
4. **Scouting disabled** — Scouting was explicitly disabled via `KASEKI_SCOUTING=0`.
5. **Pi agent crash** — The scouting Pi invocation crashed before writing the artifact.

**Diagnosis:**

1. Check the filesystem diagnostics:

   ```bash
   cat /agents/kaseki-results/<instance-id>/filesystem-readonly-reason.txt
   cat /agents/kaseki-results/<instance-id>/filesystem-writable-at-start.txt
   ```

2. Check if the artifact file exists:

   ```bash
   ls -la /agents/kaseki-results/<instance-id>/scouting-candidate.json
   ```

3. Check for read-only filesystem errors in stderr:

   ```bash
   grep -i "read-only" /agents/kaseki-results/<instance-id>/stderr.log
   ```

4. Review the scouting validation errors:

   ```bash
   cat /agents/kaseki-results/<instance-id>/scouting-validation-errors.jsonl
   ```

**Action:**

1. **For read-only `/results` volume:**

   - If using `run-kaseki.sh`: Verify `/results` is mounted with `:rw` flag:

     ```bash
     -v "$RESULT_DIR:/results:rw"  # Correct
     -v "$RESULT_DIR:/results:ro"  # Wrong — causes exit 86
     ```

   - If using `docker-compose.yml`: Ensure `/results` is listed as a writable volume:

     ```yaml
     volumes:
       - /agents:/agents:rw      # Correct
       - /results:/results:ro    # Wrong — causes exit 86
     ```

   - If using `--read-only` container flag: Ensure `/results` is mounted or tmpfs'd as writable:

     ```bash
     docker run --read-only \
       -v /path/to/results:/results:rw \  # Must have :rw flag
       kaseki-template:latest
     ```

2. **For missing `/results` mount:**

   - Create and mount the `/results` directory:

     ```bash
     mkdir -p /agents/kaseki-results/<instance-id>
     docker run -v /agents/kaseki-results/<instance-id>:/results:rw kaseki-template:latest
     ```

3. **For permission issues:**

   - Ensure `/results` is writable by UID 10000:

     ```bash
     mkdir -p /agents/kaseki-results/<instance-id>
     chmod 755 /agents/kaseki-results/<instance-id>
     chown -R 10000:10000 /agents/kaseki-results/<instance-id}
     ```

4. **For Scouting disabled:**

   - Enable scouting by setting `KASEKI_SCOUTING=1` in environment or config

5. **For Pi agent crash:**

   - Check Pi agent stderr:

     ```bash
     tail -50 /agents/kaseki-results/<instance-id>/stderr.log
     ```

   - Enable debug logging:

     ```bash
     KASEKI_DEBUG_RAW_EVENTS=1 kaseki-agent run ...
     ```

---

### 88 — Provider/Model Error (Non-Retryable)

The LLM provider returned an error that could not be recovered after an automatic retry attempt. Kaseki-agent automatically detects transient provider errors and retries once; exit code 88 indicates the retry also failed.

**What triggered the automatic retry:**

Kaseki-agent automatically retries once on certain transient provider/model errors:

- **HTTP 503** (Service Unavailable)
- **HTTP 429** (Rate Limited)
- **Connection errors** (ECONNRESET, ETIMEDOUT, etc.)
- **Model unavailable** (temporary service issue)

**Why this run failed:**

The error occurred but was not retryable, OR the automatic retry also failed. Examples of non-retryable errors:

- **HTTP 404** (Model not found - permanent)
- **Deprecated model** (permanently removed from service)
- **Authentication error** (invalid or expired API key)
- **Invalid configuration** (malformed request parameters)

**Diagnosis:**

1. Check the provider error details in metadata:

   ```bash
   cat /agents/kaseki-results/<instance-id>/metadata.json | jq '.provider_error_*'
   ```

   Look for:
   - `.provider_error_type` — Error classification
   - `.provider_error_message` — Full error text
   - `.provider_error_retryable` — Whether automatic retry was attempted
   - `.provider_error_retry_attempt_count` — Number of attempts (0, 1, or 2)
   - `.provider_error_retry_result` — Result of retry (none/success/failed)

2. Check the provider error log:

   ```bash
   cat /agents/kaseki-results/<instance-id>/quality.log | grep -i provider
   ```

3. Review the raw Pi events:

   ```bash
   cat /agents/kaseki-results/<instance-id>/pi-events.jsonl | grep -i error
   ```

**Action:**

**If the error is transient (503, 429, connection timeout):**

- The error was retried automatically. If it failed again, this indicates the provider is experiencing prolonged issues.
- **Wait a few minutes** and retry the run.
- Check OpenRouter status: https://status.openrouter.io or contact their support.

**If the error is permanent (404, deprecated, auth failure):**

1. **For 404 (model not found):**

   - The specified model is no longer available
   - Check the model name in your config: `kaseki-agent config get model`
   - List available models: `kaseki-agent models list` or check [OpenRouter](https://openrouter.ai)
   - Update the model: `kaseki-agent config set model openrouter/free` (or another available model)

2. **For deprecated model:**

   - The model was discontinued by the provider
   - Switch to a current model: `kaseki-agent config set model openrouter/free`
   - Refer to the provider's migration guide if available

3. **For authentication error:**

   - Verify your OpenRouter API key is valid and has not expired
   - Check your account credits/quota at https://openrouter.ai
   - Refresh your credentials: `kaseki-agent setup` (interactive wizard)

4. **For invalid configuration:**

   - Review the error message for details on which parameter is malformed
   - Run health check: `kaseki-agent doctor`
   - Use `kaseki-agent doctor --fix` to auto-correct common issues

**Prevention:**

- Use a reliable, up-to-date model: `KASEKI_MODEL=openrouter/free` (default, recommended)
- Monitor provider status before running tasks
- Set up budget alerts in your provider account to catch quota issues early
- Consider increasing timeout for slow/rate-limited providers: `KASEKI_AGENT_TIMEOUT_SECONDS=1800`

---

### 124 — Agent Timeout

The Pi agent invocation exceeded the configured timeout
(`KASEKI_AGENT_TIMEOUT_SECONDS`, default: 1200 seconds / 20
minutes).

**Common causes:**

- Task is complex and requires more time
- Agent is stuck in a loop or retry cycle
- Validation commands are taking too long

**Action:**

1. Check if the agent was actively working: `kaseki-agent
  report <instance-id>`
2. Increase the timeout if the task genuinely requires more
   time:

   ```bash
   kaseki-agent config set agent.timeout_seconds 1800
     # 30 minutes
   ```

3. Simplify the task prompt to make the agent work more
   efficiently
4. Reduce validation commands that are slow

---

### 127 — Docker Initialization Failed

The Docker container failed to initialize. This indicates the kaseki-entrypoint script is missing from the Docker image.

**Root cause:** The Docker image is missing critical scripts or is corrupted.

**Common causes:**

- Docker image is corrupted or partially downloaded
- Image is from a different/incompatible version
- Image build failed and wasn't caught

**Action:**

1. Run health check to verify image integrity:

   ```bash
   kaseki-agent doctor
   ```

2. Pull the latest image:

   ```bash
   docker pull docker.io/cyanautomation/kaseki-agent:latest
   ```

3. If using a custom image, rebuild it:

   ```bash
   docker build -t kaseki-template:latest .
   ```

4. Retry the run:

   ```bash
   kaseki-agent run <repo> <ref> <task>
   ```

If the problem persists, check Docker logs:

```bash
docker run --rm docker.io/cyanautomation/kaseki-agent:latest ls -la /usr/local/bin/kaseki-*
```

---

### 141 — SIGPIPE (Broken Pipe) in Validation Pipeline

The validation command encountered SIGPIPE (signal 13), which indicates the output filter process (`validation-output-filter`) crashed or exited unexpectedly while processing command output.

**Root cause:** When a process in a pipe chain exits abruptly
without properly closing its input/output, the upstream process
receives SIGPIPE (signal 13 = exit code 128 + 13 = 141).

**Common causes:**

- **Large validation output** — npm test/build produced 100k+ lines (common on large projects)
- **Memory pressure** — Filter process ran out of heap memory (RPi 4 has 4GB total)
- **Encoding issue** — Validation output contained non-UTF8 characters
- `validation-output-filter` encountered an error while
  processing output (e.g., readline error, encoding issue)
- System resource constraint (memory, file descriptors, disk) caused
  filter process to abort
- Filter received a signal that caused abnormal termination

**Diagnosis (Enhanced in v1.88+):**

Three new diagnostic artifacts are now generated to help diagnose SIGPIPE failures:

1. **`validation-startup-diagnostics.log`** — System state captured BEFORE validation starts
   - Memory usage (free -h output)
   - Disk space (df -h output)
   - Open file descriptors count
   - Process memory usage (VmRSS from /proc/self/status)

2. **`filter-diagnostics.log`** — Detailed filter process events
   - Filter startup (pid, node version, memory thresholds)
   - Per-1000-lines memory checks
   - Backpressure events (when downstream pipe stalled)
   - Errors and warnings during processing
   - Final shutdown stats (lines processed, output, errors)

3. **`validation-infrastructure-diagnostics.md`** — Human-readable report
   - Summary of likely causes
   - Pre-failure system state
   - Filter process diagnostics
   - Specific remediation steps

**To review diagnostics after SIGPIPE failure:**

```bash
# Check pre-failure system state
cat /agents/kaseki-results/<instance-id>/validation-startup-diagnostics.log

# View detailed filter events
cat /agents/kaseki-results/<instance-id>/filter-diagnostics.log

# Read human-friendly diagnostics report
cat /agents/kaseki-results/<instance-id>/validation-infrastructure-diagnostics.md

# Check metadata for infrastructure failure flag
jq '.validation_infrastructure_diagnostics' /agents/kaseki-results/<instance-id>/metadata.json

# Check filter diagnostics in metadata
jq '.validation_infrastructure_diagnostics | keys' /agents/kaseki-results/<instance-id>/metadata.json
```

**Action:**

1. **Review the diagnostics report** — Read `validation-infrastructure-diagnostics.md` for specific remediation:

   ```bash
   cat /agents/kaseki-results/<instance-id>/validation-infrastructure-diagnostics.md
   ```

2. **Increase container memory** if running on memory-constrained system (RPi 4):

   ```bash
   docker run --memory=4g kaseki-agent
   ```

3. **Reduce validation output verbosity**:

   ```bash
   # Pass --silent or --quiet to npm test/build
   export KASEKI_VALIDATION_COMMANDS="npm run test -- --silent"
   ```

4. **Split large test suites** across multiple validation commands:

   ```bash
   export KASEKI_VALIDATION_COMMANDS="npm run test:unit;npm run test:integration"
   ```

5. **Re-run** to verify the fix:

   ```bash
   kaseki-agent run <repo> <ref> <task>
   ```

6. **If persists:** Collect and review:
   - `validation-raw.log` (unfiltered validation output)
   - `filter-diagnostics.log` (detailed filter events)
   - `validation-startup-diagnostics.log` (pre-failure state)
     large output

---

## Exit Codes from Sub-Processes

When kaseki-agent runs validation commands (npm test, npm run build, etc.), it may propagate exit codes from those commands:

| Code | Meaning |
|------|---------|
| **0** | Validation passed |
| **Non-zero** | Validation command failed (e.g., tests failed, build failed) |

These are reported in `validation.log` with the command name and output.

---

## Debugging

To get more detailed error information:

1. **View run summary:**

   ```bash
   kaseki-agent report <instance-id>
   ```

2. **View logs:**

   ```bash
   cat /agents/kaseki-results/<instance-id>/stdout.log
   cat /agents/kaseki-results/<instance-id>/stderr.log
   ```

3. **View stage-by-stage status:**

   ```bash
   cat /agents/kaseki-results/<instance-id>/metadata.json | jq '.stages'
   ```

4. **Enable verbose output:**

   ```bash
   DEBUG=1 kaseki-agent run <repo> <ref> <task>
   ```

5. **Check system resources:**

   ```bash
   df -h /agents                 # Disk space
   docker ps -a                  # Running containers
   docker logs <container-id>    # Container logs (if stuck)
   ```

---

## See Also

- [QUALITY_GATES.md](QUALITY_GATES.md) — Detailed quality gate configuration
- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — How to write effective task prompts
- [DEVELOPMENT.md](DEVELOPMENT.md) — Development and debugging setup
