# Kaseki Agent Artifacts - Quick Reference Scoring Matrix

**Generated**: 2026-06-11  
**Purpose**: Quick lookup table for artifact scoring and evaluation

## All Artifacts by Score (High to Low)

### SCORE 5: ESSENTIAL (Must Keep)

| Artifact | Size | Used By | Failure-Only? | Description |
|----------|------|---------|---------------|-------------|
| metadata.json | 10-50 KB | kaseki-report, kaseki-cli, external agents | No | Central metadata: exit codes, timings, model, config |
| exit_code | <1 KB | CI/CD, retry logic | No | File with single exit code number |
| changed-files.txt | 0.1-10 KB | Allowlist validation, agents | No | Line-separated list of changed files |
| git.diff | 0-400+ KB | Quality gates, secret scan | No | Unified diff of all changes |
| stderr.log | 5-100 KB | Error detection, debugging | No | Container stderr stream |
| stdout.log | 50-500 KB | Stage parsing, monitoring | No | Container stdout stream |
| validation.log | 20-500 KB | Validation failure detection | No | Post-agent validation output |
| progress.jsonl | 2-50 KB | Live monitoring, agents | No | Structured progress events (JSONL) |
| quality.log | 0.1-10 KB | Quality gate checking | Partial | Quality gate violations |
| secret-scan.log | 0-5 KB | Security monitoring | Partial | API key/credential detection |
| goal-check.json | 0.5-2 KB | Retry decision logic | Only if goal-check enabled | Goal verification result (met/not met) |
| host-start.json | 0.5-2 KB | Instance config, all CLI commands | No | Repo URL, git ref, timeout config |

### SCORE 4: HIGH VALUE (Keep, Optimize)

| Artifact | Size | Used By | Failure-Only? | Description |
|----------|------|---------|---------------|-------------|
| pi-events.jsonl | 100-500 KB | External analysis agents | No | Filtered Pi coding agent events |
| pi-summary.json | 5-30 KB | Analysis commands, agents | No | Pi stats: model, tool counts |
| failure.json | 1-10 KB | Retry agents, failure context | Yes (!=0) | Structured failure classification |
| validation-timings.tsv | 0.5-5 KB | kaseki-report, performance analysis | No | Per-command validation timings |
| stage-timings.tsv | 0.5-5 KB | Performance analysis | No | Per-stage execution timing |
| dependency-cache.log | 0.5-10 KB | Cache strategy analysis | No | npm cache hit/miss strategy |
| restoration.jsonl | 0.1-5 KB | Allowlist metrics, agents | Partial | File restoration events (structured) |
| scouting.json | 1-10 KB | Task analysis, agents | If scouting | Scouting task analysis results |
| goal-setting.json | 2-10 KB | Goal context, agents | If goal-setting | Refined goal and scope |
| run-evaluation.json | 1-10 KB | Post-run assessment, agents | If evaluation | Run quality assessment |

### SCORE 3: MODERATE VALUE (Keep, Consider Consolidation)

| Artifact | Size | Used By | Failure-Only? | Description |
|----------|------|---------|---------------|-------------|
| pre-validation.log | 20-200 KB | Baseline comparison | No | Pre-agent validation (baseline) |
| pre-validation-timings.tsv | 0.5-5 KB | Timing analysis | No | Pre-validation timing |
| test-baseline-comparison.json | 5-50 KB | Test failure analysis, agents | If baseline enabled | Pre-existing vs new failures |
| validation-before-state.txt | 0.5-2 KB | Validation allowlist check | No | Git state before validation |
| validation-after-state.txt | 0.5-2 KB | Validation allowlist check | No | Git state after validation |
| validation-changed-files.txt | 0.1-1 KB | Validation allowlist check | No | Files changed during validation |
| auto-lint-cleanup-timings.tsv | 0.2-2 KB | Reporting | No | Cleanup command timing |
| result-summary.md | 0.5-5 KB | Human review | No | Human-readable status summary |
| restoration-report.md | 0.5-5 KB | Allowlist guidance (human) | Partial | Markdown allowlist guidance |
| quality-gates.json | 0.1-5 KB | Structured violation log | Partial | JSON array of gate violations |
| critical-change-expectations.json | 0.2-1 KB | Change verification | If goal-setting | Expected critical changes |
| timings-manifest.json | 1-10 KB | Consolidated timing view | No | JSON consolidation of timing data |
| goal-check-attempts.jsonl | 0.5-5 KB | Retry pattern analysis | If goal-check | All goal-check attempts (JSONL) |
| scouting-events.jsonl | 50-300 KB | External scouting analysis | If scouting | Filtered scouting events |
| goal-setting-events.jsonl | 50-300 KB | External analysis | If goal-setting | Filtered goal-setting events |
| goal-check-events.jsonl | 50-300 KB | External analysis | If goal-check | Filtered goal-check events |
| run-evaluation-events.jsonl | 50-300 KB | External analysis | If evaluation | Filtered evaluation events |

