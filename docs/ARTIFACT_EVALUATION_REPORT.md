# Kaseki Agent Artifacts - Comprehensive Evaluation Report

**Generated**: 2026-06-10  
**Scope**: All 48 artifacts from ARTIFACT_METADATA_REGISTRY  
**Evaluation Method**: 5-dimension rubric (0–2 per dimension, total 0–10)

---

## Executive Summary

- **Total artifacts evaluated**: 48
- **KEEP (≥8)**: 18 artifacts (37.5%)
- **MERGE/REFACTOR (5–7)**: 15 artifacts (31.3%)
- **REMOVE/SHORT-RETAIN (≤4)**: 15 artifacts (31.3%)
- **Average score**: 6.2/10
- **Highest scoring**: metadata.json, pi-events.jsonl, failure.json, git.diff (9/10 each)
- **Lowest scoring**: scouting-events.raw.jsonl, format-check-command.txt, last-command.log (1–2/10)

### Key Insights

1. **Core artifacts (metadata, pi-events, failure, git) are highly valuable** — decisive for agents, structured, unique, low-cost
2. **Phase-specific diagnostics show redundancy** — Multiple *-stderr.log, *-events.jsonl, *-summary.json files have overlapping purposes
3. **Timing/validation logs could consolidate** — 4 separate TSV timing files, multiple validation log variants (raw, baseline, etc.)
4. **Intermediate/diagnostic artifacts are low-value** — raw event files, candidate.json files, format-check-command.txt, last-command.log
5. **Validation baseline artifacts are conditionally valuable** — Only useful when enabled; consider SHORT-RETAIN or consolidate into one artifact
6. **Summary consolidation opportunity** — All phase summaries have identical structure; could merge into `all-phase-summaries.json`

---

## Detailed Artifact Scores

### Legend
| Column | Meaning |
|--------|---------|
| D1 | Agent decision value (0–2) |
| D2 | Machine readability (0–2) |
| D3 | Uniqueness (0–2) |
| D4 | Recovery usefulness (0–2) |
| D5 | Cost/risk burden (0–2) |
| Tot | Total score (0–10) |
| Seg | Segment (KEEP, MERGE, REMOVE) |
| Action | Recommended action |

### Table: All Artifacts Ranked by Score

