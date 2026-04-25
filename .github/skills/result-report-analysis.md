---
name: Result Report Analysis
description: Interpreting kaseki-report output and artifact metrics
tags: [kaseki, analysis, reporting, metrics, diagnostics]
relatedSkills: [workflow-diagnosis]
---

# Result Report Analysis for Kaseki Agent

This skill guides interpreting kaseki-report output and analyzing kaseki run artifacts to extract metrics, baselines, and insights.

## Overview

**When to Use**:
- Post-run analysis and performance review
- Comparing runs or establishing baselines
- Detecting resource anomalies or bottlenecks
- Extracting metrics for dashboards or reports
- Understanding agent behavior and token usage

**Key Concepts**:
- kaseki-report generates a compact diagnostic summary from run artifacts
- Metrics include timing, file counts, token usage, and event statistics
- Baselines help identify abnormal runs
- Artifact analysis reveals agent reasoning and bottlenecks

---

## kaseki-report Output

### Running kaseki-report

```bash
# Generate report for a completed run
docker run --rm --entrypoint kaseki-report \
  -v /agents/kaseki-results/kaseki-1:/results:ro \
  kaseki-template:latest /results

# Or directly if scripts are in PATH
kaseki-report /agents/kaseki-results/kaseki-1
```

### Report Structure

```
================================================================================
Kaseki Run Report: kaseki-1
================================================================================

STATUS & TIMING
┌─────────────────────────────────────────────────────────────┐
│ Status: ✓ SUCCESS                                           │
│ Total Duration: 15m 30s (930 seconds)                       │
│ Start: 2026-04-25T10:30:00Z                                │
│ End: 2026-04-25T10:45:30Z                                  │
└─────────────────────────────────────────────────────────────┘

AGENT & VALIDATION
┌─────────────────────────────────────────────────────────────┐
│ Agent: OpenRouter (openrouter/free)                         │
│ Model Tokens: 7,234 (input: 5,000 | output: 2,234)         │
│ Thinking Tokens: 4,500 (reasoning cost)                    │
│ Events Processed: 42                                        │
│ Validation Commands: 3 passed                              │
│ All checks: PASS                                            │
└─────────────────────────────────────────────────────────────┘

CHANGES
┌─────────────────────────────────────────────────────────────┐
│ Files Modified: 3                                           │
│ Lines Added: 42                                             │
│ Lines Removed: 18                                           │
│ Total Diff Size: 2.4 KB                                     │
└─────────────────────────────────────────────────────────────┘

COMMAND TIMINGS
┌──────────────────────────────────────────────────────────────┐
│ npm ci         45 sec  (cache hit)                           │
│ npm run check  38 sec  (type checking)                       │
│ npm run test   124 sec (5 tests, 1 new)                     │
│ npm run build  90 sec  (successful)                          │
└──────────────────────────────────────────────────────────────┘

QUALITY GATES
┌──────────────────────────────────────────────────────────────┐
│ ✓ Allowlist Check: 3 files, all in scope                    │
│ ✓ Diff Size Check: 2.4 KB < 200 KB limit                    │
│ ✓ Secret Scan: No credentials detected                      │
│ ✓ Git Status: No untracked files                            │
└──────────────────────────────────────────────────────────────┘

KEY METRICS
┌──────────────────────────────────────────────────────────────┐
│ Tokens per Change: 2.4 tokens/byte (average)                │
│ Events per File: 14 events/file (agent reasoning)           │
│ Thinking Ratio: 66.8% (reasoning vs output)                 │
│ Cache Efficiency: 97% (most layers hit)                     │
└──────────────────────────────────────────────────────────────┘

EXIT CODES
overall: 0 (success)
agent: 0 (completed)
validation: 0 (all passed)
quality_gates: 0 (all passed)
================================================================================
```

---

## Artifact Overview

### File Structure

```
/agents/kaseki-results/kaseki-1/
├── metadata.json              # Timestamps, exit codes
├── result-summary.md          # Human-readable summary
├── pi-events.jsonl            # Filtered agent events (1 per line)
├── pi-summary.json            # Agent stats + summary
├── git.diff                   # Unified diff of changes
├── git.status                 # Git status output
├── changed-files.txt          # List of modified files
├── validation.log             # Test/check output
├── validation-timings.tsv     # Command durations
├── quality.log                # Quality gate results
├── secret-scan.log            # Secret detection results
├── stdout.log                 # Container stdout
├── stderr.log                 # Container stderr
└── exit_code                  # Overall exit code (0 = success)
```

### Quick Artifact Check

