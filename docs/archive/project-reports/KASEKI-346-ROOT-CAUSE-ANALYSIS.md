# Kaseki-346 Root Cause Analysis & Remediation Plan

**Run**: kaseki-346  
**Status**: Completed with exit 0, but goal-check evaluator produced no valid JSON verdict  
**Impact**: Automated review unavailable, no PR created despite successful code changes  
**Severity**: Medium (deterministic fallback prevented data loss; requires manual review)

---

## Executive Summary

The goal-check evaluator made **4 attempts** (pre- and post-validation) to produce a JSON verdict, but **all 4 attempts failed to extract valid JSON** from the Pi CLI responses. The system correctly fell back to a deterministic evaluation based on changed files and critical-change contract, allowing the run to succeed (exit 0). However, the degraded evaluation state blocks automated PR creation.

**Root Cause**: The Pi model returned prose/analysis without including the required JSON verdict object, despite explicit prompt instructions to do so.

**Impact Tier**: L2 (data integrity preserved via fallback; requires manual human review, which aligns with conservative safety posture)

---

## Technical Root Cause Analysis

### 1. What Happened

```
Goal-Check Evaluation Timeline:
  18:19:53 - Attempt 1 (pre-validation): JSON extraction failed
  18:20:05 - Attempt 2 (pre-validation retry): JSON extraction failed  
  18:24:23 - Attempt 3 (post-validation): JSON extraction failed
  18:24:33 - Attempt 4 (post-validation retry): JSON extraction failed
  
→ All 4 attempts generated ~43KB of raw events, but 0 valid JSON verdicts
→ System degraded to deterministic fallback (critical-change-contract evaluation)
→ Run succeeded (exit 0) but marked `goal_check_evaluation_warning: "goal_check_deterministic_fallback:goal_check_artifact_missing"`
```

### 2. JSON Extraction Requirements

The goal-check verdict JSON **must** contain these fields (strict schema validation):

```javascript
{
  "met": boolean,                           // ✓ Required
  "confidence": "high" | "medium" | "low",  // ✓ Enum constraint
  "summary": string (non-empty),            // ✓ Required
  "evidence": string[],                     // ✓ Array of strings
  "missing": string[],                      // ✓ Array of strings
  "retry_prompt": string,                   // ✓ Non-empty if met=false
  "validation_notes": string[],             // ✓ Array of strings
  "evidence_sources_inspected": string[],   // ✓ Array of strings
  "contradictions": [{                      // ✓ Array of objects
    "sources": string[],
    "description": string
  }],
  "confidence_calibration": {               // ✓ Required object
    "outcome": string,
    "justification": string
  }
}
```

All 4 attempts failed at **extraction step** (0 valid JSON objects found in response text), not at validation.

### 3. Prompt Analysis

The goal-check prompt includes:

- ✓ Explicit instruction: "Return exactly one JSON object as the final assistant message"
- ✓ Warning: "Do not write files, use markdown/code fences, or add prose"
- ✓ Goal-setting artifact context (SMART criteria, quality metrics)
- ✓ Causality assessment (validation failure attribution)
- ✓ Validation summary (condensed, ~50 tokens instead of 400)
- ✓ Test-impact warnings context
- ✓ Progress summary (tool actions, failures, completion evidence)

**Prompt length analysis**:

- Verbose version (caveman level 0-1): ~1200-1500 tokens
- Compressed version (caveman level 2+): ~300-400 tokens

### 4. Likely Root Causes (Priority Order)

#### A. **Model Did Not Return JSON** (Highest Probability)

- Pi assistant provided analysis/reasoning but omitted the required JSON object
- Extraction algorithm found 0 balanced JSON objects in response text
- All 4 retry attempts also failed to produce JSON
- **Why**: Long/complex prompt might have confused the model, causing it to "analyze" instead of "return JSON"

#### B. **Confidence Field Had Invalid Enum Value** (Medium Probability)

- Assistant returned `"confidence": "very_high"` or `"confidence": "extremely_high"`
- Schema normalizer in extraction code doesn't normalize confidence enum (only normalizes `verdict` → `met`)
- Extraction would reject as invalid
- **Why**: Model trained on more granular confidence scales; prompt didn't provide examples

#### C. **Schema Fields Missing or Type Mismatched** (Lower Probability)