| # | Artifact | D1 | D2 | D3 | D4 | D5 | Tot | Avail | Size | Seg | Action | Merge/Notes |
|---|----------|----|----|----|----|----|----|-------|------|-----|--------|-------------|
| 1 | metadata.json | 2 | 2 | 2 | 2 | 1 | **9** | ALWAYS | S | KEEP | KEEP_CORE | Essential; contains all stage exit codes, timestamps, failure classification |
| 2 | pi-events.jsonl | 2 | 2 | 2 | 2 | 1 | **9** | ALWAYS | L | KEEP | KEEP_CORE | Full agent reasoning; directly helps external agents decide; foundational |
| 3 | failure.json | 2 | 2 | 2 | 2 | 1 | **9** | ON_FAIL | S | KEEP | KEEP_CORE | Structured failure classification; critical for retry logic |
| 4 | git.diff | 2 | 1 | 2 | 2 | 2 | **9** | COND | L | KEEP | KEEP_CORE | Unified diff essential for agent impact analysis; mostly plain-text but well-structured |
| 5 | result-summary.md | 2 | 1 | 2 | 2 | 2 | **9** | COND | S | KEEP | KEEP_CORE | Human-readable executive summary; agents consume for quick triage |
| 6 | validation.log | 2 | 1 | 2 | 2 | 1 | **8** | COND | M | KEEP | KEEP_FOR_AGENT_CONTEXT | Command output essential for diagnosing validation failures; unstructured but reliable |
| 7 | pi-summary.json | 2 | 2 | 1 | 1 | 2 | **8** | ALWAYS | S | KEEP | KEEP_CORE | Token counts, model info; agents use for cost analysis and model selection |
| 8 | quality.log | 2 | 1 | 2 | 2 | 1 | **8** | ON_FAIL | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Quality gate decisions; helps agents understand why run failed |
| 9 | changed-files.txt | 2 | 2 | 2 | 1 | 2 | **9** | COND | S | KEEP | KEEP_CORE | File list essential; structured, unique, cheap |
| 10 | progress.jsonl | 2 | 2 | 1 | 1 | 2 | **8** | ALWAYS | M | KEEP | KEEP_FOR_AGENT_CONTEXT | Stage progress; agents use to detect timeout risk and completion |
| 11 | exit_code | 2 | 2 | 2 | 1 | 2 | **9** | ALWAYS | S | KEEP | KEEP_CORE | Machine-readable final status; required by all consumers |
| 12 | secret-scan.log | 2 | 1 | 2 | 1 | 2 | **8** | ALWAYS | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Credential detection; must retain for security audit; unstructured OK |
| 13 | secret-scan.json | 2 | 2 | 1 | 1 | 2 | **8** | ALWAYS | S | KEEP | KEEP_CORE | Structured secret scan; complements .log version |
| 14 | restoration.jsonl | 2 | 2 | 2 | 1 | 2 | **9** | COND | S | KEEP | KEEP_CORE | Allowlist restoration events; structured, decisive for allowlist debugging |
| 15 | goal-check.json | 2 | 2 | 1 | 2 | 2 | **9** | COND | S | KEEP | KEEP_CORE | Post-validation verdict; agent decision point (met: true/false) |
| 16 | run-evaluation.json | 2 | 2 | 1 | 2 | 2 | **9** | COND | S | KEEP | KEEP_CORE | Final task-agnostic assessment; reviewer confidence and improvement recs |
| 17 | goal-setting.json | 2 | 2 | 1 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Pre-coding goal refinement; helps agents understand task evolution |
| 18 | scouting.json | 2 | 2 | 1 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Read-only reconnaissance; agents use for task planning |
| 19 | validation-results.json | 1 | 2 | 1 | 1 | 2 | **7** | COND | S | MERGE | MERGE_INTO_VALIDATION_MANIFEST | Structured validation results; duplicate of validation.log in JSON form |
| 20 | goal-check-attempts.jsonl | 1 | 2 | 2 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Retry history; helps agents understand coding attempt progression |
| 21 | cache-metrics.json | 1 | 2 | 2 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Dependency cache stats; helps optimize future runs |
| 22 | quality-gates.json | 2 | 2 | 1 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Structured quality gate violations; complements quality.log |
| 23 | all-phase-summaries.json | 1 | 2 | 2 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Consolidation artifact; avoids parsing multiple *-summary.json files |
| 24 | timings-manifest.json | 1 | 2 | 2 | 1 | 2 | **8** | COND | S | KEEP | KEEP_FOR_AGENT_CONTEXT | Consolidation artifact; unifies all timing data |
| 25 | goal-check-events.jsonl | 1 | 2 | 1 | 1 | 1 | **6** | COND | L | MERGE | MERGE_INTO_PI_EVENTS_MANIFEST | Phase-specific events; limited unique value over pi-events.jsonl |
| 26 | run-evaluation-events.jsonl | 1 | 2 | 1 | 1 | 1 | **6** | COND | L | MERGE | MERGE_INTO_PI_EVENTS_MANIFEST | Phase-specific events; duplicates pi-events.jsonl structure |
| 27 | scouting-events.jsonl | 1 | 2 | 1 | 1 | 1 | **6** | COND | L | MERGE | MERGE_INTO_PI_EVENTS_MANIFEST | Phase-specific events; limited unique value |
| 28 | goal-setting-events.jsonl | 1 | 2 | 1 | 1 | 1 | **6** | COND | L | MERGE | MERGE_INTO_PI_EVENTS_MANIFEST | Phase-specific events; redundant to pi-events.jsonl |
| 29 | goal-check-summary.json | 1 | 2 | 0 | 0 | 2 | **5** | COND | S | MERGE | MERGE_INTO_ALL_PHASE_SUMMARIES.JSON | Identical structure to pi-summary.json; no unique fields |
| 30 | run-evaluation-summary.json | 1 | 2 | 0 | 0 | 2 | **5** | COND | S | MERGE | MERGE_INTO_ALL_PHASE_SUMMARIES.JSON | Identical structure to pi-summary.json; no unique fields |
| 31 | scouting-summary.json | 1 | 2 | 0 | 0 | 2 | **5** | COND | S | MERGE | MERGE_INTO_ALL_PHASE_SUMMARIES.JSON | Identical structure to pi-summary.json; no unique fields |
| 32 | goal-setting-summary.json | 1 | 2 | 0 | 0 | 2 | **5** | COND | S | MERGE | MERGE_INTO_ALL_PHASE_SUMMARIES.JSON | Identical structure to pi-summary.json; no unique fields |
| 33 | validation-timings.tsv | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_TIMINGS_MANIFEST.JSON | Redundant to timings-manifest.json; TSV format less machine-friendly |
| 34 | pre-validation-timings.tsv | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_TIMINGS_MANIFEST.JSON | Redundant to timings-manifest.json; TSV format less machine-friendly |
| 35 | stage-timings.tsv | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_TIMINGS_MANIFEST.JSON | Redundant to timings-manifest.json; TSV format less machine-friendly |
| 36 | goal-check-stderr.log | 1 | 0 | 1 | 0 | 1 | **3** | COND | M | MERGE | MERGE_INTO_PHASE_ERRORS.JSONL | Unstructured stderr; phase-specific; low recovery value |
| 37 | goal-setting-stderr.log | 1 | 0 | 1 | 0 | 1 | **3** | COND | M | MERGE | MERGE_INTO_PHASE_ERRORS.JSONL | Unstructured stderr; phase-specific; low recovery value |
| 38 | run-evaluation-stderr.log | 1 | 0 | 1 | 0 | 1 | **3** | COND | M | MERGE | MERGE_INTO_PHASE_ERRORS.JSONL | Unstructured stderr; phase-specific; low recovery value |
| 39 | scouting-stderr.log | 1 | 0 | 1 | 0 | 1 | **3** | COND | M | MERGE | MERGE_INTO_PHASE_ERRORS.JSONL | Unstructured stderr; phase-specific; low recovery value |
| 40 | goal-check-validation-errors.jsonl | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL | Phase-specific validation errors; redundant to artifact-validation-errors.jsonl |
| 41 | goal-setting-validation-errors.jsonl | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL | Phase-specific validation errors; redundant to artifact-validation-errors.jsonl |
| 42 | scouting-validation-errors.jsonl | 1 | 2 | 1 | 0 | 1 | **5** | COND | S | MERGE | MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL | Phase-specific validation errors; redundant to artifact-validation-errors.jsonl |
| 43 | phase-errors.jsonl | 0 | 2 | 1 | 0 | 1 | **4** | COND | S | REMOVE | REMOVE_OR_SHORT_RETAIN | Consolidation placeholder; rarely consumed; not yet generated |
| 44 | artifact-validation-errors.jsonl | 1 | 2 | 1 | 0 | 2 | **6** | COND | S | MERGE | MERGE_INTO_QUALITY_GATES.JSON | Validation errors; low decision value; consolidate into quality gates |
| 45 | inspect-report.md | 1 | 1 | 2 | 1 | 2 | **7** | COND | M | KEEP_ON_FAILURE | KEEP_ON_FAILURE | Inspect mode only; niche use case; moderate value when enabled |
| 46 | goal-setting-metrics.json | 0 | 2 | 2 | 0 | 2 | **6** | ALWAYS | S | MERGE | MERGE_INTO_TIMINGS_MANIFEST.JSON | Phase timing metrics; consolidate into unified timing manifest |
| 47 | stdout.log | 1 | 0 | 1 | 1 | 0 | **3** | ON_FAIL | L | KEEP_ON_FAILURE | KEEP_ON_FAILURE | Large, unstructured; essential for debugging on failures only |
| 48 | stderr.log | 1 | 0 | 1 | 1 | 0 | **3** | ON_FAIL | M | KEEP_ON_FAILURE | KEEP_ON_FAILURE | Large, unstructured; essential for debugging on failures only |

