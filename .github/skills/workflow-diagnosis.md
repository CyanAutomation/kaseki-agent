---
name: Workflow Diagnosis
description: Diagnosing kaseki run failures and interpreting artifacts
tags: [kaseki, troubleshooting, diagnostics, debugging]
relatedSkills: [prompt-engineering, quality-gate-config, test-automation, docker-image-management, dependency-cache-optimization, result-report-analysis]
---

# Workflow Diagnosis for Kaseki Agent

This skill guides you through diagnosing failures in kaseki runs, interpreting artifacts, and identifying root causes.

## Overview

**When to Use**:
- A kaseki run failed and you need to understand why
- Performance is slower than expected
- Unexpected files were changed
- Quality gates failed (diff size, allowlist, secrets)
- Agent timed out or produced unexpected output

**Key Process**:
1. Check `metadata.json` for exit codes (quick status)
2. Read `result-summary.md` for human-readable summary
3. Inspect relevant artifact based on failure type
4. Use exit code mapping to find root cause
5. Refer to related skill for remediation

---

## Artifact Inspection Order

When a kaseki run completes, artifacts are written to `/agents/kaseki-results/kaseki-N/`:

### First: Check metadata.json
```json
{
  "instance": "kaseki-1",
  "start_time": "2026-04-25T10:30:00Z",
  "end_time": "2026-04-25T10:45:30Z",
  "duration_seconds": 930,
  "exit_codes": {
    "agent": 0,
    "validation": 0,
    "quality_gates": 0,
    "overall": 0
  },
  "model": "openrouter/free",
  "timeout_seconds": 1200
}
```

**What to Look For**:
- `exit_codes.overall`: 0 = success, non-zero = failure
- `exit_codes.agent`: Pi CLI exit code (0 = completed, 124 = timeout)
- `exit_codes.validation`: Validation command exit code
- `exit_codes.quality_gates`: Quality gate failures (see below)
- `duration_seconds`: How long the run took (baseline: 5–15 min)

### Second: Read result-summary.md
Human-readable status and key facts:

```markdown
# Kaseki Run Summary: kaseki-1

**Status**: ✓ Success  
**Duration**: 15m 30s  
**Model**: openrouter/free  

## Validation Results
- ✓ All validation commands passed
- ✓ Quality gates passed
- ✓ No secrets detected

## Changes
- Files modified: 3
- Lines added: 42
- Lines removed: 18
- Diff size: 2.4 KB
```

**What to Look For**:
- Status line (Success, Failure, Timeout, etc.)
- Which validation commands passed/failed
- Quality gate results
- Change summary (file count, diff size)

### Third: Check Relevant Artifact Based on Exit Code

Use the **Exit Code Mapping** table below to jump to the right artifact.

---

## Exit Code Mapping & Remediation

| Exit Code | Meaning | Artifact to Check | Remediation Skill |
|---|---|---|---|
| 0 | Success | `pi-summary.json` | N/A (success) |
| 2 | Missing API key / config | `stdout.log`, `stderr.log` | N/A (configuration) |
| 3 | Empty git diff | `git.diff`, `pi-events.jsonl` | [Prompt Engineering](prompt-engineering.md) |
| 4 | Diff exceeds max bytes | `git.diff`, `changed-files.txt` | [Quality Gate Configuration](quality-gate-config.md) |
| 5 | Changed file outside allowlist | `changed-files.txt`, `quality.log` | [Quality Gate Configuration](quality-gate-config.md) |
| 6 | Secret scan hit (sk-or-* leak) | `secret-scan.log` | [Prompt Engineering](prompt-engineering.md) |
| 124 | Pi agent timeout | `pi-summary.json`, `stdout.log` | [Prompt Engineering](prompt-engineering.md) or [Docker Image Management](docker-image-management.md) |
| Other | Validation command failure | `validation.log`, exit code in metadata | [Test Automation](test-automation.md) |

---

