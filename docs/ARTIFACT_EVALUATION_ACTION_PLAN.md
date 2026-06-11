# Kaseki-Agent Artifact Evaluation - Executive Summary & Action Plan

**Date**: June 11, 2026  
**Status**: Complete evaluation of 105+ artifacts using 5-dimensional scoring rubric

---

## 🎯 Key Findings

### Artifact Scoring Distribution

```
Score 10 (Perfect):       12 artifacts  (11%)  ⭐ All-critical
Score 9 (Excellent):       8 artifacts   (8%)  ⭐ High-value, keep
Score 8 (Very Good):      10 artifacts  (10%)  🟢 Keep for context
Score 7 (Good):           10 artifacts  (10%)  🟢 Keep for context
Score 6 (Adequate):        5 artifacts   (5%)  🟡 Consider consolidation
Score 5 (Marginal):        5 artifacts   (5%)  🟡 Merge or remove
Score 4 (Poor):            5 artifacts   (5%)  🔴 Remove
Score 3 (Very Poor):       8 artifacts   (8%)  🔴 Remove
Score 2 (Bad):            16 artifacts  (15%)  🔴 Remove
Score 1 (Worse):           8 artifacts   (8%)  🔴 Remove
Score 0 (Useless):         7 artifacts   (7%)  🔴 Remove
```

### Segment Breakdown

| Segment | Count | Score | Strategy | Storage Impact |
|---------|-------|-------|----------|---|
| **KEEP_CORE** | 4 | 10 | Always retain | 20 KB |
| **KEEP_FOR_AGENT_CONTEXT** | 30 | 8–10 | Conditional on feature flags | 100–200 KB |
| **MERGE/REFACTOR** | 20 | 5–7 | Consolidate into primary artifacts | -40 KB |
| **REMOVE** | 55+ | 0–4 | Delete immediately or short-retain | -60–300 MB |

---

## 🔥 Bottom 10 Lowest-Value Artifacts

| Rank | Artifact | Score | Size | Reason for Low Score | Action |
|------|----------|-------|------|-----|--------|
| **1** | stdout.log | 0 | 10–100 MB | Raw duplicate; no agent parsing; noise | DELETE (keep on failure only, 7 days) |
| **2** | progress.log | 0 | <5 KB | Exact duplicate of progress.jsonl | **REMOVE NOW** |
| **3** | validation-raw.log | 0 | 5–20 KB | Exact duplicate of validation.log | **REMOVE NOW** |
| **4** | pi-events.raw.jsonl | 2 | 50–200 MB | Raw pre-filter; only for KASEKI_DEBUG_RAW_EVENTS=1 | Conditional: keep only if debug flag |
| **5** | scouting-stderr.log | 1 | 1–10 MB | Feature-specific duplicate of stderr.log | **REMOVE NOW** |
| **6** | goal-setting-stderr.log | 1 | 1–10 MB | Feature-specific duplicate of stderr.log | **REMOVE NOW** |
| **7** | goal-check-stderr.log | 1 | 1–10 MB | Feature-specific duplicate of stderr.log | **REMOVE NOW** |
| **8** | run-evaluation-stderr.log | 1 | 1–10 MB | Feature-specific duplicate of stderr.log | **REMOVE NOW** |
| **9** | stderr.log | 2 | 5–50 MB | Unstructured; errors surfaced elsewhere | DELETE (keep on failure only, 7 days) |
| **10** | pre-validation-raw.log | 0 | 5–20 KB | Exact duplicate of pre-validation.log | **REMOVE NOW** |

---

## 💡 What This Means for Agents

### External Agent Impact

**Agents currently rely on:**

1. `metadata.json` — Primary source for run status, exit codes, timestamps
2. `progress.jsonl` — For live monitoring and timeout detection
3. `pi-events.jsonl` — For agent activity analysis and token counting
4. `goal-check.json` (if enabled) — For retry decision logic
5. `failure.json` — For failure classification and diagnosis

**Agents do NOT rely on:**

- `stdout.log`, `stderr.log` (raw event streams)
- Any `.raw.jsonl` files (raw pre-filter events)
- Any `*-candidate.json` files (intermediates)
- `progress.log`, `validation-raw.log` (duplicates)
- Feature-specific `.stderr.log` files (duplicates)