---

## Missing Artifacts (Not in Current Registry but Mentioned in Inventory)

The following artifacts are mentioned in the inventory but missing from src/artifact-metadata.ts:

| Artifact | Status | Notes |
|----------|--------|-------|
| result-summary.md | Missing | Should be KEEP_CORE (score ~9) |
| progress.log | Missing | Text version of progress.jsonl; currently only .jsonl tracked |
| pre-validation.log | Missing | Should be KEEP_FOR_AGENT_CONTEXT |
| auto-lint-cleanup.log | Missing | Post-agent cleanup; moderate value |
| auto-lint-cleanup-timings.tsv | Missing | Should merge into timings-manifest.json |
| test-impact-warnings.log | Missing | Test analysis; conditional value |
| test-baseline-comparison.json | Missing | Structured test failure classification; KEEP_CORE when available |
| critical-change-expectations.json | Missing | From goal-setting phase; KEEP_FOR_AGENT_CONTEXT |
| critical-change-verification.log | Missing | Change verification; KEEP_ON_FAILURE |
| expectation-mismatch-warnings.jsonl | Missing | Diagnostic artifact; KEEP_ON_FAILURE |
| last-command.log | Missing | Emergency debugging; rarely used; REMOVE |
| format-check-command.txt | Missing | Development artifact; REMOVE |
| filesystem-readonly-reason.txt | Missing | Scouting error context; KEEP_ON_FAILURE (small) |
| git.status | Missing | Should be KEEP_FOR_AGENT_CONTEXT (changes before/after) |
| validation-before-state.txt | Missing | Should be KEEP_ON_FAILURE |
| validation-after-state.txt | Missing | Should be KEEP_ON_FAILURE |
| validation-changed-files.txt | Missing | Should be KEEP_FOR_AGENT_CONTEXT |
| git-push.log | Missing | GitHub operations; KEEP_ON_FAILURE when enabled |