```bash
# Overall status
cat /agents/kaseki-results/kaseki-1/exit_code
# Output: 0 (success)

# What changed?
cat /agents/kaseki-results/kaseki-1/changed-files.txt
# Output:
# src/lib/role.ts
# tests/role.test.ts

# Diff stats
git apply --stat < /agents/kaseki-results/kaseki-1/git.diff
# Output:
# src/lib/role.ts     | 12 +-
# tests/role.test.ts  | 8 +-
# 2 files changed, 20 insertions(+), 0 deletions(-)
```

---

## Key Metrics & Interpretation

### Timing Metrics

**Artifact**: `metadata.json` + `validation-timings.tsv`

```json
{
  "start_time": "2026-04-25T10:30:00Z",
  "end_time": "2026-04-25T10:45:30Z",
  "duration_seconds": 930
}
```

**Baseline Durations**:

| Stage | Expected Range | Example |
|---|---|---|
| Clone + Setup | 30–60 sec | 45 sec |
| npm ci | 5–180 sec | 45 sec (cache hit) |
| Pi Agent Run | 300–600 sec | 450 sec |
| Validation Cmds | 60–300 sec | 250 sec |
| **Total** | **5–20 min** | **15 min 30 sec** |

**Interpretation**:
- < 5 min: Unusually fast (check if agent completed)
- 5–15 min: Excellent (optimized)
- 15–20 min: Good (acceptable)
- > 20 min: Slow (investigate)

### File Change Metrics

**Artifact**: `changed-files.txt` + `git.diff`

```bash
# Count files
wc -l < /agents/kaseki-results/kaseki-1/changed-files.txt
# Output: 3 files changed

# Check diff size
wc -c < /agents/kaseki-results/kaseki-1/git.diff
# Output: 2457 bytes (2.4 KB)

# Lines changed
git apply --stat < /agents/kaseki-results/kaseki-1/git.diff | tail -1
# Output: 2 files changed, 42 insertions(+), 18 deletions(-)
```

**Baseline Metrics**:

| Change Type | Typical Files | Typical Diff | Typical Lines |
|---|---|---|---|
| **Bug Fix** | 1–3 | 2–10 KB | 10–50 |
| **Feature Add** | 2–5 | 10–50 KB | 50–200 |
| **Refactor** | 1–3 | 5–30 KB | 20–100 |
| **Docs Update** | 1 | 1–10 KB | 5–50 |

**Interpretation**:
- Fewer files than expected → Agent was conservative
- More files than expected → Check if off-scope changes
- Larger diff than expected → Check for refactoring or verbosity

### Agent Token Metrics

**Artifact**: `pi-summary.json`

```json
{
  "statistics": {
    "events": 42,
    "thinking_tokens": 4500,
    "output_tokens": 2234,
    "input_tokens": 5000,
    "total_tokens": 11734,
    "thinking_ratio": 0.668
  }
}
```

**Metrics Breakdown**:

| Metric | Baseline | Interpretation |
|---|---|---|
| `events` | 10–50 | Number of reasoning steps |
| `thinking_tokens` | 30–50% of total | Agent reasoning effort |
| `output_tokens` | 20–40% of total | Generated code size |
| `input_tokens` | 20–50% of total | Prompt size |
| `total_tokens` | Task-dependent | Model cost |
| `thinking_ratio` | 0.5–0.8 | How much reasoning (0.5 = less thinking) |

**Interpretation**:
- High `thinking_ratio` (0.7+): Agent needed lots of reasoning (complex task or confusion)
- Low `thinking_ratio` (0.4–0.5): Agent decided quickly (straightforward task)
- High `output_tokens` relative to changes: Verbose or refactoring
- Low `total_tokens`: Efficient (good prompt scope)

### Event Metrics

**Artifact**: `pi-events.jsonl` + `pi-summary.json`

```bash
# Count events by type
jq '.type' /agents/kaseki-results/kaseki-1/pi-events.jsonl | sort | uniq -c
# Output:
#  8 "thought"
#  15 "tool_call"
#  12 "tool_result"
#  7 "message"
```

**Event Types**:

| Type | Baseline | Interpretation |
|---|---|---|
| `thought` | 5–15 | Reasoning steps (good) |
| `tool_call` | 10–20 | Tool invocations (file edits, commands) |
| `tool_result` | 10–20 | Tool responses (output, success/fail) |
| `message` | 2–8 | Agent messages |
| `error` | 0–3 | Errors encountered (ideally 0) |

**Interpretation**:
- More `thought` events = deeper reasoning (not bad, just thoughtful)
- Many `tool_call` + `tool_result` loops = trial-and-error (possible confusion)
- Any `error` events = something went wrong (check logs)

### Validation Metrics

**Artifact**: `validation-timings.tsv` + `validation.log`

```bash
# Check validation timing
cat /agents/kaseki-results/kaseki-1/validation-timings.tsv
# Output:
# npm ci              45
# npm run check       38
# npm run test        124
# npm run build       90
```