### Storage Impact

**Baseline run (core only)**:

- metadata.json, pi-summary.json, git.diff, changed-files.txt, quality.log, secret-scan.json
- **Total**: ~2–5 MB

**With agent context (features disabled)**:

- Add: progress.jsonl, pi-events.jsonl, validation.log, failure.json, etc.
- **Total**: ~10–50 MB

**Current setup (debug mode enabled)**:

- Add: stdout.log, stderr.log, .raw.jsonl files
- **Total**: 100–300 MB per run ⚠️

**After cleanup (aggressive)**:

- Remove all low-value artifacts, keep only agent-critical outputs
- **New total**: 5–20 MB per run (80% reduction)

---

## 🛠️ Implementation Roadmap

### Phase 1: Immediate Removals (This Week)

**Effort**: 2–4 hours | **Risk**: Low | **Benefit**: High

Files to modify:

- [kaseki-agent.sh](kaseki-agent.sh) — Remove progress.log, validation-raw.log, pre-validation-raw.log generation
- Feature agent scripts (scouting, goal-check, etc.) — Remove feature-specific .stderr.log generation

**Changes**:

```bash
# Before: Multiple log generations
echo "..." > progress.log
echo "..." > validation-raw.log

# After: Only structured outputs
# (Remove above; progress.jsonl already generated)
```

**Expected outcome**:

- Remove 7 artifacts (0–2 score)
- Save 30–50 KB per run immediately
- No breaking changes (agents don't use these)

---

### Phase 2: Consolidation (Week 2)

**Effort**: 4–8 hours | **Risk**: Medium | **Benefit**: High

Consolidate duplicated information into primary artifacts:

1. **secret-scan.log** → consolidate into secret-scan.json
   - Modify: [kaseki-agent.sh](kaseki-agent.sh) secret scanning section
   - Keep: secret-scan.json only
   - Delete: secret-scan.log generation

2. **quality.log** → consolidate into quality-gates.json
   - Modify: [kaseki-agent.sh](kaseki-agent.sh) quality gates section
   - Keep: quality-gates.json only
   - Delete: quality.log generation

3. **validation-results.json** → merge into metadata.json.phases.validation
   - Modify: [kaseki-report.js](src/kaseki-report.js)
   - Move validation results into metadata structure
   - Delete: validation-results.json file

**Expected outcome**:

- Consolidate 8–10 redundant artifacts
- Save 20–40 KB per run
- Single source of truth for each artifact type
- Requires agent update (read from new paths)

---

### Phase 3: Conditional Retention (Week 3)

**Effort**: 2–4 hours | **Risk**: Low | **Benefit**: Medium

Implement feature-gated artifact generation:

1. **Raw events** (.raw.jsonl files)
   - Only generate if `KASEKI_DEBUG_RAW_EVENTS=1`
   - Save 50–200 MB per run (when disabled)

2. **stdout.log, stderr.log**
   - Only retain if exit_code ≠ 0
   - Auto-delete after 7 days (add `retention_days` field)
   - Save 90% of log storage on successful runs

3. **Feature-specific artifacts**
   - Only generate if feature enabled
   - Already feature-gated; document clearly

**Implementation**:

```bash
# In kaseki-agent.sh
if [[ "$KASEKI_DEBUG_RAW_EVENTS" == "1" ]]; then
  # Generate .raw.jsonl files only if debug flag
fi

# For stdout/stderr
if [[ $EXIT_CODE -ne 0 ]]; then
  # Retain; set retention_days=7 in metadata
else
  # Delete stdout.log, stderr.log on success
fi
```

**Expected outcome**:

- Conditional retention eliminates debug bloat
- Save 60–300 MB per run (on success)
- Clear retention policy in metadata.json

---

### Phase 4: Schema Versioning & Documentation (Week 4)

**Effort**: 4–6 hours | **Risk**: Low | **Benefit**: High

Add schema versioning for forward compatibility:

1. **All JSON/JSONL artifacts** add `schema_version` and `artifact_version` fields
2. **Create OpenAPI/JSON Schema specs** for all ≥8 score artifacts
3. **Document stable schemas** in [docs/ARTIFACT_SCHEMAS.md](docs/ARTIFACT_SCHEMAS.md)
4. **Update CLAUDE.md** with new artifact inventory

**Example**:

```json
{
  "schema_version": "1.0",
  "artifact_version": "2026-06-11",
  "metadata": {
    "instance": "kaseki-1",
    ...
  }
}
```

---

## 📊 Cost-Benefit Analysis

### Storage Savings

| Phase | Removals | Per-Run Savings | Annual Savings (10K runs) |
|-------|----------|-----------------|--------------------------|
| **Phase 1** (Remove 0-score) | 3 artifacts | 30 KB | 300 MB |
| **Phase 2** (Consolidate) | 8 artifacts | 40 KB | 400 MB |
| **Phase 3** (Conditional) | 2+ artifacts | 60–300 MB* | 600 GB–3 TB |
| **Total** | 13–15 artifacts | **130–370 KB baseline** | **1–3.7 TB per 10K runs** |

*On successful runs (non-debug mode); failure runs retain for diagnostics

### Complexity Reduction

| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| **Total artifact types** | 105+ | 55–65 | 45–50% |
| **Always-generated** | 25 | 15 | 40% |
| **Average artifacts per run** | 80–120 | 30–50 | 50–60% |
| **Unique schemas** | 30+ | 15 | 50% |

### Risk Assessment

| Phase | Breaking Changes | Backward Compatibility | Rollback Difficulty |
|-------|---|---|---|
| **Phase 1** | None | 100% | Trivial (add back old artifacts) |
| **Phase 2** | Low (consolidation) | 95% | Easy (split consolidated fields) |
| **Phase 3** | None (feature-gated) | 100% | Trivial (set retention flags) |
| **Phase 4** | None (additions only) | 100% | N/A (purely additive) |

---

## 🚨 Critical Decisions

### Decision 1: Debug Artifacts Retention

**Question**: Should we keep .raw.jsonl and raw logs at all?

**Options**:

- **A) Never generate** — Always use filtered versions; 50–200 MB savings per run
- **B) Optional (feature-flag)** — Generate only if KASEKI_DEBUG_RAW_EVENTS=1
- **C) Always generate** — Keep current behavior; no savings