---

## Segmentation Summary

### KEEP Segment (Score ≥8, 18 artifacts)

**Essential for all agents. Always include in API/CLI triage.**

1. **metadata.json** (9/10) — KEEP_CORE
2. **pi-events.jsonl** (9/10) — KEEP_CORE
3. **failure.json** (9/10) — KEEP_CORE
4. **git.diff** (9/10) — KEEP_CORE
5. **result-summary.md** (9/10) — KEEP_CORE [MISSING from registry]
6. **changed-files.txt** (9/10) — KEEP_CORE
7. **exit_code** (9/10) — KEEP_CORE
8. **goal-check.json** (9/10) — KEEP_CORE
9. **run-evaluation.json** (9/10) — KEEP_CORE
10. **restoration.jsonl** (9/10) — KEEP_CORE
11. **validation.log** (8/10) — KEEP_FOR_AGENT_CONTEXT
12. **pi-summary.json** (8/10) — KEEP_CORE
13. **quality.log** (8/10) — KEEP_FOR_AGENT_CONTEXT
14. **progress.jsonl** (8/10) — KEEP_FOR_AGENT_CONTEXT
15. **secret-scan.log** (8/10) — KEEP_FOR_AGENT_CONTEXT
16. **secret-scan.json** (8/10) — KEEP_CORE
17. **goal-setting.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
18. **scouting.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
19. **goal-check-attempts.jsonl** (8/10) — KEEP_FOR_AGENT_CONTEXT
20. **cache-metrics.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
21. **quality-gates.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
22. **all-phase-summaries.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
23. **timings-manifest.json** (8/10) — KEEP_FOR_AGENT_CONTEXT
24. **inspect-report.md** (7/10) — KEEP_ON_FAILURE

### MERGE/REFACTOR Segment (Score 5–7, 15 artifacts)

**Consolidate or rename. Significant overlap with other artifacts.**

#### Phase-specific event files → `pi-events-by-phase.jsonl` or keep as metadata supplement

- **goal-check-events.jsonl** (6/10) → MERGE_INTO_PI_EVENTS_MANIFEST
- **run-evaluation-events.jsonl** (6/10) → MERGE_INTO_PI_EVENTS_MANIFEST
- **scouting-events.jsonl** (6/10) → MERGE_INTO_PI_EVENTS_MANIFEST
- **goal-setting-events.jsonl** (6/10) → MERGE_INTO_PI_EVENTS_MANIFEST

**Rationale**: These duplicate pi-events.jsonl structure. Consider: (a) keep only pi-events.jsonl with phase metadata added, or (b) keep as supplementary detail for agents that need phase isolation. Recommend (b) with deprecation warning: mark as "LOW_PRIORITY_OPTIONAL" in API.

#### Phase-specific summary files → `all-phase-summaries.json` (DONE)

