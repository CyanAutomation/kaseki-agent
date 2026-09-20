# Kaseki-350 Root Cause Analysis & Fix Plan

## Executive Summary

**Run**: kaseki-350 (Failed with exit code 8)  
**Repository**: judokon-2600  
**Task**: Consolidate duplicated weights/lengths arrays from game/orchestrator to ui/constants  
**Failure**: Critical change expectations failed - required file missing: `src/ui/constants.ts`  
**Status**: 🔴 Blocking failure (false positive)

### Two Issues Identified

| Issue | Severity | Root Cause | Fix Priority |
| ------- | ---------- | ----------- | -------------- |
| **Issue #1**: Critical file missing from changed-files | 🔴 P1 | Scouting over-specified required files | P1 |
| **Issue #2**: Schema mismatch in test_impact | 🟡 P2 | Validation before normalization | P2 |

---

## Issue #1: Critical File Missing (The Blocking Failure)

### What Happened

The run failed at the "critical change verification" stage with:

```
critical_change_expectations_failed: required file missing from changed-files.txt: src/ui/constants.ts
```

### The Facts

**Scouting Output** (`critical-change-expectations.json`):

```json
{
  "required_files": [
    "src/ui/constants.ts",
    "src/game/orchestrator.ts"
  ]
}
```

**Agent's Actual Changes** (`changed-files.txt`):

```
src/game/orchestrator.ts
```

**What the Agent Did** (git.diff shows):

```diff
- Remove duplicate `const weights = [...]` from orchestrator.ts
- Remove duplicate `const lengths = [...]` from orchestrator.ts
+ Add `import { weights, lengths } from "../ui/constants";`
```

### Root Cause

The scouting phase **over-specified** which files must be modified:

1. **Scouting Assessment**: "Both files must change"
   - Reason: Task says to move/consolidate weights/lengths to constants
   - Assumption: Constants.ts export must be modified to include these

2. **Actual Requirement**: Only orchestrator.ts needs to change
   - Reason: Constants.ts already exports weights/lengths correctly
   - Work: Remove duplicates from orchestrator, add import

3. **Why the Mismatch**:
   - Scouting prompt guidance says: "required_files must contain only files that need an edit"
   - Scouting agent interpreted "consolidate to constants" as "constants file must be edited"
   - Agent correctly determined no edit to constants.ts was necessary
   - Scouting did not pre-verify whether constants.ts already exports correctly

### What Actually Should Have Happened

```
Scouting phase:
  ✓ Investigate: Does constants.ts already export weights/lengths?
  ✓ Determine: If yes, required_files = ["src/game/orchestrator.ts"]
  ✓ Determine: If no, required_files = ["src/ui/constants.ts", "src/game/orchestrator.ts"]

Agent phase:
  ✓ Confirmed: Only orchestrator.ts needed changes
  ✓ Result: changed-files.txt = ["src/game/orchestrator.ts"]

Verification:
  ✓ changed-files matches critical-change-expectations.required_files
  ✓ Run succeeds (exit 0)
```

### Why This Is a False Positive

The agent **correctly implemented the task**:

- ✅ Removed duplicate weights array from orchestrator.ts
- ✅ Removed duplicate lengths array from orchestrator.ts  
- ✅ Added proper import from ui/constants
- ✅ Code is semantically correct (weights/lengths available in orchestrator via import)

The failure is a **contract mismatch**, not a semantic failure. The scouting specification was wrong, not the agent's execution.

---

## Issue #2: Schema Mismatch in test_impact

### What Happened

Scouting validation logged 3 critical schema mismatches:

```json
{
  "timestamp": "2026-09-20T08:30:12.193Z",
  "reason_code": "schema_mismatch",
  "field": "test_impact[0]",
  "expected": "object with non-empty string path and non-empty string reason",
  "actual": "object",
  "severity": "critical"
}
```

### The Facts

**Scouting.json** (final artifact) contains valid test_impact:

```json
{
  "path": "src/game/orchestrator.test.ts",
  "reason": "Tests orchestrator.draw, next, handleSetupStepClick which depend on weights/lengths for seed hashing and target indexing"
}
```

**Scouting Validation Errors** show missing path/reason fields for all 3 test_impact entries.

### Root Cause

**Pipeline ordering issue**: Validation runs **before** normalization

Current flow:

```
1. Pi produces scouting.json (some entries may be incomplete)
2. Validator checks raw JSON
   → Finds test_impact[0] is {type: "...", ...} without path/reason
   → Logs schema_mismatch (severity: critical)
3. Normalizer fixes the incomplete entries
   → Reconstructs test_impact with proper path and reason
4. Final artifact is valid
   → But error logs remain
```

### Why This Causes Confusion

- ❌ Error log says "schema_mismatch" and "critical"
- ✅ But final artifact is actually valid
- ❌ Diagnostic confusion: looks like validation failed, but run continued
- ❌ False alarm in monitoring systems

### Why It Happens

The scouting Pi output initially produces incomplete test_impact entries (perhaps without path/reason fields initially), and then normalization code reconstructs them. The validation catches the **intermediate** state, not the final state.

