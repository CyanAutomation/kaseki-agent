# Kaseki Agent Exit Codes

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
| **124** | Timeout | Agent Timeout | Agent invocation exceeded `KASEKI_AGENT_TIMEOUT_SECONDS` |
| **127** | Docker | Docker Init Failed | Docker container initialization failed (missing entrypoint script) |

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

The git diff exceeded the configured maximum size (`KASEKI_MAX_DIFF_BYTES`, default: 200KB).

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

Changed files are outside the agent phase allowlist. This is a quality gate to prevent the agent from modifying unintended files.

**Common causes:**
- Task scope was too broad
- Agent modified files outside the intended scope
- Allowlist patterns are too restrictive

**Action:**
1. Review changed files: `cat /agents/kaseki-results/<instance-id>/changed-files.txt`
2. Check the allowlist: `kaseki-agent config get validation.allowlist`
3. Adjust either:
   - The task prompt to be more specific (prevents agent from making changes)
   - The `KASEKI_CHANGED_FILES_ALLOWLIST` to include the necessary files

See [QUALITY_GATES.md](QUALITY_GATES.md) for pattern syntax and examples.

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

Files changed during the validation phase (when running test/build commands) are outside the validation allowlist.

**Common causes:**
- Validation commands generated unexpected artifacts
- Test commands modified source files
- Build processes created/modified files outside the expected locations

**Action:**
1. Check the restoration report: `cat /agents/kaseki-results/<instance-id>/restoration-report.md`
2. Review what validation commands ran: `cat /agents/kaseki-results/<instance-id>/validation.log`
3. Adjust `KASEKI_VALIDATION_ALLOWLIST` to include the necessary patterns, OR
4. Adjust validation commands to not modify unintended files

---

### 124 — Agent Timeout

The Pi agent invocation exceeded the configured timeout (`KASEKI_AGENT_TIMEOUT_SECONDS`, default: 1200 seconds / 20 minutes).

**Common causes:**
- Task is complex and requires more time
- Agent is stuck in a loop or retry cycle
- Validation commands are taking too long

**Action:**
1. Check if the agent was actively working: `kaseki-agent report <instance-id>`
2. Increase the timeout if the task genuinely requires more time:
   ```bash
   kaseki-agent config set agent.timeout_seconds 1800  # 30 minutes
   ```
3. Simplify the task prompt to make the agent work more efficiently
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