- **goal-check-summary.json** (5/10) → MERGE_INTO_ALL_PHASE_SUMMARIES.JSON
- **run-evaluation-summary.json** (5/10) → MERGE_INTO_ALL_PHASE_SUMMARIES.JSON
- **scouting-summary.json** (5/10) → MERGE_INTO_ALL_PHASE_SUMMARIES.JSON
- **goal-setting-summary.json** (5/10) → MERGE_INTO_ALL_PHASE_SUMMARIES.JSON

**Rationale**: All have identical structure (model, tokens, duration). Already consolidated in registry; deprecate individual files in favor of all-phase-summaries.json.

#### Timing files → `timings-manifest.json` (DONE)

- **validation-timings.tsv** (5/10) → MERGE_INTO_TIMINGS_MANIFEST.JSON
- **pre-validation-timings.tsv** (5/10) → MERGE_INTO_TIMINGS_MANIFEST.JSON
- **stage-timings.tsv** (5/10) → MERGE_INTO_TIMINGS_MANIFEST.JSON

**Rationale**: All timing data could be unified into timings-manifest.json. TSV format less machine-friendly than JSON. Recommend keeping JSON manifest; deprecate .tsv files.

#### Validation errors → `quality-gates.json` or `artifact-validation-errors.jsonl` (CONSOLIDATION)

- **goal-check-validation-errors.jsonl** (5/10) → MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL
- **goal-setting-validation-errors.jsonl** (5/10) → MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL
- **scouting-validation-errors.jsonl** (5/10) → MERGE_INTO_ARTIFACT_VALIDATION_ERRORS.JSONL

**Rationale**: Phase-specific validation errors should roll up into artifact-validation-errors.jsonl.

#### Structured validation results

- **validation-results.json** (7/10) → MERGE_INTO_VALIDATION_MANIFEST

**Rationale**: Duplicate of validation.log (JSON vs. text). Consolidate into unified validation manifest with both JSON + TSV representations.

#### Artifact validation errors

- **artifact-validation-errors.jsonl** (6/10) → MERGE_INTO_QUALITY_GATES.JSON

**Rationale**: Low decision value on its own; consolidate into quality-gates.json (array of violations with type/detail/severity).

#### Phase metrics

- **goal-setting-metrics.json** (6/10) → MERGE_INTO_TIMINGS_MANIFEST.JSON

**Rationale**: Phase timing and retry metrics should merge into unified timings-manifest.json.

### REMOVE/SHORT-RETAIN Segment (Score ≤4, 15 artifacts)

**Deprecate or retain only on failure. Low value; consider deletion or conditional generation.**

#### Currently Not Generated / Placeholder Artifacts

1. **phase-errors.jsonl** (4/10) — REMOVE
   - **Reason**: Placeholder for consolidation; not yet generated; no real demand
   - **Action**: Remove from registry; re-add only if stderr consolidation becomes necessary

#### Unstructured Phase Diagnostics (Deprecate in favor of phase-errors.jsonl or remove)

2. **goal-check-stderr.log** (3/10) — REMOVE
3. **goal-setting-stderr.log** (3/10) — REMOVE
4. **run-evaluation-stderr.log** (3/10) — REMOVE
5. **scouting-stderr.log** (3/10) — REMOVE

**Reason**: Unstructured text; low recovery value; duplicate of main pi stderr. Could consolidate into phase-errors.jsonl, but rarely used.

**Action**: (Option A) Consolidate into phase-errors.jsonl on-failure only, OR (Option B) remove entirely (stderr is captured in stdout.log anyway).

#### Container Logs (Retain ON_FAILURE only)

6. **stdout.log** (3/10) — KEEP_ON_FAILURE
7. **stderr.log** (3/10) — KEEP_ON_FAILURE

**Reason**: Large, unstructured, noisy. But essential for post-mortem debugging. Keep generation only when run fails.

**Action**: Mark as ON_FAILURE in API; don't list in success case.

#### Missing from Registry (Should be scored)

From inventory, these artifacts should be scored too if implemented:

- **last-command.log** (~1/10) — REMOVE
  - Emergency debugging only; rarely useful
  - Action: Remove
  
- **format-check-command.txt** (~2/10) — REMOVE
  - Development artifact; edge case only
  - Action: Remove

