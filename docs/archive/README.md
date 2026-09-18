# Documentation Archive

This directory contains historical and completed documentation that has been consolidated into the main docs structure.

**Last Update**: September 2026
**Reason**: Documentation consolidation to reduce redundancy and improve navigation

---

## Contents Overview

### 📦 Consolidated Into Master Docs

**Goal-Setting Documentation** (5 files)

- `GOAL_SETTING_IMPROVEMENTS.md` → See [../GOAL_SETTING_GUIDE.md](../GOAL_SETTING_GUIDE.md)
- `GOAL_SETTING_PRACTICAL_GUIDE.md` → See [../GOAL_SETTING_GUIDE.md](../GOAL_SETTING_GUIDE.md)
- `GOAL_SETTING_EXIT_CODES.md` → See [../GOAL_SETTING_GUIDE.md](../GOAL_SETTING_GUIDE.md#exit-codes--troubleshooting)
- `GOAL-SETTING-FIXES-SUMMARY.md` → See [../GOAL_SETTING_GUIDE.md](../GOAL_SETTING_GUIDE.md)
- `GOAL_CHECK_CAUSALITY_INTEGRATION.md` → See [../GOAL_SETTING_GUIDE.md](../GOAL_SETTING_GUIDE.md#advanced-goal-check-causality)

**Artifact Documentation** (7 files)

- `ARTIFACT_CONSOLIDATION_IMPLEMENTATION.md` → See [../ARTIFACT_SCHEMAS.md](../ARTIFACT_SCHEMAS.md)
- `ARTIFACT_CONSUMPTION_RESEARCH.md` → See [../ARTIFACT_SCHEMAS.md](../ARTIFACT_SCHEMAS.md)
- `ARTIFACT_EVALUATION_ACTION_PLAN.md` → See [../ARTIFACT_SCHEMAS.md](../ARTIFACT_SCHEMAS.md)
- `ARTIFACT_EVALUATION_REVISED.md` → See [../ARTIFACT_SCHEMAS.md](../ARTIFACT_SCHEMAS.md)
- `ARTIFACT_SCORING_EVALUATION.md` → See [../ARTIFACT_SCORING_QUICK_REFERENCE.md](../ARTIFACT_SCORING_QUICK_REFERENCE.md)
- `ARTIFACT_SCORING_QUICK_REFERENCE_REVISED.md` → See [../ARTIFACT_SCORING_QUICK_REFERENCE.md](../ARTIFACT_SCORING_QUICK_REFERENCE.md)
- `ARTIFACT_SCORING_REFERENCE.md` → See [../ARTIFACT_SCHEMAS.md](../ARTIFACT_SCHEMAS.md)

**Host Setup Documentation** (2 files)

- `HOST_SETUP_STAGES.md` → See [../HOST_SETUP_API_REFERENCE.md](../HOST_SETUP_API_REFERENCE.md)
- `HOST_SETUP_TROUBLESHOOTING.md` → See [../HOST_SETUP_API_REFERENCE.md](../HOST_SETUP_API_REFERENCE.md)

**Test Documentation** (2 files)

- `QUICK_REF_TEST_ISOLATION.md` → See [../TEST_ISOLATION_BEST_PRACTICES.md](../TEST_ISOLATION_BEST_PRACTICES.md)
- `TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md` → See [../TEST_ISOLATION_BEST_PRACTICES.md](../TEST_ISOLATION_BEST_PRACTICES.md)

**Evaluation Documentation** (1 file)

- `EVALUATION_IMPROVEMENTS_ROLLOUT.md` → See [../EVALUATION_BEST_PRACTICES.md](../EVALUATION_BEST_PRACTICES.md)

---

### 🏁 Historical & Completed Docs

**Feature 3 Documentation** (6 files) — Feature is now integrated into codebase

- `FEATURE3_COMPLETION_SUMMARY.md`
- `FEATURE3_IMPLEMENTATION.md`
- `FEATURE3_INTEGRATION_GUIDE.md`
- `FEATURE3_README.md`
- `FEATURE3_STATUS.md`
- `FEATURE3_SUMMARIZATION.md`

See [../CLAUDE.md](../CLAUDE.md) for current infrastructure status.

**Phase Completion Summaries** (3 files) — Historical project phase snapshots

- `PHASE2_COMPLETION_SUMMARY.md`
- `PHASE3_COMPLETION_SUMMARY.md`
- `PHASE_4-5_COMPLETION.md`

See [../CLAUDE.md](../CLAUDE.md) for current status (May 2026).

**Caveman Project Documentation** (3 files) — Historical project phases

- `CAVEMAN_BASELINE.md`
- `CAVEMAN_PHASE2_COMPLETE.md`
- `CAVEMAN_DOCUMENTATION_UPDATE_SUMMARY.md`

Refer to git history for complete context.

**Issue Investigation Reports** (5 files) — Completed investigations

- `KASEKI-156-INVESTIGATION-REPORT.md`
- `KASEKI-170-IMPLEMENTATION-GUIDE.md`
- `KASEKI-170-IMPLEMENTATION-SUMMARY.md`
- `KASEKI-198-FAILURE-ANALYSIS.md`
- `KASEKI-201-FIX-SUMMARY.md`

See git commit history or GitHub issues for full context and resolution status.

**Implementation Summaries** (2 files) — Generic summaries merged into other docs

- `IMPLEMENTATION_SUMMARY.md`
- `IMPLEMENTATION_SUMMARY_2.md`

Content merged into [../DEVELOPMENT.md](../DEVELOPMENT.md) and topic-specific docs.

---

## How to Access

### View an Archived Doc

```bash
# List all archived files
ls -la docs/archive/

# View specific file
cat docs/archive/FEATURE3_README.md

# Search archived content
grep -r "search-term" docs/archive/
```

### Find Consolidated Content

1. Check the mapping above for your old doc
2. Navigate to the new master doc
3. Use Ctrl+F to search within the master doc
4. See [../DOCS_CONSOLIDATION_MAP.md](../DOCS_CONSOLIDATION_MAP.md) for complete migration guide

---

## Why Archive?

### Historical Context

Investigation reports and phase summaries provide decision-making rationale and project history.

### Completed Features

Feature 3 documentation serves as reference for past implementations and architectural decisions.

### Audit Trail

Archived files remain in git history for complete version control and compliance.

### Preserved Access

Archive preserves old doc URLs/links that external users may reference.

---

## When to Use Archive

✅ **Use archive when**:

- You need historical context for a feature or phase
- You're reviewing past investigation reports
- You want to understand previous implementation decisions
- You need to verify what was deprecated or changed

❌ **Don't use archive when**:

- Looking for current setup/deployment info → Use main docs
- Troubleshooting current issues → Use main docs
- Learning about current features → Use main docs
- Setting up kaseki-agent → Use [../GETTING_STARTED.md](../GETTING_STARTED.md)

---

## Maintenance

### Adding to Archive

When consolidating documentation:

1. Identify duplicate or completed content
2. Move file to `archive/` with date stamp if needed
3. Update [../DOCS_CONSOLIDATION_MAP.md](../DOCS_CONSOLIDATION_MAP.md) with mapping
4. Update [../INDEX.md](../INDEX.md) to remove consolidated references
5. Add cross-reference in master doc

### Cleaning Archive

Archive should only be cleaned by:

- Major version releases (with clear deprecation notice)
- Multi-year old content (after 3+ years, typically)
- Files made obsolete by complete product changes

**Default policy**: Keep all archived docs for historical reference.

---

## See Also

- [DOCS_CONSOLIDATION_MAP.md](../DOCS_CONSOLIDATION_MAP.md) — Complete migration guide
- [INDEX.md](../INDEX.md) — Active documentation index
- [GETTING_STARTED.md](../GETTING_STARTED.md) — Start here for new users

---

**Questions?** See [DOCS_CONSOLIDATION_MAP.md](../DOCS_CONSOLIDATION_MAP.md#questions-or-issues) for support.