**Baseline Ranges**:

| Command | Fast (Cache) | Typical | Slow (Issue) |
|---|---|---|---|
| `npm ci` | 10–30 sec | 30–60 sec | > 120 sec |
| `npm run check` | 10–30 sec | 30–60 sec | > 120 sec |
| `npm run test` | 30–90 sec | 90–180 sec | > 300 sec |
| `npm run build` | 30–120 sec | 120–180 sec | > 300 sec |

**Interpretation**:
- Timings match baseline → Normal performance
- `npm ci` > 120 sec → Cache miss (new lock file)
- Individual test > 180 sec → Large test suite or slow build
- Any command timeout → Increase `KASEKI_AGENT_TIMEOUT_SECONDS`

---

## Anomaly Detection

### Red Flags

**❌ Empty Diff**
```bash
wc -c < /agents/kaseki-results/kaseki-1/git.diff
# Output: 0 (or very small)
```
→ Agent didn't make changes. See [Workflow Diagnosis](workflow-diagnosis.md) — Pattern 1.

**❌ Oversized Diff**
```bash
wc -c < /agents/kaseki-results/kaseki-1/git.diff
# Output: 250000 (exceeds 200 KB default)
```
→ Check if legitimate. See [Workflow Diagnosis](workflow-diagnosis.md) — Pattern 4.

**❌ Many Off-Scope Files**
```bash
cat /agents/kaseki-results/kaseki-1/changed-files.txt | wc -l
# Output: 15 files (expected 3)
```
→ Agent refactored more than intended. See [Quality Gate Configuration](quality-gate-config.md).

**❌ High Thinking Ratio**
```bash
jq '.statistics.thinking_ratio' /agents/kaseki-results/kaseki-1/pi-summary.json
# Output: 0.95 (95% reasoning vs output)
```
→ Agent was confused or struggling. Check prompt clarity.

**❌ Validation Failed**
```bash
grep -i "fail\|error" /agents/kaseki-results/kaseki-1/result-summary.md
# Output: ✗ Tests failed (2 failures)
```
→ Agent made breaking changes. See [Workflow Diagnosis](workflow-diagnosis.md) — Pattern 5.

**❌ Secret Detected**
```bash
cat /agents/kaseki-results/kaseki-1/secret-scan.log
# Output: Found sk-or-abc123 in pi-events.jsonl
```
→ Credential leaked. See [Workflow Diagnosis](workflow-diagnosis.md) — Pattern 6.

### Green Flags

**✓ Quick Completion** (< 10 min)
- Agent understood task immediately
- Task was straightforward
- Validation was fast

**✓ Minimal Changes** (< 5 KB diff)
- Well-scoped task
- Agent made surgical edits
- Low risk of side effects

**✓ Low Token Usage** (< 5k total)
- Efficient prompt
- Straightforward task
- Good model choice

**✓ Balanced Thinking Ratio** (0.5–0.7)
- Agent confident in approach
- Some reasoning but not excessive
- Not rushed

**✓ All Tests Passed**
- Agent validated changes thoroughly
- No regressions introduced
- High confidence in changes

---

## Comparison & Baselines

### Comparing Multiple Runs

```bash
# Compare timings across runs
for run in /agents/kaseki-results/kaseki-{1,2,3,4,5}/; do
  echo "=== $(basename $run) ==="
  cat "$run/metadata.json" | jq '{duration_seconds, exit_codes}'
done

# Calculate average duration
for run in /agents/kaseki-results/kaseki-{1,2,3,4,5}/; do
  cat "$run/metadata.json" | jq '.duration_seconds'
done | awk '{sum+=$1; count++} END {print "Average: " sum/count "s"}'
```

### Establishing a Baseline

For a specific repo or task type, establish a baseline:

```bash
# Collect metrics across 5 successful runs
for i in {1..5}; do
  TASK="Fix parser bug" ./run-kaseki.sh kaseki-baseline-$i
done

# Analyze baseline
for run in /agents/kaseki-results/kaseki-baseline-*/; do
  jq '{duration: .duration_seconds, tokens: .statistics.total_tokens, files: .files_modified}' \
    "$run/pi-summary.json"
done | jq -s 'add / length'

# Output (average):
# {
#   "duration": 900,        # 15 minutes avg
#   "tokens": 7000,         # 7k tokens avg
#   "files": 2.4            # 2-3 files avg
# }
```

**Use Baseline for**:
- Detecting anomalies (run taking 2x longer than baseline)
- Optimization targets (current 900s, target 600s)
- Model/config comparison (compare baselines before/after changes)

---

## Detailed Analysis Examples

### Example 1: Performance Slowdown

**Observation**: Recent runs are 30% slower than baseline