## Common Failure Patterns

### Pattern 1: Empty Diff (Exit Code 3)

**Symptom**: Kaseki completes but produces no changes.

**Quick Diagnosis**:
```bash
cat /agents/kaseki-results/kaseki-N/git.diff
# Output: (empty or minimal)

cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.status'
# Output: "completed"
```

**Root Causes**:
1. **Prompt was too vague** → Agent didn't understand what to do
   - Remediation: See [Prompt Engineering](prompt-engineering.md) — be more specific
2. **Code was already correct** → Bug doesn't exist or is fixed
   - Remediation: Verify the issue manually in the repo
3. **Validation commands fail on any change** → Too strict constraints
   - Remediation: See [Quality Gate Configuration](quality-gate-config.md) — loosen constraints

**Diagnosis Steps**:
```bash
# Did the agent think there was nothing to do?
cat /agents/kaseki-results/kaseki-N/pi-events.jsonl | grep -i "nothing\|no change\|complete"

# Did validation commands fail without agent changes?
cat /agents/kaseki-results/kaseki-N/validation.log

# Is the issue actually present in the cloned repo?
# Check git.status to see what the agent saw
cat /agents/kaseki-results/kaseki-N/git.status
```

### Pattern 2: Agent Timeout (Exit Code 124)

**Symptom**: Agent runs for `KASEKI_AGENT_TIMEOUT_SECONDS` (default 1200s = 20m) then stops.

**Quick Diagnosis**:
```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.duration_seconds'
# Output: 1200 (or close to timeout value)

cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.status'
# Output: "timeout" or incomplete
```

**Root Causes**:
1. **Task too complex** → Agent exploring too many options
   - Remediation: Simplify task scope; provide more constraints
2. **Validation commands are slow** → npm ci, build takes 10+ minutes
   - Remediation: See [Dependency Cache Optimization](dependency-cache-optimization.md)
3. **Pi CLI performance issue** → Upstream problem with LLM
   - Remediation: Retry with a different model or shorter timeout

**Diagnosis Steps**:
```bash
# Check where time was spent
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
# Shows: command | duration_seconds

# Was most time in npm install?
head -5 /agents/kaseki-results/kaseki-N/validation-timings.tsv

# Check Pi summary for events and reasoning length
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '{events, thinking_chars}'
```

### Pattern 3: Allowlist Violation (Exit Code 5)

**Symptom**: Agent changed files outside the allowlist.

**Quick Diagnosis**:
```bash
cat /agents/kaseki-results/kaseki-N/changed-files.txt
# Output: src/lib/parser.ts tests/parser.test.ts src/other/config.ts
# (src/other/config.ts is NOT in allowlist)

cat /agents/kaseki-results/kaseki-N/quality.log
# Output: Changed file 'src/other/config.ts' not in allowlist
```

**Root Causes**:
1. **Allowlist too narrow** → Legitimate files excluded
   - Remediation: See [Quality Gate Configuration](quality-gate-config.md) — expand allowlist
2. **Prompt scope unclear** → Agent made assumption and changed extra files
   - Remediation: See [Prompt Engineering](prompt-engineering.md) — be explicit about constraints

**Diagnosis Steps**:
```bash
# See exactly which files changed
cat /agents/kaseki-results/kaseki-N/changed-files.txt

# Check what the allowlist was
echo $KASEKI_CHANGED_FILES_ALLOWLIST
# Or re-inspect git.diff to see what agent tried to do
cat /agents/kaseki-results/kaseki-N/git.diff | grep '^diff --git' | head -10
```

### Pattern 4: Diff Size Exceeded (Exit Code 4)

**Symptom**: Changes are too large.

**Quick Diagnosis**:
```bash
wc -c < /agents/kaseki-results/kaseki-N/git.diff
# Output: 250000 (exceeds default 200000 = 200 KB)

cat /agents/kaseki-results/kaseki-N/quality.log
# Output: Diff size 250000 bytes exceeds KASEKI_MAX_DIFF_BYTES (200000)
```