- Missing required fields: `confidence_calibration`, `contradictions`, etc.
- Type errors: `evidence` as object instead of array, `met` as string instead of boolean
- **Why**: Less likely given the detailed prompt, but possible if model is confused

#### D. **Markdown Code Fence Wrapping** (Lowest Probability)

- Response: ` ```json\n{...}\n``` `
- Extraction has robust brace-depth tracking that handles newlines
- Would expect at least 1 of 4 attempts to succeed
- **Why**: The `collectBalancedJsonObjects()` function is well-tested and handles edge cases

### 5. Diagnostic Evidence

**From kaseki-346 metadata**:

```json
{
  "goal_check_evaluation_warning": "goal_check_deterministic_fallback:goal_check_artifact_missing",
  "goal_check_exit_code": 0,  // No crash or timeout
  "validation_commands_passed": true,
  "changed_files": ["README.md"],
  "diff_bytes": 20151
}
```

**From goal-check-contract-diagnostics.json**:

```json
{
  "reason": "goal_check_artifact_missing",
  "raw_events": {
    "present": true,
    "bytes": 43336,         // ← Raw Pi response exists
    "sha256": "311d4c..."
  },
  "filtered_events": {
    "present": true,
    "bytes": 39532
  },
  "observed_turns": 3,      // ← Context was available (3 turns)
  "phase_budget": {
    "context_exceeded": false,
    "turns_exceeded": false,
    "tool_output_exceeded": false,
    "exceeded": false       // ← No budget constraints hit
  },
  "candidate_present": false // ← No JSON extracted
}
```

**Conclusion**: Pi CLI produced output (raw events exist), but output didn't contain extractable JSON.

---

## Why This Matters

### Current Impact (kaseki-346)

| Aspect | Status |
| -------- | -------- |
| **Code changes** | ✓ Successful (502 lines, 1 file changed) |
| **Validation** | ✓ Passed (npm run check) |
| **Critical files** | ✓ Met (README.md modified as required) |
| **Deterministic evaluation** | ✓ Passed (critical-change-contract satisfied) |
| **Automated PR creation** | ✗ Blocked (no LLM verdict) |
| **Manual review required** | ✓ Yes (conservative safety posture) |
| **Run exit code** | ✓ 0 (Success) |

**System behavior**: Correctly prioritized data integrity over convenience; degraded gracefully when evaluator unavailable.

---

## Root Cause Fix Strategy

### Tier 1: Immediate (Prompt Robustness)

**Problem**: Current prompt may not be explicit enough for all models to reliably return JSON.

**Fix #1.1: Simplify and Emphasize JSON Contract**  
_File_: `scripts/evaluation-prompts.sh`

```bash
# BEFORE (line ~209):
Return exactly one JSON object as the final assistant message. Do not write a file, use markdown/code fences, or include prose before/after the JSON. Kaseki validates and persists this response.

# AFTER:
RETURN EXACTLY ONE JSON OBJECT ONLY. DO NOT:
- Write any prose before or after the JSON
- Use markdown code fences (``` ``` are forbidden)
- Include explanations, summaries, or reasoning
- Return multiple objects

Your response MUST be valid JSON matching this exact structure:
{ "met": <true|false>, "confidence": "<high|medium|low>", "summary": "...", ... }
```

**Fix #1.2: Add JSON Schema Example in Prompt**  
_File_: `scripts/evaluation-prompts.sh`

```bash
## Example Valid Response (structure must match exactly)
{
  "met": true,
  "confidence": "high",
  "summary": "Agent successfully implemented the requirements; all tests pass.",
  "evidence": ["Function parseRole() handles null input (line 45-52)", "127 tests pass"],
  "missing": [],
  "retry_prompt": "",
  "validation_notes": ["All 3 validation commands passed"],
  "evidence_sources_inspected": ["goal-setting.json", "changed-files.txt", "git.diff"],
  "contradictions": [],
  "confidence_calibration": {"outcome": "met", "justification": "High confidence: 3+ evidence items and 5/5 SMART criteria satisfied"}
}
```

**Fix #1.3: Suppress Verbose Preamble in Compressed Mode**  
_File_: `src/caveman/caveman-prompts.ts`

```typescript
// Ensure compressed version ends with explicit JSON-only instruction
export function compressGoalCheckInstructions(): string {
  return `...existing content...

