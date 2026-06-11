# Kaseki-Agent Artifact Scoring - Quick Reference Guide

**Date**: June 11, 2026 | **Total Artifacts Evaluated**: 105+

---

## 📊 Visual Scoring Distribution

```
Score Distribution (Stacked):

10 ⭐⭐⭐⭐⭐ [████████████] 12 artifacts (Perfect - Keep All)
 9 ⭐⭐⭐⭐  [████████    ] 8 artifacts  (Excellent)
 8 ⭐⭐⭐   [██████     ] 10 artifacts (Very Good)
 7 ⭐⭐    [██████     ] 10 artifacts (Good)
 6 ⭐     [██        ] 5 artifacts  (Adequate)
 5 ~     [██        ] 5 artifacts  (Marginal)
 4 ✗     [██        ] 5 artifacts  (Poor)
 3 ✗     [████      ] 8 artifacts  (Very Poor)
 2 ✗✗    [████████  ] 16 artifacts (Bad)
 1 ✗✗    [████      ] 8 artifacts  (Worse)
 0 ✗✗✗   [██████    ] 7 artifacts  (Useless)
         |──────────────────────────────|
         0    10    20    30    40    50
                    Artifact Count
```

---

## 🎯 Segment Summary Matrix

```
┌─────────────────────────────────────────────────────────────────┐
│                    ARTIFACT SEGMENTS                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🟢 KEEP (≥8)          │  🟡 MERGE (5-7)    │  🔴 REMOVE (≤4)   │
│  ├─ Always: 15         │  ├─ Consolidate: 8 │  ├─ Zero-value: 7 │
│  ├─ Feature: 15        │  ├─ Optimize: 7    │  ├─ Duplicate: 25  │
│  └─ Total: 30          │  ├─ Refactor: 5    │  ├─ Debug: 15      │
│    (28% of total)      │  └─ Total: 20      │  └─ Total: 55+     │
│                        │    (19% of total)   │    (53% of total)  │
│                                                                  │
│  🔑 CRITICAL          🔄 CONSOLIDATE        🗑️ DELETE           │
│  No changes needed    with primary sources  No agent value      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📋 All Artifacts at a Glance (105 Total)

### KEEP CORE (Score 10) — 12 Artifacts ⭐⭐⭐⭐⭐

```
✅ metadata.json                              (Core foundation)
✅ pi-summary.json                            (Agent stats)
✅ secret-scan.json                           (Security)
✅ restoration.jsonl                          (Allowlist tracking)
✅ test-baseline-comparison.json              (Test impact, if feature)
✅ critical-change-expectations.json          (Goals, if feature)
✅ test-impact-warnings.jsonl                 (Goals, if feature)
✅ expectation-mismatch-warnings.jsonl        (Goals, if feature)
✅ failure.json                               (Failure context)
✅ scouting.json                              (Scouting, if feature)
✅ goal-setting.json                          (Goals, if feature)
✅ goal-check.json                            (Checks, if feature)
✅ goal-check-summary.json                    (Checks, if feature)
```

### KEEP FOR AGENT CONTEXT (Score 8–9) — 18 Artifacts 🟢

```
✅ pi-events.jsonl                            (8, Agent analysis)
✅ changed-files.txt                          (8, Quick scope)
✅ exit_code                                  (9, Decision point)
✅ progress.jsonl                             (9, Live monitoring)
✅ phase-errors.jsonl                         (9, Consolidated errors)
✅ goal-check-attempts.jsonl                  (9, Retry logic, if feature)
✅ goal-check-validation-errors.jsonl         (9, Failure detail, if feature)
✅ goal-setting-summary.json                  (9, Goals summary, if feature)
✅ critical-change-verification-summary.json  (9, Goals, if feature)
✅ scouting-summary.json                      (8, Scouting, if feature)
✅ run-evaluation.json                        (8, Eval, if feature)
✅ run-evaluation-summary.json                (8, Eval, if feature)
✅ cache-metrics.json                         (8, Performance)
✅ artifact-validation-errors.jsonl           (8, Errors)
✅ stage-timings.tsv                          (8, Performance)
✅ critical-change-verification.log           (8, Goals, if feature)
✅ test-impact-warnings.log                   (8, Goals, if feature)
✅ timings-manifest.json                      (7, Performance)
```

### KEEP FOR CONTEXT (Score 7) — 8 Artifacts 🟢

```
✅ git.diff                                   (7, Core changes)
✅ validation.log                             (7, Validation detail)
✅ validation-timings.tsv                     (7, Perf timing)
✅ scouting-events.jsonl                      (7, Scouting, if feature)
✅ goal-setting-events.jsonl                  (7, Goals, if feature)
✅ goal-check-events.jsonl                    (7, Checks, if feature)
✅ auto-lint-cleanup-timings.tsv              (7, Lint, if feature)
✅ pre-validation-timings.tsv                 (7, Timing, if feature)
```

### MERGE/CONSOLIDATE (Score 5–7) — 20 Artifacts 🟡

| Artifact | Score | Target | Action |
|----------|-------|--------|--------|
| result-summary.md | 7 | metadata.json.summary | Convert to JSON field |
| secret-scan.log | 8 | secret-scan.json | Make secondary/optional |
| quality.log | 8 | quality-gates.json | Make secondary/optional |
| scouting-candidate.json | 5 | ~~DELETE~~ | Intermediate artifact |
| goal-setting-candidate.json | 5 | ~~DELETE~~ | Intermediate artifact |
| goal-check-candidate.json | 5 | ~~DELETE~~ | Intermediate artifact |
| run-evaluation-candidate.json | 5 | ~~DELETE~~ | Intermediate artifact |
| run-evaluation-events.jsonl | 5 | all-phase-summaries.json | Consolidate phases |
| validation-results.json | 6 | metadata.json.phases.validation | Consolidate |
| quality-gates.json | 6 | metadata.json.phases.quality_gates | Consolidate |
| all-phase-summaries.json | 6 | metadata.json.phases | Consolidate |
| auto-lint-cleanup.log | 6 | timings-manifest.json | Consolidate |
| pre-validation.log | 6 | validation.log | Consolidate |
| filesystem-readonly-reason.txt | 5 | metadata.json.diagnostic | Optional field |
| restoration-report.md | 5 | restoration.jsonl.text_summary | Add to JSONL |
| scouting-report.md | 3 | ~~DELETE~~ | Human-only |

### REMOVE (Score 0–4) — 55+ Artifacts 🔴

#### Tier 0: Absolute Zeros (Must Remove Immediately)

```
🔴 progress.log                               (0, Duplicate of progress.jsonl)
🔴 validation-raw.log                         (0, Duplicate of validation.log)
🔴 pre-validation-raw.log                     (0, Duplicate of pre-validation.log)
🔴 stdout.log                                 (0, Keep on failure only, 7 days)
🔴 git.diff.stats                             (4, In git.diff header)
```

#### Tier 1: Feature-Specific Duplicates (Remove Immediately)

```
🔴 scouting-stderr.log                        (1, Duplicate of stderr.log)
🔴 goal-setting-stderr.log                    (1, Duplicate of stderr.log)
🔴 goal-check-stderr.log                      (1, Duplicate of stderr.log)
🔴 run-evaluation-stderr.log                  (1, Duplicate of stderr.log)
🔴 stderr.log                                 (2, Keep on failure only, 7 days)
```

#### Tier 2: Debug Artifacts (Remove Unless Debug Flag)

```
🔴 pi-events.raw.jsonl                        (2, Only if KASEKI_DEBUG_RAW_EVENTS=1)
🔴 scouting-events.raw.jsonl                  (2, Only if KASEKI_DEBUG_RAW_EVENTS=1)
🔴 goal-setting-events.raw.jsonl              (2, Only if KASEKI_DEBUG_RAW_EVENTS=1)
🔴 goal-check-events.raw.jsonl                (2, Only if KASEKI_DEBUG_RAW_EVENTS=1)
🔴 run-evaluation-events.raw.jsonl            (2, Only if KASEKI_DEBUG_RAW_EVENTS=1)
🔴 filter-diagnostics.log                     (3, Debug noise)
🔴 last-command.log                           (3, Low value)
🔴 git.status                                 (3, Duplicate of changed-files.txt)
🔴 validation-before-state.txt                (4, Rarely useful)
🔴 validation-after-state.txt                 (4, Rarely useful)
🔴 validation-changed-files.txt               (4, Duplicate of changed-files.txt)
```

---

## 🔥 Bottom 10 in Detail

| # | Artifact | Score | Size | Issue | Fix |
|---|----------|-------|------|-------|-----|
| **1** | stdout.log | 0 | 10–100 MB | Raw noise | Keep on failure only |
| **2** | progress.log | 0 | <5 KB | Exact duplicate | Remove now |
| **3** | validation-raw.log | 0 | 5–20 KB | Exact duplicate | Remove now |
| **4** | pi-events.raw.jsonl | 2 | 50–200 MB | Debug overhead | Flag-gated only |
| **5** | scouting-stderr.log | 1 | 1–10 MB | Feature duplicate | Remove now |
| **6** | goal-setting-stderr.log | 1 | 1–10 MB | Feature duplicate | Remove now |
| **7** | goal-check-stderr.log | 1 | 1–10 MB | Feature duplicate | Remove now |
| **8** | run-evaluation-stderr.log | 1 | 1–10 MB | Feature duplicate | Remove now |
| **9** | stderr.log | 2 | 5–50 MB | Unstructured errors | Keep on failure only |
| **10** | pre-validation-raw.log | 0 | 5–20 KB | Exact duplicate | Remove now |

---

## 💾 Storage Impact by Implementation Phase

```
BASELINE (Current Setup - Debug Mode)
┌──────────────────────────────────────────┐
│ Core artifacts        │ ~5-10 MB         │
│ Agent context         │ ~50-100 MB       │
│ Logs (stdout/stderr)  │ ~10-100 MB       │
│ Debug (.raw.jsonl)    │ ~50-200 MB       │
├──────────────────────────────────────────┤
│ TOTAL PER RUN         │ ~115-410 MB      │
└──────────────────────────────────────────┘