### SCORE 2: LOW VALUE (Informational/Debug Only)

| Artifact | Size | Used By | Failure-Only? | Description |
|----------|------|---------|---------------|-------------|
| progress.log | 1-20 KB | Human reading only | No | Plain text progress (DUPLICATE of progress.jsonl) |
| last-command.log | 1-2 KB | Human debugging | No | Last command before exit (debugging) |
| git.status | 0.1-5 KB | Not used (DUPLICATE of changed-files.txt) | No | Git status output (redundant) |
| pi-stderr.log | 0-20 KB | Debugging only | No | Pi agent stderr (errors in stderr.log) |
| auto-lint-cleanup.log | 5-100 KB | Human inspection | No | Linting/cleanup output |
| scouting-stderr.log | 0-20 KB | Debugging only | No | Scouting stderr (errors in stderr.log) |
| scouting-validation-errors.jsonl | 0-2 KB | Diagnostic only | Partial | Scouting artifact validation errors |
| scouting-summary.json | 2-10 KB | Not actively consumed | If scouting | Scouting stats summary |
| goal-setting-summary.json | 2-10 KB | Not actively consumed | If goal-setting | Goal-setting stats |
| goal-check-stderr.log | 0-20 KB | Debugging only | If goal-check | Goal-check stderr |
| goal-check-summary.json | 2-10 KB | Not actively consumed | If goal-check | Goal-check stats |
| goal-check-validation-summary.txt | 0.5-2 KB | Not actively consumed | Partial | Validation summary text |
| run-evaluation-stderr.log | 0-20 KB | Debugging only | If evaluation | Evaluation stderr |
| run-evaluation-summary.json | 2-10 KB | Not actively consumed | If evaluation | Evaluation stats |
| test-impact-warnings.log | 0-10 KB | Human inspection | Partial | Test impact static analysis |
| expectation-mismatch-warnings.jsonl | 0-10 KB | Human inspection | Partial | Expected vs actual diff mismatches |
| git-push.log | 0-20 KB | Human inspection | If GitHub ops | Git push operation output |
| all-phase-summaries.json | 1-10 KB | Not actively consumed | No | Consolidated phase summaries |
| pre-validation-raw.log | 20-200 KB | Not used (replaced by pre-validation.log) | No | Unfiltered pre-validation output |
| validation-raw.log | 20-500 KB | Not used (replaced by validation.log) | No | Unfiltered validation output |

### SCORE 1: DEPRECATED/INTERMEDIATE (Remove After Use)

| Artifact | Size | Purpose | Failure-Only? | Action |
|----------|------|---------|---------------|--------|
| scouting-candidate.json | 1-5 KB | Intermediate (validated → scouting.json) | If scouting | **REMOVE** after validation |
| goal-setting-candidate.json | 1-5 KB | Intermediate (validated → goal-setting.json) | If goal-setting | **REMOVE** after validation |
| goal-check-candidate.json | 1-5 KB | Intermediate (validated → goal-check.json) | If goal-check | **REMOVE** after validation |
| run-evaluation-candidate.json | 1-5 KB | Intermediate (validated → run-evaluation.json) | If evaluation | **REMOVE** after validation |
| filter-diagnostics.log | 0-20 KB | Debug artifact (only with KASEKI_DEBUG_RAW_EVENTS=1) | No | **REMOVE** unless debug enabled |
| format-check-command.txt | 0.1-0.5 KB | Diagnostic (rarely needed) | No | **REMOVE** |

---

## By Use Case

### For CI/CD Pipeline Integration

**REQUIRED ARTIFACTS**:

- exit_code (exit code checking)
- metadata.json (exit_code, failed_command, model)
- failure.json (failure classification for retry)
- validation.log (validation failure details)
- quality.log (quality gate failures)
- secret-scan.log (security checks)
- progress.jsonl (timeout detection via elapsed time)

### For External Monitoring/Observability

**REQUIRED ARTIFACTS**:

- progress.jsonl (live stage tracking)
- metadata.json (config, timing, model)
- stdout.log (stage markers for parsing "==> Stage:")
- stderr.log (error detection)
- host-start.json (instance context)

### For Retry/Feedback Agents

**REQUIRED ARTIFACTS**:

- metadata.json (all exit codes, attempt counts)
- failure.json (failure context)
- goal-check.json (retry decision)
- changed-files.txt (what changed)
- validation.log (what failed in validation)

### For Human Review/Debugging

**RECOMMENDED ARTIFACTS**:

- result-summary.md (quick status)
- metadata.json (detailed metadata)
- failure.json (failure classification)
- validation.log (what failed)
- quality.log (what gates failed)
- restoration-report.md (allowlist guidance)
- git.diff (actual code changes)

### For Performance Analysis

**USEFUL ARTIFACTS**:

- stage-timings.tsv (per-stage timing)
- validation-timings.tsv (per-command timing)
- dependency-cache.log (cache hit/miss)
- metadata.json (duration_seconds, pi_duration_seconds)

### For Change Analysis

**USEFUL ARTIFACTS**:

- git.diff (full diff)
- changed-files.txt (list of files)
- git.status (file status)
- test-baseline-comparison.json (test impact)
- critical-change-expectations.json (verification)

---

## Duplication Matrix

| Artifact A | Artifact B | Overlap | Recommendation |
|-----------|-----------|---------|-----------------|
| progress.log | progress.jsonl | 95% | **REMOVE progress.log** |
| git.status | changed-files.txt | 100% | **REMOVE git.status** |
| scouting-candidate.json | scouting.json | 100% | **REMOVE candidate after validation** |
| goal-setting-candidate.json | goal-setting.json | 100% | **REMOVE candidate after validation** |
| goal-check-candidate.json | goal-check.json | 100% | **REMOVE candidate after validation** |
| run-evaluation-candidate.json | run-evaluation.json | 100% | **REMOVE candidate after validation** |
| all-phase-summaries.json | individual summaries | 80% | **CONSOLIDATE or REMOVE** |
| validation-raw.log | validation.log | 95% | **REMOVE raw, use filtered** |
| pre-validation-raw.log | pre-validation.log | 95% | **REMOVE raw, use filtered** |
| pi-stderr.log | stderr.log | 70% | **REMOVE, use central stderr** |
| scouting-stderr.log | stderr.log | 70% | **REMOVE, use central stderr** |
| metadata.json | pi-summary.json | 40% | **KEEP both** (metadata + detail) |
| metadata.json | failure.json | 30% | **KEEP both** (different purposes) |
| quality.log | quality-gates.json | 70% | **KEEP both** (text + structured) |

---

## Artifact Generation Cost Matrix

| Cost Level | Artifacts | Frequency | Total Impact |
|-----------|----------|-----------|--------------|
| **High** (100+ KB) | git.diff, stdout.log, stderr.log, pi-events.jsonl | Always | Large |
| **Medium** (10-50 KB) | metadata.json, validation.log, pre-validation.log | Always | Moderate |
| **Low** (<10 KB) | Most others | Always/Conditional | Small |

**Total typical run**: 500 KB - 2 MB per run depending on validation verbosity and event count

---

## Recommended Cleanup (Priority Order)

1. **IMMEDIATE** - Remove after validation:
   - scouting-candidate.json
   - goal-setting-candidate.json
   - goal-check-candidate.json
   - run-evaluation-candidate.json

2. **SHORT-TERM** - Remove redundant:
   - progress.log (duplicate of progress.jsonl)
   - git.status (duplicate of changed-files.txt)

3. **MEDIUM-TERM** - Consolidate:
   - Merge validation-raw.log → validation.log
   - Reduce phase stderr logs to central stderr.log
   - Consolidate timing data

4. **LONG-TERM** - Evaluate:
   - All *-validation-errors.jsonl files (diagnostic noise)
   - all-phase-summaries.json (unused consolidation)
   - filter-diagnostics.log (rarely needed debug)

---

## Size Estimate by Configuration

### Minimal Run (no scouting, goal-check, or baseline)

```
Core: ~100 KB
- stdout.log: 50 KB
- stderr.log: 5 KB
- git.diff: 10 KB
- metadata.json: 5 KB
- pi-events.jsonl: 20 KB
- Other: 10 KB
Total: ~100 KB
```

### Standard Run (with scouting + goal-check)

```
Core: ~200 KB
+ Scouting: ~100 KB
+ Goal-check: ~50 KB
+ Events/logs: ~200 KB
Total: ~550 KB
```

### Heavy Run (all features + large git.diff)

```
Core: ~200 KB
+ Large git.diff: ~300+ KB
+ Scouting/Goal: ~150 KB
+ Events/logs: ~500 KB
+ Baseline: ~200 KB
Total: ~1.4+ MB
```

---

## Implementation Notes

- **All Score 5 artifacts** are essential and should never be removed
- **Score 1-2 candidates** can be safely removed without affecting external tools
- **Intermediates (*-candidate.json)** should be deleted after validation succeeds
- **Duplication in logs** is acceptable for now; consolidation is future optimization
- **External agents depend on** metadata.json + goal-check.json + failure.json as primary trilogy