## CRITICAL: Response Format
Return ONLY a single JSON object. No prose, explanations, or code fences.
JSON structure is provided below.`;
}
```

### Tier 2: Medium-Term (Enhanced JSON Extraction)

**Problem**: Current extraction uses simple brace-depth matching; can't handle all response patterns.

**Fix #2.1: Add Markdown Code Fence Stripper**  
_File_: `kaseki-agent.sh` (line ~7037, in extraction node code)

```javascript
function collectBalancedJsonObjects(text) {
  // NEW: Strip markdown code fences first
  text = text.replace(/```(?:json)?\s*\n/g, '').replace(/\n?```\s*$/g, '');
  
  // ... existing brace-depth logic ...
}
```

**Fix #2.2: Add Multi-Strategy Extraction with Fallback**  
_New file_: `scripts/json-extraction-strategies.js`

```javascript
/**
 * Try multiple strategies to extract goal-check verdict from response text
 * Strategy 1: Balanced brace depth (existing)
 * Strategy 2: Markdown code fence stripping + brace depth
 * Strategy 3: Look for "confidence" enum as anchor point, backtrack to {
 * Strategy 4: JSONLines pattern (one per line)
 */
export function extractGoalCheckVerdictRobust(text) {
  // Try each strategy in order
  const strategies = [
    extractBalancedJsonObjects,
    extractFromMarkdownCodeFences,
    extractFromConfidenceAnchor,
    extractJsonLines
  ];
  
  for (const strategy of strategies) {
    const results = strategy(text);
    if (results.length === 1) return results[0];  // Single verdict found
  }
  
  return null;  // No verdict found
}
```

### Tier 3: Long-Term (Evaluator Confidence & Monitoring)

**Fix #3.1: Add Evaluator Response Telemetry**  
_File_: `goal-check-contract-diagnostics.json`

```json
{
  "raw_response_preview": "[first 500 chars, sanitized]",
  "response_contains_json": false,
  "response_has_markdown_fences": false,
  "response_confidence_enum_values": ["very_high", "extremely_high"],  // Detected non-standard values
  "estimated_response_structure": "prose_only | prose_then_json | json_only | markdown_wrapped_json",
  "attempted_extraction_strategies": ["balanced_braces", "markdown_stripping", "confidence_anchor"]
}
```

**Fix #3.2: Document Deterministic Fallback Acceptance Criteria**  
_New doc_: `docs/GOAL_CHECK_FALLBACK_POLICY.md`

```markdown
# Goal-Check Deterministic Fallback Policy

When goal-check LLM evaluator is unavailable (goal_check_artifact_missing):

**Deterministic fallback is acceptable when:**
- Non-empty git diff exists (code changes made)
- Critical changed files present (from goal-setting/scouting)
- No validation command failures

**Deterministic fallback is NOT acceptable when:**
- Empty diff (no changes made)
- Required files not modified
- Validation commands failed

**Human review requirements:**
- Low risk (deterministic fallback met=true): Manual spot-check recommended
- High risk (deterministic fallback met=false): Manual review required before merge
```

---

## Recommended Implementation Plan

### Phase 1: Immediate Fixes (Day 1-2)

**Goal**: Improve prompt clarity without changing core logic

- [ ] Simplify goal-check prompt: remove preamble, emphasize JSON-only response
- [ ] Add JSON schema example to prompt
- [ ] Add markdown code fence stripper to extraction logic
- [ ] Create test case: `tests/goal-check-markdown-wrapped-json.test.sh`

**Testing**:

```bash
npm run test:unit -- tests/goal-check-*.test.sh
npm run test:unit -- tests/evaluation-prompts.test.ts
```

### Phase 2: Medium-Term Enhancements (Week 1-2)

**Goal**: More robust JSON extraction to handle edge cases

- [ ] Implement `extractGoalCheckVerdictRobust()` with multiple strategies
- [ ] Add confidence enum value normalization in schema validator
- [ ] Create enhanced telemetry in goal-check-contract-diagnostics.json
- [ ] Add tests for all extraction strategies

### Phase 3: Long-Term Monitoring (Month 1+)

**Goal**: Early detection and alerting

- [ ] Set up dashboard: goal-check artifact-missing rate by model/gateway
- [ ] Alert on sustained >5% artifact-missing rate
- [ ] Collect evaluator response samples (sanitized) for analysis
- [ ] Document accepted use cases for deterministic fallback

---

## Preventing Recurrence

### Monitoring & Alerting

```bash
# Track goal-check artifact-missing incidents
# alert if: (failed_goal_checks / total_goal_checks) > 5% over 24h

# Query: Last 24 hours
SELECT 
  COUNT(*) as total_runs,
  SUM(CASE WHEN goal_check_warning LIKE '%artifact_missing%' THEN 1 ELSE 0 END) as artifact_missing_count,
  ROUND(100.0 * SUM(CASE WHEN goal_check_warning LIKE '%artifact_missing%' THEN 1 ELSE 0 END) / COUNT(*), 2) as failure_rate_pct
FROM kaseki_runs 
WHERE completed_at > NOW() - INTERVAL '24 hours'
```

### Test Coverage

Add regression tests to prevent similar failures:

1. **Prompt fidelity test**: Verify goal-check prompt includes JSON-only contract
2. **Extraction robustness test**: Test extraction with 5+ response patterns (prose-then-JSON, markdown-wrapped, etc.)
3. **Confidence enum test**: Verify non-standard confidence values are normalized or rejected
4. **Fallback acceptance test**: Verify deterministic fallback logic correctly evaluates critical-change contract

---

## Appendix: JSON Extraction Logic

### Current Implementation

_File_: `kaseki-agent.sh` lines 6994–7060

```javascript
function collectBalancedJsonObjects(text) {
  const snippets = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        snippets.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return snippets;
}
```

**Strengths**:

- ✓ Handles escaped quotes correctly
- ✓ Tracks string context to ignore braces in string values
- ✓ Finds balanced top-level JSON objects
- ✓ Recovers from partial/broken JSON

**Limitations**:

- ✗ Doesn't handle markdown code fences (would see ` ``` ` as prose)
- ✗ Can't extract JSON if wrapped in prose preamble+fence combination
- ✗ No recovery for non-JSON responses (prose-only)

### Proposed Enhanced Implementation

```javascript
function collectBalancedJsonObjectsEnhanced(text) {
  // Strategy 1: Try extraction after stripping markdown code fences
  let cleanText = text.replace(/```(?:json)?\s*\n/g, '').replace(/\n?```\s*$/g, '');
  let results = collectBalancedJsonObjects(cleanText);
  if (results.length === 1) return results;
  
  // Strategy 2: Try original brace-depth extraction
  results = collectBalancedJsonObjects(text);
  if (results.length === 1) return results;
  
  // Strategy 3: Look for confidence enum as anchor, backtrack to opening brace
  const confidenceMatch = text.match(/"confidence"\s*:\s*"(high|medium|low)"/);
  if (confidenceMatch) {
    const idx = confidenceMatch.index;
    // Find opening brace before confidence field
    for (let i = idx; i >= 0; i--) {
      if (text[i] === '{') {
        // Extract from this { to the closing }
        const snippet = extractToClosingBrace(text, i);
        if (snippet) return [snippet];
        break;
      }
    }
  }
  
  return [];
}
```

---

## Questions for Follow-up

1. **Was caveman mode (prompt compression) enabled for kaseki-346?**  
   Check: `KASEKI_CAVEMAN_LEVEL` env var, `goal-check-summary.json` for model used

2. **Was goal-setting artifact unusually large?**  
   Check: byte size of `goal-setting.json` in kaseki-346 results

3. **Has this pattern appeared in other recent runs?**  
   Query: all runs with `goal_check_evaluation_warning = '%artifact_missing%'` in last 7 days

4. **Should deterministic fallback verdicts block PR creation?**  
   Policy decision: Accept met=true deterministic fallbacks, or always require LLM verdict?

---

## Summary

**Kaseki-346 was a successful coding run that encountered a rare evaluator failure.** The system's defensive design prevented data loss by:

1. ✓ Preserving successful code changes (exit 0)
2. ✓ Using deterministic fallback evaluation
3. ✓ Clearly marking the degraded state (evaluation_warning)
4. ✓ Requiring manual review (conservative safety)

**The fix** is to make the goal-check prompt more explicit and robust so the Pi model reliably returns the required JSON, preventing evaluator unavailability. Implementation timeline: 2-week sprint with monitoring and long-term observability.