PHASE 1 (Remove 0-score artifacts)
┌──────────────────────────────────────────┐
│ SAVINGS               │ 30 KB/run        │
│ NEW TOTAL             │ ~115-410 MB      │ (negligible)
└──────────────────────────────────────────┘

PHASE 2 (Consolidate duplicates)
┌──────────────────────────────────────────┐
│ SAVINGS               │ 40 KB/run        │
│ NEW TOTAL             │ ~115-410 MB      │ (negligible)
└──────────────────────────────────────────┘

PHASE 3 (Conditional retention)
┌──────────────────────────────────────────┐
│ SAVINGS (success)     │ 60-300 MB/run    │
│ SAVINGS (failure)     │ 0-100 MB/run     │ (keep for debug)
│ NEW TOTAL (success)   │ ~15-50 MB        │ ✅ 85% reduction
│ NEW TOTAL (failure)   │ ~115-200 MB      │ (keep for analysis)
└──────────────────────────────────────────┘

PHASE 4 (Schema versioning - no storage change)
```

---

## 🎬 Implementation Quick Start

### Week 1: Phase 1 (Remove 0-Score)

```bash
# Files to modify:
kaseki-agent.sh                    # Remove progress.log, validation-raw.log, pre-validation-raw.log
Feature agent scripts              # Remove feature-specific .stderr.log files