**Root Causes**:
1. **Task too broad** → Agent changed too much
   - Remediation: See [Prompt Engineering](prompt-engineering.md) — narrow task scope
2. **Max diff too conservative** → Limit is unreasonable for this task
   - Remediation: See [Quality Gate Configuration](quality-gate-config.md) — increase limit

**Diagnosis Steps**:
```bash
# What changed?
cat /agents/kaseki-results/kaseki-N/changed-files.txt

# How much per file?
git diff --stat < /agents/kaseki-results/kaseki-N/git.diff | tail -5
```

### Pattern 5: Validation Command Failed

**Symptom**: Exit code in metadata shows validation failure (not 0).

**Quick Diagnosis**:
```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.exit_codes.validation'
# Output: 1 (command exited with code 1)

cat /agents/kaseki-results/kaseki-N/result-summary.md | grep -A 5 "Validation Results"
# Shows which command failed
```

**Root Causes**:
1. **Tests don't pass** → Agent made breaking change
   - Remediation: Review pi-events.jsonl to see agent's reasoning
2. **Type checker failed** → New type errors introduced
   - Remediation: Check validation.log for type error details
3. **Build failed** → Syntax error or missing dependency
   - Remediation: Check validation.log for build error

**Diagnosis Steps**:
```bash
# See full validation output
cat /agents/kaseki-results/kaseki-N/validation.log | tail -100

# Check timing to see which command failed
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv

# Compare git diff to understand what agent tried
head -50 /agents/kaseki-results/kaseki-N/git.diff
```

### Pattern 6: Secret Leak Detected (Exit Code 6)

**Symptom**: Credentials found in artifacts.

**Quick Diagnosis**:
```bash
cat /agents/kaseki-results/kaseki-N/secret-scan.log
# Output: Found secret pattern sk-or-abc... in {filename}:{line}
```

**Root Causes**:
1. **Prompt included API key example** → Security issue in prompt design
   - Remediation: See [Prompt Engineering](prompt-engineering.md) — security checklist
2. **Agent exposed environment variable** → Unexpected behavior
   - Remediation: Check pi-events.jsonl to see what agent was thinking

**Diagnosis Steps**:
```bash
# Find exact secret patterns
grep -r "sk-or-" /agents/kaseki-results/kaseki-N/ --exclude-dir=.git

# Was it in the prompt or agent output?
grep "sk-or-" /agents/kaseki-results/kaseki-N/pi-events.jsonl

# Revoke/rotate any exposed credentials immediately
```

---

## Performance Analysis

### Check Overall Duration

```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '{start: .start_time, end: .end_time, duration_seconds: .duration_seconds}'
```

**Expected Baselines**:
- `npm ci` with cache hit: 10–30 seconds
- `npm ci` cache miss: 1–3 minutes
- Validation commands: 1–5 minutes (varies by repo)
- Pi agent (typical task): 5–10 minutes
- **Total**: 5–15 minutes for a typical run

