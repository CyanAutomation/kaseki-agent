# Artifact Evaluation - Quick Summary

**Date**: 2026-06-10  
**Total Artifacts Evaluated**: 48 registered + 18 missing from registry  
**Average Score**: 6.2/10

---

## Segmentation at a Glance

| Segment | Count | Score | Recommendation |
|---------|-------|-------|-----------------|
| **KEEP** | 24 | ≥7/10 | Always include; prioritize in API |
| **MERGE** | 15 | 5–7/10 | Consolidate; reduce artifact count |
| **REMOVE** | 9 | ≤4/10 | Delete or conditional generation |
| **Missing from Registry** | 18 | ~7–9/10 | Add immediately |

---

## Top 10 Highest-Value Artifacts (KEEP_CORE)

| # | Artifact | Score | Why |
|---|----------|-------|-----|
| 1 | metadata.json | 9/10 | Complete run record; all stages; timestamps; exit codes |
| 2 | pi-events.jsonl | 9/10 | Full agent reasoning; foundational for external agents |
| 3 | failure.json | 9/10 | Structured failure classification; critical for retry |
| 4 | git.diff | 9/10 | Impact analysis; essential for understanding changes |
| 5 | result-summary.md | 9/10 | Human/AI readable summary; quick triage |
| 6 | changed-files.txt | 9/10 | File list; structured; unique; cheap |
| 7 | exit_code | 9/10 | Machine-readable status; required |
| 8 | goal-check.json | 9/10 | Post-validation verdict; decision point |
| 9 | run-evaluation.json | 9/10 | Final assessment; reviewer confidence |
| 10 | restoration.jsonl | 9/10 | Allowlist decisions; structured; decisive |

---

## Bottom 10 Lowest-Value Artifacts (REMOVE or MERGE)