- **scouting-events.raw.jsonl** (~3/10) — REMOVE_OR_SHORT_RETAIN
  - Fallback debug artifact (only if event filtering fails)
  - Action: Short-retain (keep on failure only, auto-delete on success)

---

## Bottom 10 Lowest-Value Artifacts

Scored from lowest to highest within the bottom 10:

| Rank | Artifact | Score | Reason | Current Consumption | Recommended Action |
|------|----------|-------|--------|---------------------|-------------------|
| **1** | phase-errors.jsonl | 4/10 | Placeholder; not generated; low decision value; consolidation candidate | None (not generated) | **REMOVE** from registry; re-add only if real demand |
| **2** | goal-check-stderr.log | 3/10 | Unstructured stderr; phase-specific; low recovery value; duplicates pi output | Rarely consumed; primarily for debugging | **REMOVE** or consolidate into phase-errors.jsonl |
| **3** | goal-setting-stderr.log | 3/10 | Unstructured stderr; phase-specific; low recovery value; duplicates pi output | Rarely consumed; primarily for debugging | **REMOVE** or consolidate into phase-errors.jsonl |
| **4** | run-evaluation-stderr.log | 3/10 | Unstructured stderr; phase-specific; low recovery value; duplicates pi output | Rarely consumed; primarily for debugging | **REMOVE** or consolidate into phase-errors.jsonl |
| **5** | scouting-stderr.log | 3/10 | Unstructured stderr; phase-specific; low recovery value; duplicates pi output | Rarely consumed; primarily for debugging | **REMOVE** or consolidate into phase-errors.jsonl |
| **6** | stdout.log | 3/10 | Large, unstructured container output; noisy; low machine readability | Essential for emergency debugging but rarely used by agents | **KEEP_ON_FAILURE** only (don't generate on success) |
| **7** | stderr.log | 3/10 | Large, unstructured container output; noisy; low machine readability | Essential for emergency debugging but rarely used by agents | **KEEP_ON_FAILURE** only (don't generate on success) |
| **8** | artifact-validation-errors.jsonl | 6/10 | Duplicates phase-specific validation errors; low decision value; should merge into quality-gates.json | Consumed by API but limited agent use | **MERGE_INTO_QUALITY_GATES.JSON**; keep as backward-compat view |
| **9** | goal-setting-metrics.json | 6/10 | Phase timing metrics; should consolidate into timings-manifest.json; redundant to cache-metrics.json | Rarely consumed independently | **MERGE_INTO_TIMINGS_MANIFEST.JSON** |
| **10** | validation-results.json | 7/10 | Structured validation results; duplicates validation.log; JSON vs. text format | Consumed by API but lower priority than validation.log | **MERGE_INTO_VALIDATION_MANIFEST** (unified schema) |

---

## Implementation Roadmap

### Phase 1: Update Registry (artifact-metadata.ts)
- [x] Add missing high-value artifacts: result-summary.md, test-baseline-comparison.json, git.status, validation-before-state.txt
- [ ] Mark phase-specific stderr.log files as ON_FAILURE (don't generate on success)
- [ ] Mark stdout.log, stderr.log as ON_FAILURE only
- [ ] Deprecate individual *-summary.json files (scouting, goal-setting, goal-check, run-evaluation) in favor of all-phase-summaries.json
- [ ] Deprecate individual timing TSVs in favor of timings-manifest.json
- [ ] Deprecate individual phase-specific *-events.jsonl files (or mark as LOW_PRIORITY_OPTIONAL)

### Phase 2: Remove Placeholder / Rarely-Used Artifacts
- [ ] Remove phase-errors.jsonl from registry (not generated; placeholder)
- [ ] Remove last-command.log (if it exists; rarely used)
- [ ] Remove format-check-command.txt (if it exists; development-only)
- [ ] Mark scouting-events.raw.jsonl as SHORT_RETAIN_ON_FAILURE

### Phase 3: Consolidation (Artifact Generation)
Update kaseki-agent.sh to:
- [ ] Generate all-phase-summaries.json instead of individual *-summary.json files
- [ ] Generate timings-manifest.json instead of individual *-timings.tsv files
- [ ] Consolidate phase-specific stderr into phase-errors.jsonl (or remove)
- [ ] Stop generating phase-specific *-events.jsonl files (or keep as optional, conditionally)

### Phase 4: API/CLI Updates
Update artifact routes and CLI to:
- [ ] Recommend KEEP_CORE artifacts first (metadata, pi-events, failure, exit_code, etc.)
- [ ] Show KEEP_FOR_AGENT_CONTEXT as secondary tier
- [ ] Mark REMOVE/SHORT_RETAIN artifacts with "deprecated" or "debug-only" labels
- [ ] Add backward-compatibility aliases (e.g., scouting-summary.json → all-phase-summaries.json#scouting)

### Phase 5: Testing & Validation
- [ ] Update artifact-utilities tests
- [ ] Update artifact-metadata tests
- [ ] Integration test: verify no breaking changes for external agents
- [ ] Performance test: confirm storage reduction from consolidation

---

## Consolidation Details

### Consolidation 1: Phase-Specific Summary Files → `all-phase-summaries.json`

**Current State**: 4 separate JSON files (scouting-summary, goal-setting-summary, goal-check-summary, run-evaluation-summary)  
**Target**: Single `all-phase-summaries.json` with phase keys

**Schema**:
```json
{
  "goal_setting": {
    "model": "...",
    "input_tokens": 100,
    "output_tokens": 50,
    "thinking_time_ms": 1000,
    "timestamp": "...",
    "duration_ms": 5000
  },
  "scouting": { /* same */ },
  "main_pi": { /* same */ },
  "goal_check": { /* same */ },
  "run_evaluation": { /* same */ }
}
```

**Migration**: Generate all-phase-summaries.json; mark individual files as deprecated but keep for 1 release.

---

### Consolidation 2: Timing Files → `timings-manifest.json`

**Current State**: 3 TSV files + goal-setting-metrics.json  
**Target**: Unified JSON manifest

**Schema**:
```json
{
  "validation_pre": [
    { "command": "npm test", "start_ms": 100, "end_ms": 200, "elapsed_ms": 100 }
  ],
  "validation_post": [ /* same */ ],
  "stages": [
    { "stage": "clone", "start_ms": 0, "end_ms": 50, "elapsed_ms": 50 }
  ],
  "phase_metrics": {
    "goal_setting": { "duration_ms": 5000, "retry_count": 0 },
    "scouting": { "duration_ms": 3000, "retry_count": 0 }
  }
}
```

**Migration**: Generate timings-manifest.json; deprecate .tsv files.

---

### Consolidation 3: Phase-Specific Validation Errors → `artifact-validation-errors.jsonl`

**Current State**: 3 separate JSONL files (scouting, goal-setting, goal-check)  
**Target**: Merge into artifact-validation-errors.jsonl

**Schema**:
```jsonl
{ "phase": "scouting", "field": "observations", "expected": "array", "actual": "string", "severity": "critical" }
{ "phase": "goal-check", "field": "met", "expected": "boolean", "actual": "string", "severity": "critical" }
```

---

### Consolidation 4: Phase-Specific Stderr → `phase-errors.jsonl` (Optional)

**Current State**: 4 separate .log files (scouting, goal-setting, goal-check, run-eval)  
**Target**: Consolidate into phase-errors.jsonl OR remove entirely

**Decision**: REMOVE (low value; stderr already in stdout.log; can be reconstructed from pi-events.jsonl)

---

### Consolidation 5: Missing High-Value Artifacts

**Add to registry**:
- `result-summary.md` — Already generated; should be in registry (KEEP_CORE, 9/10)
- `test-baseline-comparison.json` — Generated when baseline available (KEEP_FOR_AGENT_CONTEXT, 8/10)
- `git.status` — Git status output before/after (KEEP_FOR_AGENT_CONTEXT, 7/10)
- `pre-validation.log` — Pre-agent validation baseline (KEEP_FOR_AGENT_CONTEXT, 7/10)
- `critical-change-expectations.json` — From goal-setting (KEEP_FOR_AGENT_CONTEXT, 8/10)

---

## Impact on External Agents

### Breaking Changes (If Consolidated)

1. **Agents relying on scouting-summary.json** — Now at all-phase-summaries.json#scouting
   - **Mitigation**: Provide backward-compat alias or two-release deprecation window

2. **Agents relying on validation-timings.tsv** — Now at timings-manifest.json
   - **Mitigation**: Keep .tsv as read-only alias; generate from JSON manifest

3. **Agents consuming phase-specific events separately** — Recommend consolidation but mark as LOW_PRIORITY
   - **Mitigation**: Keep optional; mark in API response

### Non-Breaking Changes

1. Removing stdout.log/stderr.log on success — Agents already handle missing artifacts
2. Removing phase-specific stderr.log — Not widely consumed
3. Marking artifacts as ON_FAILURE — Agents check availability via API metadata

---

## Recommendations

### Immediate Actions (High Confidence)

1. **Add missing high-value artifacts to registry**
   - result-summary.md, test-baseline-comparison.json, git.status, pre-validation.log, critical-change-expectations.json
   - Expected gain: +2 KEEP_CORE, +3 KEEP_FOR_AGENT_CONTEXT

2. **Consolidate phase-specific summaries → all-phase-summaries.json**
   - Deprecate 4 separate files; save 3 artifacts
   - No breaking changes; already consolidated in registry

3. **Consolidate timing data → timings-manifest.json**
   - Deprecate 3 TSV files; save storage and parsing complexity
   - Provide backward-compat .tsv generation from JSON

4. **Mark container logs (stdout, stderr) as ON_FAILURE**
   - Don't generate on success; save storage (~1-5 MB per run)
   - No breaking changes; agents check availability

### Medium Confidence Actions

5. **Remove phase-specific stderr files**
   - goal-check-stderr.log, goal-setting-stderr.log, run-evaluation-stderr.log, scouting-stderr.log
   - Rarely consumed; stderr data in stdout.log or pi-events.jsonl
   - Save 4 files per run

6. **Consolidate phase-specific *-events.jsonl (CONDITIONAL)**
   - Mark as LOW_PRIORITY_OPTIONAL; keep pi-events.jsonl only or with phase metadata
   - OR keep for now; mark for future consolidation
   - Decision: Require feedback from external agent teams

### Lower Confidence / Future Actions

7. **Remove artifact-validation-errors.jsonl** (merge into quality-gates.json)
   - Low decision value; complex refactoring
   - Decision: Defer; gather more usage data first

8. **Remove rarely-used artifacts**
   - phase-errors.jsonl (placeholder; not used)
   - last-command.log (emergency debugging only)
   - format-check-command.txt (development)
   - Decision: Safe to remove; confirm no external dependencies

---

## Risks & Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| External agents break on consolidation | HIGH | 1-release deprecation window; backward-compat aliases; test with major consumers |
| Removing stderr artifacts breaks debugging | MED | Keep on ON_FAILURE; stderr in stdout.log; can re-enable if needed |
| Timing consolidation loses TSV format | LOW | Generate .tsv from JSON manifest; publish both |
| Missing high-value artifacts from registry | MED | Add immediately (result-summary.md, test-baseline, etc.) |

---

## Success Metrics

After implementation:

1. **Registry consistency**: All generated artifacts in ARTIFACT_METADATA_REGISTRY (100%)
2. **Storage reduction**: Phase summaries (-50%), timing files (-40%), conditional logs on success (-30%)
3. **Agent decision latency**: <100ms to identify top-5 triage artifacts (sorted by triageOrder)
4. **Zero breaking changes**: External agent tests pass without modification (or with aliasing)
5. **Consolidation completeness**: All duplicates merged; no file overload (currently 48 artifacts → ~35 after merge)

---

## Conclusion

**Current state**: 48 artifacts with significant redundancy and missing high-value items.

**Key findings**:
- 18 artifacts (37.5%) are high-value (≥8/10) — keep and prioritize in API
- 15 artifacts (31.3%) are medium-value (5–7/10) — consolidate into 6–8 unified artifacts
- 15 artifacts (31.3%) are low-value (≤4/10) — remove or short-retain

**Expected consolidation**: 48 → 35 artifacts (-27% file count) with same information coverage.

**Effort**: 3–4 weeks (Phase 1: registry update, Phase 2–3: code changes, Phase 4: testing).

**ROI**: Reduced storage, faster triage, clearer API surface, fewer downstream agent breaking changes.
