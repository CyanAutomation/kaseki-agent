# Documentation Consolidation Map (September 2026)

**Overview**: Kaseki documentation has been consolidated from 70+ files to 50 core files + 36 archived files, reducing redundancy and improving navigation.

---

## What Changed?

### Consolidation Results

- **Before**: 70+ markdown files with overlapping topics and redundant guides
- **After**: 50 core files + 36 archived files (28% reduction in main docs)
- **Benefit**: Clearer navigation, single source of truth per topic, easier to maintain

---

## Consolidated Topics: Where to Find Content

### Goal-Setting Documentation

**Old Files** (5 docs → 1 master):
- ❌ ~~GOAL_SETTING_IMPROVEMENTS.md~~ → ✅ [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md)
- ❌ ~~GOAL_SETTING_PRACTICAL_GUIDE.md~~ → ✅ [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md)
- ❌ ~~GOAL_SETTING_EXIT_CODES.md~~ → ✅ [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md#exit-codes--troubleshooting)
- ❌ ~~GOAL-SETTING-FIXES-SUMMARY.md~~ → ✅ [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md)
- ❌ ~~GOAL_CHECK_CAUSALITY_INTEGRATION.md~~ → ✅ [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md#advanced-goal-check-causality)

**Master Reference**: [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md)

**What's Included**:
- Complete overview (Why, what makes a good goal)
- All 10 improvements explained
- Configuration & API reference
- Practical best practices
- Quality checking & interpretation
- Exit codes & troubleshooting
- Advanced: Goal-check causality
- TypeScript helpers & integration

---

### Artifact Documentation

**Old Files** (7 docs → 2 masters):
- ❌ ~~ARTIFACT_CONSOLIDATION_IMPLEMENTATION.md~~ → ✅ [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)
- ❌ ~~ARTIFACT_CONSUMPTION_RESEARCH.md~~ → ✅ [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)
- ❌ ~~ARTIFACT_EVALUATION_ACTION_PLAN.md~~ → ✅ [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)
- ❌ ~~ARTIFACT_EVALUATION_REVISED.md~~ → ✅ [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)
- ❌ ~~ARTIFACT_SCORING_EVALUATION.md~~ → ✅ [ARTIFACT_SCORING_QUICK_REFERENCE.md](./ARTIFACT_SCORING_QUICK_REFERENCE.md)
- ❌ ~~ARTIFACT_SCORING_QUICK_REFERENCE_REVISED.md~~ → ✅ [ARTIFACT_SCORING_QUICK_REFERENCE.md](./ARTIFACT_SCORING_QUICK_REFERENCE.md)
- ❌ ~~ARTIFACT_SCORING_REFERENCE.md~~ → ✅ [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**Master References**:
- [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md) — Complete artifact schema definitions
- [ARTIFACT_SCORING_QUICK_REFERENCE.md](./ARTIFACT_SCORING_QUICK_REFERENCE.md) — Quick lookup guide

---

### Host Setup Documentation

**Old Files** (3 docs → 1 master):
- ❌ ~~HOST_SETUP_STAGES.md~~ → ✅ [HOST_SETUP_API_REFERENCE.md](./HOST_SETUP_API_REFERENCE.md)
- ❌ ~~HOST_SETUP_TROUBLESHOOTING.md~~ → ✅ [HOST_SETUP_API_REFERENCE.md](./HOST_SETUP_API_REFERENCE.md)

**Master Reference**: [HOST_SETUP_API_REFERENCE.md](./HOST_SETUP_API_REFERENCE.md)

**What's Included**:
- Complete API reference
- Setup stages & initialization flow
- Troubleshooting common issues

---

### Evaluation Documentation

**Old Files** (2 docs → 1 master):
- ❌ ~~EVALUATION_IMPROVEMENTS_ROLLOUT.md~~ → ✅ [EVALUATION_BEST_PRACTICES.md](./EVALUATION_BEST_PRACTICES.md)

**Master Reference**: [EVALUATION_BEST_PRACTICES.md](./EVALUATION_BEST_PRACTICES.md)

**What's Included**:
- Best practices for goal-check and run-evaluation phases
- Quality assessment methodologies
- Rollout timeline & enhancements

---

### Test Documentation

**Old Files** (3 docs → 1 master):
- ❌ ~~QUICK_REF_TEST_ISOLATION.md~~ → ✅ [TEST_ISOLATION_BEST_PRACTICES.md](./TEST_ISOLATION_BEST_PRACTICES.md)
- ❌ ~~TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md~~ → ✅ [TEST_ISOLATION_BEST_PRACTICES.md](./TEST_ISOLATION_BEST_PRACTICES.md)

**Master Reference**: [TEST_ISOLATION_BEST_PRACTICES.md](./TEST_ISOLATION_BEST_PRACTICES.md)

**What's Included**:
- Complete isolation best practices
- Quick reference guide
- Environment pollution postmortem & lessons learned

---

### Historical/Completed Documentation (Now Archived)

**Feature 3 Documentation** (6 files → archive/):
- All Feature 3 implementation, status, and integration docs
- Location: `archive/FEATURE3_*.md`
- Why archived: Feature is complete and integrated into main codebase

**Phase Completion Summaries** (3 files → archive/):
- Phase 2, 3, and 4-5 completion snapshots
- Location: `archive/PHASE*_COMPLETION*.md`
- Why archived: Historical snapshots; current status is in CLAUDE.md

**Caveman Documentation** (3 files → archive/):
- Caveman baseline, phase 2, and documentation update summaries
- Location: `archive/CAVEMAN_*.md`
- Why archived: Historical project phases; refer to CLAUDE.md for current status

**Issue Investigation Reports** (5 files → archive/):
- KASEKI-156, KASEKI-170, KASEKI-198, KASEKI-201 investigation reports
- Location: `archive/KASEKI-*-*.md`
- Why archived: Investigations are complete; refer to codebase history for context

**Implementation Summaries** (2 files → archive/):
- Generic implementation summary files
- Location: `archive/IMPLEMENTATION_SUMMARY*.md`
- Why archived: Content merged into DEVELOPMENT.md and other docs

---

## New Directory Structure

```
docs/
├── 📖 START HERE
│   ├── GETTING_STARTED.md
│   ├── QUICK_START.md
│   ├── INDEX.md (updated)
│
├── 🏗️ Architecture & Core Concepts
│   ├── DEVELOPMENT.md
│   ├── DESIGN.md
│   ├── EXIT_CODES.md
│   ├── QUALITY_GATES.md
│   ├── GOAL_SETTING_GUIDE.md ⭐ CONSOLIDATED
│   ├── TASK_PROMPT_TEMPLATES.md
│   ├── SCOUTING_PROMPT_DESIGN.md
│
├── 🚀 Operations & Deployment
│   ├── DEPLOYMENT.md
│   ├── DISTRIBUTED_SETUP.md
│   ├── CI_CD_INTEGRATION.md
│   ├── HOST_SETUP_API_REFERENCE.md ⭐ CONSOLIDATED
│   ├── DOCKER_SETUP.md
│   ├── NPM_SETUP.md
│
├── 📊 Monitoring & Observability
│   ├── CLI.md
│   ├── SENTRY_INTEGRATION.md
│   ├── PERFORMANCE_TUNING.md
│   ├── COST_ESTIMATION.md
│
├── 🛠️ Usage & Examples
│   ├── EXAMPLES.md
│   ├── INTEGRATION_EXAMPLE.md
│   ├── ARTIFACT_SCHEMAS.md ⭐ CONSOLIDATED
│   ├── ARTIFACT_SCORING_QUICK_REFERENCE.md ⭐ CONSOLIDATED
│   ├── API.md
│
├── ⚙️ Configuration & Reference
│   ├── ENV_VARS.md
│   ├── ADVANCED_CONFIG.md
│   ├── EVALUATION_BEST_PRACTICES.md ⭐ CONSOLIDATED
│   ├── AUTH_SETUP.md
│   ├── SETUP_GUIDE.md
│
├── 🔍 Troubleshooting & Support
│   ├── TROUBLESHOOTING.md
│   ├── VERIFICATION_GUIDE.md
│   ├── TEST_ISOLATION_BEST_PRACTICES.md ⭐ CONSOLIDATED
│
├── 📚 Reference Materials
│   ├── STYLE.md
│   ├── ASYNC_AWARENESS.md
│   ├── WORKFLOW_HARDENING.md
│   ├── PRESERVATION_CONSTRAINTS_IMPLEMENTATION.md
│   ├── PI_TOOL_HASHLINE_EDIT.md
│   ├── RUN_SCORECARD_DESIGN.md
│   ├── VALIDATION_CAUSALITY_ANALYSIS.md
│   ├── VALIDATION_CAUSALITY_ANALYSIS_ARCHITECTURE.md
│   ├── FEEDBACK_LOOP_INTEGRATION.md
│   ├── SECRET_SCAN_ALLOWLIST.md
│   ├── SECRETS_AUDIT_REPORT.md
│   ├── HASHLINE_MONITORING.md
│   ├── HASHLINE_ROLLOUT_STRATEGY.md
│   ├── BASELINE_TEST_COMPARISON.md
│   ├── COMPILATION_VALIDATION.md
│   ├── GATEWAY_TEST.md
│   ├── suggested_models.md
│
├── 📦 Archive (Historical)
│   ├── archive/FEATURE3_*.md (6 files)
│   ├── archive/PHASE*_*.md (3 files)
│   ├── archive/CAVEMAN_*.md (3 files)
│   ├── archive/KASEKI-*-*.md (5 files)
│   ├── archive/IMPLEMENTATION_SUMMARY*.md (2 files)
│   ├── archive/EVALUATION_IMPROVEMENTS_ROLLOUT.md
│   ├── archive/HOST_SETUP_STAGES.md
│   ├── archive/HOST_SETUP_TROUBLESHOOTING.md
│   ├── archive/QUICK_REF_TEST_ISOLATION.md
│   ├── archive/TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md
│   ├── archive/GOAL_SETTING_*.md (5 files)
│   ├── archive/ARTIFACT_*.md (7 files)
│
├── 📄 THIS FILE
│   └── DOCS_CONSOLIDATION_MAP.md
│
└── 📁 internal/
    └── (internal documentation)
```

---

## Migration Guide: Finding Content

### If you were reading...

**GOAL_SETTING_IMPROVEMENTS.md**
→ Go to: [GOAL_SETTING_GUIDE.md § The 10 Improvements](./GOAL_SETTING_GUIDE.md#the-10-improvements-may-2026)

**GOAL_SETTING_PRACTICAL_GUIDE.md**
→ Go to: [GOAL_SETTING_GUIDE.md § Practical Guide](./GOAL_SETTING_GUIDE.md#practical-guide-best-practices)

**GOAL_SETTING_EXIT_CODES.md**
→ Go to: [GOAL_SETTING_GUIDE.md § Exit Codes & Troubleshooting](./GOAL_SETTING_GUIDE.md#exit-codes--troubleshooting)

**GOAL-SETTING-FIXES-SUMMARY.md**
→ Go to: [GOAL_SETTING_GUIDE.md](./GOAL_SETTING_GUIDE.md) (Integrated throughout)

**GOAL_CHECK_CAUSALITY_INTEGRATION.md**
→ Go to: [GOAL_SETTING_GUIDE.md § Advanced: Goal-Check Causality](./GOAL_SETTING_GUIDE.md#advanced-goal-check-causality)

**ARTIFACT_CONSOLIDATION_IMPLEMENTATION.md**
→ Go to: [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**ARTIFACT_CONSUMPTION_RESEARCH.md**
→ Go to: [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**ARTIFACT_EVALUATION_ACTION_PLAN.md**
→ Go to: [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**ARTIFACT_EVALUATION_REVISED.md**
→ Go to: [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**ARTIFACT_SCORING_EVALUATION.md**
→ Go to: [ARTIFACT_SCORING_QUICK_REFERENCE.md](./ARTIFACT_SCORING_QUICK_REFERENCE.md)

**ARTIFACT_SCORING_QUICK_REFERENCE_REVISED.md**
→ Go to: [ARTIFACT_SCORING_QUICK_REFERENCE.md](./ARTIFACT_SCORING_QUICK_REFERENCE.md)

**ARTIFACT_SCORING_REFERENCE.md**
→ Go to: [ARTIFACT_SCHEMAS.md](./ARTIFACT_SCHEMAS.md)

**HOST_SETUP_STAGES.md**
→ Go to: [HOST_SETUP_API_REFERENCE.md](./HOST_SETUP_API_REFERENCE.md)

**HOST_SETUP_TROUBLESHOOTING.md**
→ Go to: [HOST_SETUP_API_REFERENCE.md](./HOST_SETUP_API_REFERENCE.md)

**EVALUATION_IMPROVEMENTS_ROLLOUT.md**
→ Go to: [EVALUATION_BEST_PRACTICES.md](./EVALUATION_BEST_PRACTICES.md)

**QUICK_REF_TEST_ISOLATION.md**
→ Go to: [TEST_ISOLATION_BEST_PRACTICES.md](./TEST_ISOLATION_BEST_PRACTICES.md)

**TEST_ENVIRONMENT_POLLUTION_POSTMORTEM.md**
→ Go to: [TEST_ISOLATION_BEST_PRACTICES.md](./TEST_ISOLATION_BEST_PRACTICES.md)

---

## Why Consolidate?

### Benefits

1. **Reduced Cognitive Load**: Fewer files to search through
2. **Single Source of Truth**: Less confusion about where to find information
3. **Easier Maintenance**: Update one place instead of multiple docs
4. **Better Organization**: Topics grouped by audience/purpose
5. **Historical Preservation**: Archived docs are still available via `archive/`
6. **Clearer Navigation**: INDEX.md and DOCS_CONSOLIDATION_MAP.md guide users

### What's NOT Consolidated?

- Core concept docs remain separate (DEVELOPMENT, QUALITY_GATES, etc.)
- Audience-specific guides (for developers, DevOps, etc.) stay separate
- Multi-purpose reference docs (ENV_VARS, API, CLI) remain separate
- Research/investigation docs → archived, not deleted

---

## Accessing Archived Documentation

All archived documentation is preserved in `docs/archive/` for historical reference.

**To view archived docs**:

```bash
# List all archived files
ls -la docs/archive/

# Search archived content
grep -r "search-term" docs/archive/

# View a specific archived doc
cat docs/archive/FEATURE3_README.md
```

**Why archive instead of delete?**

- Historical context: Investigation reports provide decision-making rationale
- Completed features: Archive serves as reference for past work
- Legacy paths: Users may link to old docs; archive preserves them
- Git history: Files remain in version control for full audit trail

---

## Consolidation Metrics

| Metric | Value |
|--------|-------|
| **Before** | 70+ markdown files |
| **After** | 50 core + 36 archived = 86 total |
| **Main Docs Reduction** | 28% fewer active files |
| **Consolidation Groups** | 6 topics merged |
| **Archived Files** | 36 historical/completed docs |
| **Cross-Links Updated** | All internal references updated |

---

## Future Maintenance

### Adding New Documentation

1. Check if content fits in an existing doc
2. If new topic: Add to appropriate category in docs/
3. Update INDEX.md with new content
4. Add cross-references to DOCS_CONSOLIDATION_MAP.md

### Deprecating Existing Documentation

1. Identify consolidated content or archived topic
2. Merge content into appropriate master doc
3. Move to `archive/` with explanatory comment
4. Update DOCS_CONSOLIDATION_MAP.md
5. Add deprecation notice to old doc if still visible

### Maintaining Consistency

- All goal-setting info → GOAL_SETTING_GUIDE.md
- All artifact schemas → ARTIFACT_SCHEMAS.md or ARTIFACT_SCORING_QUICK_REFERENCE.md
- All host setup → HOST_SETUP_API_REFERENCE.md
- All test isolation → TEST_ISOLATION_BEST_PRACTICES.md
- All evaluation → EVALUATION_BEST_PRACTICES.md

---

## Questions or Issues?

- **Can't find something?** Check DOCS_CONSOLIDATION_MAP.md (this file)
- **Looking for old content?** Try `docs/archive/`
- **Need to consolidate more?** Follow the patterns in this consolidation

---

**Last Updated**: September 2026
**Consolidation Status**: Complete ✅
**Next Review**: As new documentation is added
