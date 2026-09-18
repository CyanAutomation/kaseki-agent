# Kaseki-Agent Artifact Scoring - Quick Reference (REVISED)

**Date**: June 11, 2026 | **Total Artifacts Evaluated**: 105+  
**Strategy**: All artifacts always generated; no flags, no time-based deletion, breaking changes OK

---

## 🎯 Key Changes from Original Plan

| Aspect | Original | Revised | Impact |
|--------|----------|---------|--------|
| **Low-value artifacts** | Conditional (failure only) | **Always remove** | Simpler, cleaner |
| **Time-based deletion** | 7-day auto-delete | **Remove (run cleanup handles it)** | No time logic needed |
| **Feature flags** | KASEKI_DEBUG_RAW_EVENTS=1 | **All always generated** | Consistent outputs |
| **Deprecation** | Gradual 4-week plan | **Immediate breaking changes OK** | Faster implementation |
| **Empty artifacts** | Omit if nothing | **Include with "no X" markers** | Always consistent structure |

---

## 📊 Bottom 10 Artifacts to REMOVE (Score ≤2)

| # | Artifact | Score | Reason | Action |
|---|----------|-------|--------|--------|
| 1 | stdout.log | 0 | Raw event stream duplicate | **DELETE** |
| 2 | progress.log | 0 | Exact duplicate of progress.jsonl | **DELETE** |
| 3 | validation-raw.log | 0 | Exact duplicate of validation.log | **DELETE** |
| 4 | pi-events.raw.jsonl | 0 | Pre-filter raw events | **DELETE** |
| 5 | scouting-stderr.log | 1 | Duplicate of stderr.log | **DELETE** |
| 6 | goal-setting-stderr.log | 1 | Duplicate of stderr.log | **DELETE** |
| 7 | goal-check-stderr.log | 1 | Duplicate of stderr.log | **DELETE** |
| 8 | run-evaluation-stderr.log | 1 | Duplicate of stderr.log | **DELETE** |
| 9 | stderr.log | 2 | Unstructured errors | **DELETE** |
| 10 | pre-validation-raw.log | 0 | Exact duplicate | **DELETE** |

**Total to remove**: 30–50 low-value artifacts  
**Storage savings**: 60–300 MB per run

---

## 🟢 KEEP CORE (Score 10) — Always Generate

```
✅ metadata.json                           (Primary source of truth)
✅ pi-summary.json                         (Agent statistics)
✅ secret-scan.json                        (Security detections)
✅ restoration.jsonl                       (Allowlist restoration tracking)
✅ failure.json                            (Failure context - empty array if none)
✅ goal-check.json                         (Goal verification result)
✅ goal-check-summary.json                 (Goal summary)
✅ goal-setting.json                       (Goal setting result)
✅ scouting.json                           (Scouting analysis)
✅ test-baseline-comparison.json           (Test impact analysis)
✅ test-impact-warnings.jsonl              (Test warnings)
✅ expectation-mismatch-warnings.jsonl     (Expected vs actual mismatches)
```

---

## 🟢 KEEP FOR AGENT CONTEXT (Score 8–9) — Always Generate

```
✅ exit_code                               (Single integer, 0=success)
✅ progress.jsonl                          (Stage progress events)
✅ pi-events.jsonl                         (Filtered Pi agent events)
✅ changed-files.txt                       (File list)
✅ git.diff                                (Full unified diff)
✅ validation.log                          (Validation command output)
✅ validation-timings.tsv                  (Per-command timing)
✅ stage-timings.tsv                       (Per-stage timing)
✅ phase-errors.jsonl                      (Consolidated phase errors)
✅ goal-check-attempts.jsonl               (All goal-check attempts)
✅ goal-check-validation-errors.jsonl      (Validation errors from goal-check)
✅ goal-setting-summary.json               (Goal-setting stats)
✅ goal-setting-events.jsonl               (Filtered goal-setting events)
✅ scouting-summary.json                   (Scouting stats)
✅ scouting-events.jsonl                   (Filtered scouting events)
✅ run-evaluation.json                     (Run evaluation result)
✅ cache-metrics.json                      (Dependency cache metrics)
✅ artifact-validation-errors.jsonl        (Artifact validation errors)
```