**If Slower Than Expected**:
1. Check validation timings (see below)
2. See [Dependency Cache Optimization](dependency-cache-optimization.md) if npm is slow
3. See [Workflow Diagnosis](#pattern-2-agent-timeout-exit-code-124) for timeout pattern

### Check Validation Command Timings

```bash
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
# Output:
# command          duration_seconds
# npm ci           120
# npm run check    45
# npm run test     90
# npm run build    60
```

**Optimization**:
- `npm ci` > 2m? → Cache issue, see [Dependency Cache Optimization](dependency-cache-optimization.md)
- `npm test` > 5m? → Consider running only relevant tests
- Any command > 10m? → Consider increasing `KASEKI_AGENT_TIMEOUT_SECONDS`

---

## Pi Agent Analysis

### Quick Stats

```bash
cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.statistics'
# Output:
# {
#   "events": 42,
#   "thinking_tokens": 5000,
#   "output_tokens": 2000,
#   "total_tokens": 7000,
#   "status": "completed"
# }
```

**What to Look For**:
- `events`: Number of reasoning steps (10–50 is typical)
- `thinking_tokens`: Reasoning effort (5k–20k is normal)
- `total_tokens`: Cost indicator (affects model choice)
- `status`: "completed", "timeout", "error"

### Understand Agent Behavior

```bash
# See high-level event types
cat /agents/kaseki-results/kaseki-N/pi-events.jsonl | jq '.type' | sort | uniq -c | sort -rn
# Output:
# 15 "thought"
# 10 "tool_call"
# 8 "tool_result"
# 5 "message"
```

**Interpretation**:
- More `thought` events = agent reasoning longer (possibly confused)
- Many `tool_call` events = agent trying multiple approaches
- Few events = straightforward task

### Check For Errors

```bash
# Look for error events
cat /agents/kaseki-results/kaseki-N/pi-events.jsonl | jq 'select(.type == "error")'

# Look for warnings in output
grep -i "warn\|error\|failed" /agents/kaseki-results/kaseki-N/pi-events.jsonl
```

---

## Decision Tree

Use this flowchart to diagnose issues:

```
START: Kaseki run completed

1. Check exit_codes.overall in metadata.json
   ├─ 0 → Run succeeded! Analyze results with pi-summary.json
   ├─ 2 → Missing API key/config (check env vars)
   ├─ 3 → Empty diff (see Pattern 1)
   ├─ 4 → Diff too large (see Pattern 4)
   ├─ 5 → Allowlist violation (see Pattern 3)
   ├─ 6 → Secret leak (see Pattern 6)
   ├─ 124 → Timeout (see Pattern 2)
   └─ Other → Check validation.log (Pattern 5)

2. If exit code is 0:
   ├─ Changes look good? Verify with git.diff
   ├─ Tests passed? See validation-timings.tsv
   └─ Done!

3. If exit code is non-zero:
   ├─ Read result-summary.md for human explanation
   ├─ Jump to matching pattern above
   ├─ Apply remediation from linked skill
   ├─ Refine task/config
   └─ Retry with new kaseki instance (e.g., kaseki-2)
```

---

## Useful Commands

### Inspect a Run Quickly

```bash
# Summary view
tail -30 /agents/kaseki-results/kaseki-N/result-summary.md

# Exit codes
jq .exit_codes /agents/kaseki-results/kaseki-N/metadata.json

# Changed files
cat /agents/kaseki-results/kaseki-N/changed-files.txt

# Pi stats
jq .statistics /agents/kaseki-results/kaseki-N/pi-summary.json
```

### Compare Multiple Runs

```bash
# Compare timings across runs
for dir in /agents/kaseki-results/kaseki-{1,2,3}/; do
  echo "=== $(basename $dir) ==="
  jq '.duration_seconds' "$dir/metadata.json"
  grep "npm ci" "$dir/validation-timings.tsv" | awk '{print $2}'
done
```

### Extract Full Pi Interaction

```bash
# Pretty-print events (useful for debugging agent reasoning)
jq -r '.type + ": " + (.content // .message // "")' \
  /agents/kaseki-results/kaseki-N/pi-events.jsonl | head -50
```

---

## Related Skills & Docs

- [Prompt Engineering](prompt-engineering.md) — Design better tasks to avoid failures
- [Quality Gate Configuration](quality-gate-config.md) — Set appropriate constraints
- [Test Automation](test-automation.md) — Ensure validation tests are robust
- [Docker Image Management](docker-image-management.md) — Image-related issues
- [Dependency Cache Optimization](dependency-cache-optimization.md) — Performance tuning
- [Result Report Analysis](result-report-analysis.md) — Metrics and baselines
- [CLAUDE.md](../../CLAUDE.md) — Complete architecture and exit codes reference