**Recommendation**: **Option B** — Opt-in debug mode

- Saves 150 MB per run in production
- Enables human debugging when needed
- Minimal overhead for debugging workflows

---

### Decision 2: Feature .stderr.log Consolidation

**Question**: Should each feature agent (scouting, goal-check, etc.) generate its own .stderr.log?

**Options**:

- **A) Consolidate to phase-errors.jsonl** — All errors in one structured file
- **B) Keep separate** — Each feature has own stderr.log
- **C) Remove all** — Don't generate any .stderr.log files

**Recommendation**: **Option A** — Consolidate to phase-errors.jsonl

- Reduces 4 duplicate .stderr.log files
- Saves 20 MB per run (if features enabled)
- Single source of truth for phase errors
- Structured format easier for agents to parse

---

### Decision 3: Conditional Artifact Retention

**Question**: Should we delete stdout.log and stderr.log on successful runs?

**Options**:

- **A) Always keep** — Retain for all runs forever
- **B) Conditional** — Keep only on failure, delete on success
- **C) Age-based** — Delete all logs after 7–30 days

**Recommendation**: **Option B + C** — Hybrid

- Keep stdout.log, stderr.log only if exit_code ≠ 0
- Auto-delete after 7 days (add retention_days in metadata.json)
- Saves 90% of log storage on successful runs
- Preserves debugging for failures

---

### Decision 4: Consolidation Merge Targets

**Question**: Where should redundant information be consolidated?

**Options**:

- **A) Flat structure** — Keep separate JSON files (current)
- **B) Metadata hierarchy** — Consolidate into metadata.json.phases.* structure
- **C) New consolidated artifact** — Create all-run-details.json

**Recommendation**: **Option B** — Metadata hierarchy

- metadata.json is already the primary source
- Reduces artifact fragmentation
- Single schema versioning strategy
- Easier for agents to navigate

**Structure**:

```json
{
  "metadata": {
    "phases": {
      "validation": {
        "exit_code": 0,
        "results": [...],
        "timings": [...]
      },
      "quality_gates": {
        "violations": [...]
      }
    }
  }
}
```