---

## 🔴 REMOVE (Score ≤4) — Delete from Generation

### Exact Duplicates (Delete Immediately)

```
✗ progress.log                             (100% duplicate of progress.jsonl)
✗ stdout.log                               (Raw event stream - use progress.jsonl)
✗ stderr.log                               (Raw unstructured - use phase-errors.jsonl)
✗ validation-raw.log                       (100% duplicate of validation.log)
✗ pre-validation-raw.log                   (100% duplicate of pre-validation.log)
✗ secret-scan.log                          (100% duplicate of secret-scan.json)
✗ quality.log                              (100% duplicate of quality-gates.json)
✗ auto-lint-cleanup.log                    (Duplicate of timing data)
✗ git.status                               (100% duplicate of changed-files.txt)
✗ All .raw.jsonl files                     (8 artifacts: raw pre-filter events)
✗ All feature-specific .stderr.log files   (4 artifacts: scouting, goal-setting, goal-check, run-evaluation)
```

### Low-Value Diagnostics (Delete)

```
✗ filter-diagnostics.log                   (Debug noise)
✗ last-command.log                         (Informational only)
✗ validation-before-state.txt              (Rarely useful)
✗ validation-after-state.txt               (Rarely useful)
✗ validation-changed-files.txt             (Duplicate of changed-files.txt)
✗ git.diff.stats                           (Available in git.diff header)
✗ scouting-report.md                       (Human-only, no agent value)
✗ restoration-report.md                    (Consolidate into restoration.jsonl)
✗ result-summary.md                        (Consolidate into metadata.json)
```

---

## 🎯 Implementation: 4 Phases (No Flags, No Time Logic)

### Phase 1: Remove Low-Value Artifacts (1–2 days)

**Files to modify**: kaseki-agent.sh, feature agents

**Delete**:

```bash
# In kaseki-agent.sh, remove these lines:
echo "..." > progress.log                   # DELETE
cp /dev/null stdout.log (or don't generate)  # DELETE  
cp /dev/null stderr.log (or don't generate)  # DELETE
# ... and all other low-value artifacts
```

**Expected**:

- 30–50 fewer artifact files
- 60–300 MB per-run savings
- Zero breaking changes (agents don't use these)

### Phase 2: Consolidate Duplicate Logs (1–2 days)

**Files to modify**: kaseki-agent.sh, validation scripts

**Actions**:

- Delete `secret-scan.log` generation (keep `secret-scan.json` only)
- Delete `quality.log` generation (keep `quality-gates.json` only)
- Delete `auto-lint-cleanup.log` generation

**Expected**:

- 4–5 more artifacts removed
- Structured JSON as only output format

### Phase 3: Merge Redundant Data (1–2 days)

**Files to modify**: kaseki-report.js, all agents

**Actions**:

- Move `validation-results.json` → `metadata.json.phases.validation`
- Move `quality-gates.json` → `metadata.json.phases.quality_gates`
- Move `all-phase-summaries.json` → `metadata.json.phases`
- Convert `result-summary.md` → `metadata.json.summary` (JSON field)

**Expected**:

- metadata.json becomes single source of truth
- 4–5 fewer artifact files
- Cleaner agent interface

### Phase 4: Add Schema Versioning (1 day)

**Files to create/modify**: docs/ARTIFACT_SCHEMAS.md, CLAUDE.md

**Actions**:

- Add `schema_version: "1.0"` to all JSON/JSONL
- Create OpenAPI specs for all ≥8 score artifacts
- Update CLAUDE.md artifact inventory

**Expected**:

- Future-proof contracts
- Clear schema documentation
- No storage/performance impact

---

## 📊 Final Artifact Inventory

### Post-Implementation (All Always Generated)

**Core (4)**:

- metadata.json
- pi-summary.json
- secret-scan.json
- restoration.jsonl

**Essential (3)**:

- exit_code
- progress.jsonl
- pi-events.jsonl

**Analysis (20+)**:

- changed-files.txt, git.diff, validation.log, validation-timings.tsv
- stage-timings.tsv, phase-errors.jsonl, artifact-validation-errors.jsonl
- failure.json, cache-metrics.json, timings-manifest.json
- goal-check.json, goal-check-summary.json, goal-check-attempts.jsonl
- goal-check-validation-errors.jsonl, goal-setting.json, goal-setting-summary.json
- scouting.json, scouting-summary.json, run-evaluation.json, run-evaluation-summary.json
- test-baseline-comparison.json, critical-change-expectations.json
- test-impact-warnings.jsonl, expectation-mismatch-warnings.jsonl
- And 10+ more with always-generated empty markers

**Feature Events (8)**:

- scouting-events.jsonl, goal-setting-events.jsonl, goal-check-events.jsonl, run-evaluation-events.jsonl
- critical-change-verification.log, critical-change-verification-summary.json, test-impact-warnings.log
- And 1 more

**Total**: ~60 artifacts (from 105+)
**Reduction**: 43% fewer artifacts
**Storage saving**: 60–300 MB per run (85% on success)

---

## ✅ Always-Generated Strategy

All in-scope artifacts are **always generated**, with structured "no X" or empty markers:

```json
// Example: failure.json (empty on success)
{
  "exit_code": 0,
  "failures": [],
  "notes": "No failures detected"
}

// Example: phase-errors.jsonl (empty on success)
[] (empty array)

// Example: restoration.jsonl (empty if no allowlist)
[] (empty array)
```

This ensures:

- Consistent artifact structure for agents
- No conditional logic in code (no flags, no feature checks)
- Whole-run cleanup handles deletion (no time-based logic)
- All agents see expected files every time

---

## 🚀 Quick Start

**Week 1**: Remove all ≤4 score artifacts (30–50 files)

- Edit kaseki-agent.sh, delete generation lines
- Delete low-value artifact generation from feature agents
- Test: Run kaseki, verify artifacts match expected list

**Week 2**: Consolidate duplicate logs

- Remove secret-scan.log, quality.log, auto-lint-cleanup.log generation
- Keep only structured JSON versions
- Test: Verify agents read from JSON artifacts

**Week 3**: Merge into metadata.json

- Restructure metadata.json to include phases.validation, phases.quality_gates, etc.
- Update kaseki-report.js to read from new paths
- Update agents to use new structure
- Test: All agent integration tests pass

**Week 4**: Schema versioning

- Add schema_version to all JSON/JSONL artifacts
- Create docs/ARTIFACT_SCHEMAS.md with OpenAPI specs
- Update CLAUDE.md final inventory
- Done!

---

## 📈 Expected Metrics

| Metric | Before | After |
|--------|--------|-------|
| Artifacts per run | 100–120 | 55–65 |
| Per-run size (baseline) | 115–410 MB | 15–50 MB |
| Storage reduction | — | 60–300 MB (85% on success) |
| Unique schemas | 30+ | 15 |
| Agent integration points | ~20 | ~20 (simplified paths) |
| Code complexity | High (flags, conditions) | Low (always-generated) |

---

## 🔗 Reference Documents

- [ARTIFACT_EVALUATION_REVISED.md](ARTIFACT_EVALUATION_REVISED.md) — Complete revised strategy
- [ARTIFACT_SCORING_EVALUATION.md](ARTIFACT_SCORING_EVALUATION.md) — Full 5-dimensional scoring details
- [ARTIFACT_CONSUMPTION_RESEARCH.md](ARTIFACT_CONSUMPTION_RESEARCH.md) — Artifact usage patterns