**Analysis Steps**:

1. **Gather Baselines**:
```bash
# Baseline (last month)
for run in /agents/kaseki-results/kaseki-{1..10}/; do
  jq '.duration_seconds' "$run/metadata.json"
done | awk '{sum+=$1} END {print "Avg: " sum/NR}'
# Output: Avg: 900

# Recent runs (this week)
for run in /agents/kaseki-results/kaseki-{91..100}/; do
  jq '.duration_seconds' "$run/metadata.json"
done | awk '{sum+=$1} END {print "Avg: " sum/NR}'
# Output: Avg: 1170  (30% slower!)
```

2. **Isolate the Bottleneck**:
```bash
# Check validation timings
for run in /agents/kaseki-results/kaseki-{91..100}/; do
  echo "=== $(basename $run) ==="
  awk '{print $1, $2}' "$run/validation-timings.tsv"
done | column -t

# Output shows npm ci increased from 30s → 120s
```

3. **Root Cause**:
```bash
# Check if lock files are changing
for run in /agents/kaseki-results/kaseki-{91..100}/; do
  if grep -q package-lock.json "$run/git.diff"; then
    echo "$(basename $run): Lock file modified"
  fi
done
# Output: 8 of 10 runs modified lock file
# → Cache misses due to dependency changes
```

4. **Solution**:
- See [Dependency Cache Optimization](dependency-cache-optimization.md) for cache seeding strategy
- Or update image seed cache with current lock file

### Example 2: Unexpected Large Diff

**Observation**: One run has 50 KB diff, others have 2–5 KB

```bash
# Identify outlier
for run in /agents/kaseki-results/kaseki-{81..90}/; do
  size=$(wc -c < "$run/git.diff")
  echo "$(basename $run): $size bytes"
done
# Output:
# kaseki-81: 3204
# kaseki-82: 4182
# kaseki-83: 2891
# kaseki-84: 50000  ← Outlier!
```

**Analysis**:
```bash
# Check what the task was for kaseki-84
cat /agents/kaseki-results/kaseki-84/pi-summary.json | jq '.task'

# Check changed files
cat /agents/kaseki-results/kaseki-84/changed-files.txt

# Check git diff for clues
head -50 /agents/kaseki-results/kaseki-84/git.diff

# Was it legitimate? Check if tests passed
cat /agents/kaseki-results/kaseki-84/result-summary.md | grep -i "validation\|test"
```

**Interpretation**:
- If tests passed: Agent did more refactoring than expected (document this)
- If tests failed: Investigate what went wrong

---

## Metrics for Dashboards

### Key Metrics to Track

```json
{
  "success_rate": "95%",
  "avg_duration_seconds": 900,
  "avg_tokens_per_run": 7000,
  "avg_diff_size_bytes": 3500,
  "cache_hit_rate": "78%",
  "validation_pass_rate": "99%",
  "secret_detections": 0,
  "allowlist_violations": 1
}
```

### Calculating Metrics

```bash
#!/bin/bash
# Calculate dashboard metrics

SUCCESS_COUNT=$(find /agents/kaseki-results -name "exit_code" -exec grep -l "^0$" {} \; | wc -l)
TOTAL_COUNT=$(find /agents/kaseki-results -name "exit_code" | wc -l)

SUCCESS_RATE=$((SUCCESS_COUNT * 100 / TOTAL_COUNT))

AVG_DURATION=$(find /agents/kaseki-results -name "metadata.json" \
  -exec jq '.duration_seconds' {} \; | awk '{sum+=$1} END {print sum/NR}')

AVG_TOKENS=$(find /agents/kaseki-results -name "pi-summary.json" \
  -exec jq '.statistics.total_tokens' {} \; | awk '{sum+=$1} END {print sum/NR}')

CACHE_HITS=$(find /agents/kaseki-results -name "validation-timings.tsv" \
  -exec grep "npm ci" {} \; | awk '$2 < 30' | wc -l)

TOTAL_NPM=$(find /agents/kaseki-results -name "validation-timings.tsv" \
  -exec grep "npm ci" {} \; | wc -l)

CACHE_HIT_RATE=$((CACHE_HITS * 100 / TOTAL_NPM))

echo "Success Rate: ${SUCCESS_RATE}%"
echo "Average Duration: ${AVG_DURATION}s"
echo "Average Tokens: ${AVG_TOKENS}"
echo "Cache Hit Rate: ${CACHE_HIT_RATE}%"
```

---

## Related Skills & Docs

- [Workflow Diagnosis](workflow-diagnosis.md) — Investigate anomalies and failures
- [kaseki-report.js](../../kaseki-report.js) — Report generation logic
- [CLAUDE.md](../../CLAUDE.md) — Architecture and artifact structure