# Expected change:
- 7 artifacts removed
- 30-50 KB savings per run
```

### Week 2: Phase 2 (Consolidate)

```bash
# Files to modify:
kaseki-agent.sh                    # Migrate secret-scan.log, quality.log
src/kaseki-report.js               # Update paths for consolidated artifacts
Feature agent scripts              # Update stderr handling

# Expected change:
- 8-10 artifacts consolidated
- 40 KB additional savings per run
```

### Week 3: Phase 3 (Conditional Retention)

```bash
# Files to modify:
kaseki-agent.sh                    # Add conditional stdout.log, stderr.log
pi-event-filter.ts                 # Add KASEKI_DEBUG_RAW_EVENTS flag
scripts/cleanup.sh                 # Auto-delete old logs

# Expected change:
- 60-300 MB savings on success
- Debug capability preserved
```

### Week 4: Phase 4 (Schema Versioning)

```bash
# Files to create:
docs/ARTIFACT_SCHEMAS.md           # OpenAPI specs
docs/ARTIFACT_SCHEMAS.json         # JSON Schema definitions

# Files to update:
CLAUDE.md                          # New artifact inventory
docs/DEVELOPMENT.md                # Artifact requirements
```

---

## ✅ Verification Checklist

- [ ] All 105+ artifacts scored using 5-dimensional rubric
- [ ] Bottom 10 identified and rationale provided
- [ ] Segment breakdown validated (Keep/Merge/Remove)
- [ ] Storage impact calculated per phase
- [ ] Implementation roadmap created
- [ ] No breaking changes in Phases 1–3
- [ ] Backward compatibility maintained
- [ ] Documentation updated
- [ ] Monitoring setup for artifact changes

---

## 📚 Full Documentation

- **[ARTIFACT_SCORING_EVALUATION.md](docs/ARTIFACT_SCORING_EVALUATION.md)** — Complete 5-dimensional scoring for all artifacts
- **[ARTIFACT_EVALUATION_ACTION_PLAN.md](docs/ARTIFACT_EVALUATION_ACTION_PLAN.md)** — Implementation roadmap with cost-benefit analysis
- This guide — Quick reference for scoring distribution and next steps

---

## 🔗 Files Affected

**Phase 1 (Immediate)**:

- [kaseki-agent.sh](kaseki-agent.sh)
- Feature agent scripts (scouting, goal-check, etc.)

**Phase 2 (Consolidation)**:

- [kaseki-agent.sh](kaseki-agent.sh)
- [src/kaseki-report.js](src/kaseki-report.js)
- Feature agent scripts

**Phase 3 (Conditional)**:

- [kaseki-agent.sh](kaseki-agent.sh)
- [pi-event-filter.ts](src/pi-event-filter.ts)
- [scripts/cleanup.sh](scripts/cleanup.sh) (new logic)

**Phase 4 (Documentation)**:

- [CLAUDE.md](CLAUDE.md)
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- [docs/ARTIFACT_SCHEMAS.md](docs/ARTIFACT_SCHEMAS.md) (new)

---

## 📊 At a Glance: The Numbers

| Metric | Value |
|--------|-------|
| **Total artifacts** | 105+ |
| **Keep (≥8)** | 30 artifacts (28%) |
| **Merge (5–7)** | 20 artifacts (19%) |
| **Remove (≤4)** | 55+ artifacts (53%) |
| **Perfect score (10)** | 12 artifacts |
| **Lowest score** | 0 (7 artifacts) |
| **Phase 1 savings** | 30 KB per run |
| **Phase 3 savings** | 60–300 MB per run (success) |
| **Total storage reduction** | **45–50% fewer artifacts** |
| **Complexity reduction** | **50–60% fewer files per run** |
| **Breaking changes** | **0** (fully backward compatible) |