| # | Artifact | Score | Action |
|---|----------|-------|--------|
| 1 | phase-errors.jsonl | 4/10 | REMOVE (placeholder; not generated) |
| 2–5 | goal-check/setting/run-eval/scouting-stderr.log | 3/10 each | REMOVE or consolidate |
| 6–7 | stdout.log, stderr.log | 3/10 each | KEEP_ON_FAILURE only (don't generate on success) |
| 8 | artifact-validation-errors.jsonl | 6/10 | MERGE into quality-gates.json |
| 9 | goal-setting-metrics.json | 6/10 | MERGE into timings-manifest.json |
| 10 | validation-results.json | 7/10 | MERGE into validation-manifest |

---

## Quick Wins (Immediate Actions)

### 1. Add Missing High-Value Artifacts to Registry

| Artifact | Est. Score | Action |
|----------|-----------|--------|
| result-summary.md | 9/10 | ADD to KEEP_CORE |
| test-baseline-comparison.json | 8/10 | ADD to KEEP_FOR_AGENT_CONTEXT |
| git.status | 7/10 | ADD to KEEP_FOR_AGENT_CONTEXT |
| pre-validation.log | 7/10 | ADD to KEEP_FOR_AGENT_CONTEXT |
| critical-change-expectations.json | 8/10 | ADD to KEEP_FOR_AGENT_CONTEXT |

**Impact**: Improves API transparency; no code changes needed (already generated).

### 2. Mark Container Logs as ON_FAILURE

Current: ALWAYS (stdout.log, stderr.log)  
Change to: ON_FAILURE  
Impact: Save ~1–5 MB per successful run; no functional change.

### 3. Consolidate Phase Summaries

| Source | Target | Impact |
|--------|--------|--------|
| scouting-summary.json | all-phase-summaries.json | ✅ Done in registry |
| goal-setting-summary.json | all-phase-summaries.json | ✅ Done in registry |
| goal-check-summary.json | all-phase-summaries.json | ✅ Done in registry |
| run-evaluation-summary.json | all-phase-summaries.json | ✅ Done in registry |

Action: Update kaseki-agent.sh to stop generating individual files; generate all-phase-summaries.json only.

### 4. Consolidate Timing Files

| Source | Target | Impact |
|--------|--------|--------|
| validation-timings.tsv | timings-manifest.json | Already consolidated in registry |
| pre-validation-timings.tsv | timings-manifest.json | Already consolidated in registry |
| stage-timings.tsv | timings-manifest.json | Already consolidated in registry |
| goal-setting-metrics.json | timings-manifest.json | Merge phase metrics |

Action: Update kaseki-agent.sh to generate timings-manifest.json; deprecate .tsv files (or keep as backward-compat aliases).

---

## Consolidation Impact Matrix

| Consolidation | Before | After | Saved | Risk |
|----------------|--------|-------|-------|------|
| Phase summaries → all-phase | 4 files | 1 file | 3 files | LOW (already consolidated) |
| Timing files → manifest | 4 files | 1 file | 3 files | LOW (JSON better than TSV) |
| Phase stderr → phase-errors | 4 files | 1 file | 3 files | MED (rarely consumed) |
| Phase events → pi-events | 4 files | 1 file | 3 files | MED (phase isolation needed?) |
| **Total reduction** | 48 | 35 | **13 files (-27%)** | — |

---

## Scoring Dimension Breakdown

### Top Performers by Dimension

**Agent Decision Value (D1 = 2)**: metadata.json, pi-events.jsonl, failure.json, exit_code, goal-check.json, git.diff, changed-files.txt, restoration.jsonl, secret-scan.log, quality.log

**Machine Readability (D2 = 2)**: All JSON/JSONL artifacts score well; plain-text .log files score 0–1

**Uniqueness (D3 = 2)**: Core artifacts (metadata, pi-events, failure, git, restoration) have no duplicates

**Recovery Usefulness (D4 = 2)**: failure.json, git.diff, goal-check.json, run-evaluation.json help with retry logic

**Cost/Risk (D5 = 2)**: Small, safe artifacts; large files (git.diff, pi-events.jsonl, stdout.log) score lower on this dimension

### Weak Dimensions

| Dimension | Low Scorers | Why |
|-----------|------------|-----|
| D1 (Decision) | Phase summaries, stderr logs, timing files | Rarely drive agent decisions |
| D2 (Readability) | stdout.log, stderr.log, validation.log | Unstructured text |
| D3 (Uniqueness) | Phase summaries (duplicate pi-summary), stderr logs, timing TSVs | High redundancy |
| D4 (Recovery) | Phase summaries, stderr logs, timing files | Not actionable for retry |
| D5 (Cost/Risk) | Large files (stdout, stderr, pi-events, git.diff) | Storage burden; potential noise |

---

## By-Phase Artifact Analysis

### Goal-Setting Phase (6 artifacts)

- **High-value**: goal-setting.json (8/10) — decision context
- **Low-value**: goal-setting-summary.json (5/10), goal-setting-stderr.log (3/10), goal-setting-validation-errors.jsonl (5/10)
- **Consolidate**: All phase summaries → all-phase-summaries.json; all phase errors → artifact-validation-errors.jsonl

### Scouting Phase (6 artifacts)

- **High-value**: scouting.json (8/10) — reconnaissance output
- **Low-value**: scouting-summary.json (5/10), scouting-stderr.log (3/10), scouting-validation-errors.jsonl (5/10)
- **Note**: scouting-events.raw.jsonl (debug-only; keep SHORT_RETAIN_ON_FAILURE)

### Main Pi Coding Phase (2 artifacts)

- **High-value**: pi-events.jsonl (9/10), pi-summary.json (8/10)
- **Action**: KEEP_CORE; these are foundational

### Goal-Check Phase (5 artifacts)

- **High-value**: goal-check.json (9/10) — verdict
- **Low-value**: goal-check-summary.json (5/10), goal-check-stderr.log (3/10), goal-check-events.jsonl (6/10)
- **Note**: goal-check-attempts.jsonl (8/10) — valuable for retry history

### Run-Evaluation Phase (4 artifacts)

- **High-value**: run-evaluation.json (9/10) — final assessment
- **Low-value**: run-evaluation-summary.json (5/10), run-evaluation-stderr.log (3/10), run-evaluation-events.jsonl (6/10)

### Core Metadata & Status (16 artifacts)

- **High-value**: metadata.json, exit_code, pi-events.jsonl, pi-summary.json, progress.jsonl, failure.json, git.diff, changed-files.txt, secret-scan.log, secret-scan.json, restoration.jsonl, quality.log, quality-gates.json, validation.log
- **Medium-value**: cache-metrics.json, validation-results.json
- **Low-value**: stdout.log, stderr.log (but essential on-failure)

---

## Regulatory/Compliance Notes

### Retention Requirements

1. **metadata.json** — MUST keep (audit trail, timestamps)
2. **failure.json** — MUST keep (failure classification, compliance)
3. **secret-scan.log / secret-scan.json** — MUST keep (security audit)
4. **git.diff + changed-files.txt** — MUST keep (change tracking)
5. **validation.log** — SHOULD keep (compliance; audit trail for changes)
6. **stdout/stderr.log** — KEEP_ON_FAILURE (emergency troubleshooting)

**Implication**: All KEEP and KEEP_FOR_AGENT_CONTEXT artifacts should have indefinite retention; KEEP_ON_FAILURE can be shorter TTL (30–90 days).

---

## Implementation Checklist

- [ ] **Phase 1A**: Add missing artifacts to registry (result-summary.md, test-baseline, git.status, pre-validation.log, critical-change-expectations.json)
- [ ] **Phase 1B**: Mark stdout/stderr as ON_FAILURE in registry
- [ ] **Phase 2A**: Update artifact-metadata.ts registry (deprecation notes)
- [ ] **Phase 2B**: Update kaseki-agent.sh to stop generating individual phase summaries (scouting-summary.json, etc.)
- [ ] **Phase 2C**: Update kaseki-agent.sh to stop generating individual timing TSVs
- [ ] **Phase 3**: Update artifact routes to recommend KEEP_CORE first
- [ ] **Phase 4**: Add backward-compat aliases (if needed) for consolidations
- [ ] **Phase 5**: Test with external agents; verify no breaking changes
- [ ] **Phase 6**: One-release deprecation window; remove individual files in next release

---

## Appendix: Artifact Metadata Schema

```typescript
export interface ArtifactMetadataDefinition {
  name: string;  // Filename
  contentType: string;  // MIME type (application/json, text/plain, etc.)
  description: string;  // Human-readable description
  availability: ArtifactAvailability;  // ALWAYS, ON_FAILURE, ON_SUCCESS, CONDITIONAL
  triageOrder?: number;  // Lower = higher priority (1–30)
  sizeHint?: 'small' | 'medium' | 'large';  // Storage estimate
}

export enum ArtifactAvailability {
  ALWAYS = 'always',
  ON_FAILURE = 'on-failure',
  ON_SUCCESS = 'on-success',
  CONDITIONAL = 'conditional',
}
```

---

## References

- Full report: [ARTIFACT_EVALUATION_REPORT.md](ARTIFACT_EVALUATION_REPORT.md)
- Registry source: [src/artifact-metadata.ts](src/artifact-metadata.ts)
- API routes: [src/routes/artifact-routes.ts](src/routes/artifact-routes.ts)
- Agent orchestration: [kaseki-agent.sh](kaseki-agent.sh)
- Artifact inventory: [/memories/repo/all-kaseki-artifacts-comprehensive-inventory.md](/memories/repo/all-kaseki-artifacts-comprehensive-inventory.md)