---

## Fix Strategy

### Fix #1: Improve Scouting Prompt (P1 - Quick Win)

**File**: `templates/scouting/base.txt` and `templates/scouting/common.txt`

**Problem**: Scouting guidance doesn't clearly distinguish between:

- Files that **must be modified** (required_files)
- Files that **may already be correct** (no edit needed)
- Files that **need verification** (might not need changes)

**Solution**: Add clear guidance with examples

```markdown
CRITICAL GUIDANCE FOR required_files:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The required_files array will be compared against changed-files.txt after 
the agent runs. EVERY entry in required_files MUST appear in changed-files.txt.

✓ CORRECT USAGE:
  - Task: "Add validation to UserSchema in src/models/user.ts"
    → required_files: ["src/models/user.ts"] (this file must be edited)
  
  - Task: "Consolidate duplicate weights array to utils/constants.ts"
    → First verify: Does utils/constants.ts already export weights correctly?
    → If YES: required_files: ["src/game/orchestrator.ts"] (remove duplicates here)
    → If NO: required_files: ["src/utils/constants.ts", "src/game/orchestrator.ts"]

✗ INCORRECT USAGE:
  - Listing a file that already satisfies the requirement without needing edits
  - Listing a file you examined but didn't modify
  - Listing files merely related to the change

RULE: Pre-verify critical files before adding to required_files.
If a file already has the correct code, DON'T add it to required_files.
```

### Fix #2: Reorder Validation Pipeline (P2 - Code Quality)

**File**: `kaseki-agent.sh` lines 9350-9550  
**File**: `scripts/scouting-allowlist.ts` lines 280-420

**Current Flow**:

```
Parse JSON
  → Validate (check schema)
    → Normalize (fix common issues)
      → Return artifact
```

**New Flow**:

```
Parse JSON
  → Normalize (fix common issues)
    → Validate (check schema on normalized version)
      → Return artifact
```

**Benefits**:

- Schema validation only reports actual issues
- Spurious "schema_mismatch_recovered" errors disappear
- Cleaner audit trail

**Implementation**:

1. Move `validateScoutingArtifactObject()` call to after normalization
2. Update error logging to distinguish:
   - `schema_mismatch_pre_normalization` (was recoverable)
   - `schema_mismatch_post_normalization` (real error)

### Fix #3: Goal-Check Override for File Mismatches (P1 - Semantic Safety)

**File**: `src/goal-check/` or `kaseki-agent.sh` lines 10000-10200

**Concept**: If critical change expectations fail due to file mismatch, consult the goal-check evaluator:

```javascript
if (criticalChangeFailed && failureReason.includes("required file missing")) {
  // Agent run succeeded, validation passed
  // But file-list doesn't match scouting expectations
  
  if (goalCheckPhase.verdict === "met") {
    // Goal-check semantically verified the task is complete
    // Override the file-list contract mismatch
    OVERRIDE_CRITICAL_CHANGE_FAILURE = true;
    EXIT_CODE = 0; // Success
    LOG_REASON = "File expectation overridden by semantic goal-check validation";
  }
}
```

**Benefits**:

- Reduces false positives (agent did the right thing, scouting was wrong)
- Maintains safety (goal-check evaluates semantic correctness)
- Allows runs to succeed when they should

**Implementation**:

1. After `verify_critical_change_expectations()` fails
2. Check if goal-check phase completed
3. If goal-check.verdict === "met", override failure
4. Log override reason in metadata
5. Set exit code 0

### Fix #4: New Schema Field for Pre-Verified Files (P2 - Optional)

**File**: `templates/scouting/base.txt`, validation schema, etc.

**Concept**: Add optional field to distinguish:

```json
{
  "critical_change_expectations": {
    "required_files": ["files that must be modified"],
    "verified_files": ["files verified as correct (no changes needed)"],
    "required_search_strings": [...],
    "forbidden_empty_diff": false
  }
}
```

**Benefits**:

- Scouting can communicate "I checked this file and it's already good"
- Clearer intent
- Allows downstream validation to understand pre-checks

**Note**: This is lower priority since fixes #1-3 already address the issue.

---

## Implementation Priority & Timeline

### Phase 1: Immediate Fix (P1 - 2-4 hours)

✅ **Goal**: Prevent recurrence of kaseki-350 failure

1. Update scouting prompts (templates/scouting/base.txt, common.txt)
   - Add clear "required_files must be files that NEED edits" guidance
   - Add examples of correct vs incorrect usage
   - Emphasize pre-verification of critical files

2. Implement goal-check override logic
   - If critical change fails due to missing file AND goal-check passed → override
   - Exit 0 instead of exit 8

**Result**: kaseki-350 would now succeed (semantic goal-check validation confirms task is complete)

### Phase 2: Code Quality (P2 - 2-3 hours)

✅ **Goal**: Clean up diagnostic noise (test_impact schema mismatch)

1. Reorder validation pipeline in kaseki-agent.sh
   - Validate AFTER normalization, not before
   - Update error codes