---

## 📋 Artifact Removal Checklist

### Before Implementation

- [ ] Confirm bottom 10 artifacts with stakeholders (ask: "Do you rely on any of these?")
- [ ] Audit external tooling that might depend on low-value artifacts
- [ ] Create backup of current artifact generation for rollback
- [ ] Set up monitoring for artifact changes (track size, count, schema changes)

### Phase 1 Implementation

- [ ] Remove progress.log generation from [kaseki-agent.sh](kaseki-agent.sh)
- [ ] Remove validation-raw.log generation from [kaseki-agent.sh](kaseki-agent.sh)
- [ ] Remove pre-validation-raw.log generation from validation scripts
- [ ] Remove feature-specific .stderr.log generation from:
  - Scouting agent
  - Goal-setting agent
  - Goal-check agent
  - Run-evaluation agent
- [ ] Test kaseki run; verify artifacts match expected list
- [ ] Deploy to staging; validate for 1 week

### Phase 2 Implementation

- [ ] Create metadata.json.phases structure template
- [ ] Migrate validation-results.json into metadata.json.phases.validation
- [ ] Migrate quality-gates.json into metadata.json.phases.quality_gates
- [ ] Update [kaseki-report.js](src/kaseki-report.js) to read from new paths
- [ ] Make secret-scan.log optional (only generate if KASEKI_DEBUG_SECRET_SCAN=1)
- [ ] Make quality.log optional (only generate if KASEKI_DEBUG_QUALITY=1)
- [ ] Update agent code that reads these artifacts
- [ ] Test kaseki run; validate consolidation
- [ ] Deploy to staging; validate for 1 week

### Phase 3 Implementation

- [ ] Add conditional generation for .raw.jsonl files (if KASEKI_DEBUG_RAW_EVENTS=1)
- [ ] Add conditional retention for stdout.log, stderr.log (if exit_code ≠ 0)
- [ ] Add retention_days field to metadata.json
- [ ] Implement auto-delete logic in [scripts/cleanup.sh](scripts/cleanup.sh)
- [ ] Test on success and failure runs
- [ ] Deploy to staging; monitor for 2 weeks

### Phase 4 Implementation

- [ ] Add schema_version field to all JSON/JSONL artifacts
- [ ] Create [docs/ARTIFACT_SCHEMAS.md](docs/ARTIFACT_SCHEMAS.md) with OpenAPI specs
- [ ] Update [CLAUDE.md](CLAUDE.md) with new inventory
- [ ] Update agent code to handle schema versioning
- [ ] Document in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## 📚 Updated Documentation

After implementation, create/update:

1. **[docs/ARTIFACT_SCHEMAS.md](docs/ARTIFACT_SCHEMAS.md)** (NEW)
   - OpenAPI/JSON Schema specs for all ≥8 artifacts
   - Field descriptions, enums, examples
   - Schema versioning strategy

2. **[CLAUDE.md](CLAUDE.md)** (UPDATE "Result Artifacts" section)
   - New compact artifact inventory
   - Retention policies per artifact
   - Feature flag documentation

3. **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** (NEW section)
   - How to add new artifacts
   - Artifact naming conventions
   - Schema requirements

4. **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** (UPDATE)
   - What artifacts to check for specific failures
   - Why certain artifacts were removed

---

## 🎯 Success Criteria

1. ✅ **Storage reduction**: Achieve 60–300 MB savings per run (target: 80% on successful runs)
2. ✅ **No breaking changes**: Agents continue to work without code changes
3. ✅ **Backward compatibility**: Old kaseki runs still analyzed correctly
4. ✅ **Documentation**: All artifacts documented with schema specs
5. ✅ **Monitoring**: Track artifact count, size, and schema changes over time
6. ✅ **Feedback loop**: Collect agent feedback; adjust if new artifacts needed

---

## 🔗 References

- [Artifact Scoring Evaluation](docs/ARTIFACT_SCORING_EVALUATION.md) — Full evaluation with rubric scores
- [CLAUDE.md](CLAUDE.md) — Current artifact inventory (to be updated)
- [kaseki-agent.sh](kaseki-agent.sh) — Artifact generation logic
- [src/kaseki-report.js](src/kaseki-report.js) — Artifact consolidation & reporting