2. Update scripts/scouting-allowlist.ts
   - Move validation to post-normalization
   - Distinguish recovered vs real schema issues

**Result**: Scouting validation errors only log real problems, not recovered ones

### Phase 3: Enhanced Expressiveness (P3 - Optional)

✅ **Goal**: Better scouting → agent contract

1. Add verified_files field to critical_change_expectations
2. Update schema validator
3. Update documentation

**Result**: Scouting can pre-declare "I checked these files, they're correct"

---

## Validation & Testing

### New Test Cases

**Test Case 1: Over-Specified File in required_files**

```bash
# Scenario: Scouting expects constants.ts to change, but agent correctly determines no change needed
# Setup: Create repo where constants.ts already has required exports
# Run: Scouting phase, agent phase, verification
# Expected: 
#   - Scouting marks both files as required
#   - Agent changes only orchestrator.ts
#   - Goal-check confirms task complete
#   - Exit 0 (success, not exit 8)
```

**Test Case 2: Validation Order**

```bash
# Scenario: Scouting produces test_impact entries that need normalization
# Setup: Create scouting.json with incomplete test_impact
# Expected:
#   - Normalize first (fix incomplete entries)
#   - Validate second (only report real issues)
#   - No spurious schema_mismatch errors for recovered entries
```

**Test Case 3: Goal-Check Override**

```bash
# Scenario: Critical change fails (file missing), but goal-check passes
# Setup: Run complete flow with mismatched file expectations
# Expected:
#   - critical_change_expectations_failed initially
#   - Goal-check validates task is complete
#   - Override applied, exit 0
```

### Files to Update

1. **Tests**:
   - `tests/goal-check-critical-change-expectations.test.sh` — Add file-mismatch override test
   - `tests/scouting-allowlist-cli.test.ts` — Add validation-order test

2. **Documentation**:
   - `docs/SCOUTING_PROMPT_DESIGN.md` — Document required_files best practices
   - `docs/QUALITY_GATES.md` — Explain critical-change contract and goal-check override

---

## Affected Files Summary

### Changes Required

| File | Change | Type |
| ------ | -------- | ------ |
| `templates/scouting/base.txt` | Add required_files guidance | Content |
| `templates/scouting/common.txt` | Add examples | Content |
| `kaseki-agent.sh` | Goal-check override logic | Code (P1) |
| `kaseki-agent.sh` | Validation pipeline reorder | Code (P2) |
| `scripts/scouting-allowlist.ts` | Post-normalization validation | Code (P2) |
| Tests (see above) | Add test cases | Tests |
| Documentation | Update guides | Docs |

### No Changes Needed

- ✅ Agent logic (agent correctly imported from constants)
- ✅ Critical-change verification (working as designed)
- ✅ Goal-check logic (evaluator working correctly)
- ✅ Schema validator itself (logic is correct, just timing issue)

---

## Prevention Going Forward

### Scouting Agent Guidance

Update scouting prompt to require:

1. **Pre-verification**: Check if required files already exist with correct content
2. **Minimal specification**: Only list files that MUST be modified
3. **Clear rationale**: For each required_file, explain why modification is necessary

### Validation Checkpoints

Add check in scouting validator:

```
For each file in required_files:
  - Must be repo-relative path (already validated)
  - Should not be in suggested_allowlist (new check)
  - If file exists and has no visible issue, require explicit explanation
```

### Run-Time Safety

Implement goal-check override as default behavior:

```
if (critical_change_failed && goal_check_passed) {
  // Scouting specification was wrong, but agent got it right
  // Goal-check semantically validates the result
  // Override and succeed
}
```

---

## Recommendation

**Implement all three fixes**:

1. ✅ **Fix #1 (P1)**: Update scouting prompts — Low effort, high value
2. ✅ **Fix #3 (P1)**: Goal-check override — Addresses root issue semantically  
3. ✅ **Fix #2 (P2)**: Validation pipeline — Code quality improvement

**This will**:

- ✅ Allow kaseki-350 to succeed (if re-run)
- ✅ Prevent similar false positives
- ✅ Improve diagnostic clarity
- ✅ Maintain semantic safety (goal-check validates)
- ✅ Reduce false-positive blocking

---

## Appendix: Technical Details

### Schema Validation Location

[scripts/scouting-allowlist.ts](scripts/scouting-allowlist.ts):

- `validateScoutingArtifactObject()` - Main validator (line 284)
- `validateTestImpactArray()` - test_impact schema (line 155)
- `normalizeSuggestedAllowlistArtifact()` - Normalizer (line 246)

### Critical Change Verification Location

[kaseki-agent.sh](kaseki-agent.sh):

- `derive_critical_change_expectations()` - Extract from artifacts (line 2539)
- `verify_critical_change_expectations()` - Verify against changed-files (line 2688)
- Error trigger - Lines 10072-10163

### Goal-Check Integration Point

[kaseki-agent.sh](kaseki-agent.sh):

- Goal-check runs post-validation (around line 9950)
- Override would be inserted after verification failure checks (around line 10090)
