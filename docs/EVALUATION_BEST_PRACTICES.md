# Evaluation Best Practices for Kaseki-Agent

**Status**: Aligned with [OpenAI's Codex guidance](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) on goal-oriented code generation

This document provides best practices for the **goal-check** and **run-evaluation** phases, ensuring evaluators produce high-quality, evidence-backed verdicts that improve agent outcomes and provide actionable feedback for the Kaseki system.

---

## Why Evaluation Matters

Well-formed evaluations do three critical things:

1. **Ensure agent success criteria were met** — Goal-check provides a safety net for agents to retry if requirements were missed
2. **Provide transparency to reviewers** — Run-evaluation gives humans confidence that changes are trustworthy
3. **Feed improvement loops** — Evaluation outcomes should inform goal-setting quality scoring and Kaseki process optimization

Weak evaluations undermine all three. Overly confident evaluations with vague evidence disable retries. Overly cautious evaluations with unclear root causes prevent learning.

---

## Part 1: Goal-Check Evaluation Best Practices

The **goal-check agent** determines whether the coding agent successfully realized the objectives from the scouting report.

### What Is a Good Goal-Check Evaluation?

A high-quality goal-check evaluation has these characteristics:

#### 1. **Clear Boolean Verdict**

- ✅ Good: `"met": true, "confidence": "high"` + 3+ pieces of evidence from changed files
- ✅ Good: `"met": false, "confidence": "high"` + 2+ specific unmet requirements + concrete retry guidance
- ❌ Poor: `"met": true, "confidence": "medium"` (no explanation for uncertainty)
- ❌ Poor: `"met": false, "confidence": "low"` (evaluator doesn't know what to fix)

**Why**: Boolean verdicts trigger automatic retries only when confidence is sufficient. Unclear confidence wastes agent cycles or misses real failures.

#### 2. **Evidence-Based, Not Opinionated**

Evidence must cite **specific artifacts**, not general impressions.

- ✅ Good evidence:

  ```json
  "evidence": [
    "parseRole() now handles null input and returns 'Unnamed Role' (line 45-52 in src/parser.ts)",
    "5 new edge-case tests added: test-null-role, test-empty-role, test-long-name, test-special-chars, test-unicode (lines 120-175 in tests/parser.test.ts)",
    "All 127 test cases pass (validation.log shows 0 failures)"
  ]
  ```

- ❌ Poor evidence:

  ```json
  "evidence": [
    "The parser was fixed",
    "Tests were added",
    "Everything works"
  ]
  ```

**Why**: Specific evidence is verifiable. It helps downstream PR reviewers validate the verdict and supports learning (goal-setting feedback uses evidence to calibrate goal quality).

#### 3. **SMART-Aligned Requirement Checking**

Goal-setting produces SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound). Goal-check should validate against these explicitly.

- ✅ Good: Check each SMART dimension:

  ```json
  "evidence": [
    "✓ Specific: parseRole() modified specifically (not entire module)",
    "✓ Measurable: 5 edge cases verified in test output",
    "✓ Achievable: Completed in single coding attempt",
    "✓ Relevant: Core requirement from scouting",
    "✓ Time-bound: Validation passed on first try"
  ]
  ```

- ❌ Poor: Generic pass/fail without SMART breakdown

#### 4. **Actionable Retry Guidance** (when `met=false`)

If requirements are unmet, the `retry_prompt` must guide the next attempt concretely.

- ✅ Good retry prompt:

  ```json
  "retry_prompt": "parseRole() now returns 'Unnamed Role' for null input, addressing the specific requirement. However, test coverage remains incomplete: 2 cases are still missing (unicode symbols, 100+ char names). Add tests for these two cases to fully meet the measurable criterion of '5 edge-case tests'."
  ```

- ❌ Poor retry prompt:

  ```json
  "retry_prompt": "Try again, the tests didn't pass"
  ```

**Why**: Actionable guidance accelerates convergence. Vague guidance wastes retry attempts.

#### 5. **Confidence Grounding**

Confidence (`low`, `medium`, `high`) should map to explicit criteria.

- ✅ Good confidence grounding:
  - `high`: >4 specific evidence items + all SMART dimensions met OR clear unmet requirements with fix path
  - `medium`: 2-3 evidence items + most SMART dimensions met OR unmet requirements but unclear fix path
  - `low`: <2 evidence items OR contradictory signals OR evaluator uncertainty

- ❌ Poor: Random confidence without justification

**Why**: Confidence drives retry logic. Over-confident low verdicts waste agent cycles. Under-confident high verdicts prevent progress.

#### 6. **Validation Context Awareness**

Goal-check should account for which validation commands passed/failed.

- ✅ Good:

  ```json
  "validation_notes": [
    "npm run test: 127 tests pass (was 125 before)",
    "npm run build: SUCCESS (newly required by goal)",
    "npm run lint: 0 errors"
  ]
  ```

- ❌ Poor: Empty or generic validation notes

---

### Goal-Check Decision Tree

```
┌─ Did agent make changes? ────► NO → "met: false, confidence: high"
│                                      "missing: ['Agent did not make required changes']"
│
└─ YES ──┬─ Do all SMART criteria align with changed code? ──► NO → "met: false, confidence: medium/high"
         │                                                          "missing: [specific unmet dimensions]"
         │                                                          "retry_prompt: [targeted guidance]"
         │
         └─ YES ──┬─ Do validation commands pass? ──► NO → Check if failures are pre-existing
                  │                                        If new failures: "met: false, confidence: high"
                  │                                        If pre-existing: "met: true, confidence: medium"
                  │
                  └─ YES ──► "met: true, confidence: high/medium"
                            (confidence depends on evidence strength)
```

---

### Common Goal-Check Anti-Patterns

| Anti-Pattern | Why It's Bad | How to Fix |
|---|---|---|
| "Tests pass so goal is met" (no evidence of what was fixed) | Doesn't verify requirements were addressed, just that code runs | Cite specific changed functions, test cases, or diff sections |
| `confidence: "medium"` without explanation | Signals to retry even on success | Use "medium" only when some SMART dimensions are unclear; explain why |
| Retry prompt that repeats the original goal | Doesn't guide the next attempt | Reference specific unmet requirements and suggest concrete fix |
| Evidence from unmodified test files | May indicate agent didn't actually implement changes | Check diff to verify new tests were added or existing ones modified |
| Ignoring validation failures | May mask regressions | Include validation outcomes in confidence calculation |

---

## Part 2: Run-Evaluation Best Practices

The **run-evaluation agent** is task-agnostic. It assesses process quality, reviewer confidence, and identifies Kaseki improvement opportunities.

### What Is a Good Run-Evaluation?

#### 1. **Calibrated Reviewer Confidence**

`reviewer_confidence` should reflect human trust in merging changes without manual review.

- ✅ `high`: Goal was high-quality + goal-check met=true with high confidence + validation passed + diff is small/focused
- ✅ `medium`: Goal was medium-quality OR goal-check met=true with medium confidence OR validation mostly passed
- ✅ `low`: Goal was low-quality OR goal-check unmet OR validation failed OR diff is large/unfocused

**Why**: This drives PR merge speed. Miscalibration either blocks valuable changes or allows risky merges.

#### 2. **Task-Completion Score Tied to Goal Quality**

`task_completion_score` (1-5) should reference the original goal's SMART dimensions.

- ✅ Good:

  ```json
  "task_completion_score": 5,
  "summary": "All SMART criteria met: parseRole() now handles null (specific), 5 edge tests pass (measurable), single run (achievable), validation passes (achievable)"
  ```

- ❌ Poor:

  ```json
  "task_completion_score": 3,
  "summary": "Good progress"
  ```

#### 3. **Stage Value Assessment** (not effort, but value)

For each stage (goal-setting, scouting, coding, validation, goal-check), assess its value to the final outcome.

- ✅ High value:
  - Scouting found a critical edge case that shaped coding focus
  - Goal-check identified an unmet requirement, enabling a successful retry
  - Validation caught a regression

- ✅ Medium value:
  - Stage completed without major issues
  - Provided baseline context but didn't change direction

- ✅ Low value:
  - Stage produced minimal new signals
  - Could have been skipped without affecting outcome

**Why**: Identifies which stages to invest in optimizing vs. which to streamline.

#### 4. **Actionable Kaseki Improvements**

Suggestions must be specific and prioritized.

- ✅ Good improvement:

  ```json
  "kaseki_improvement_opportunities": [
    {
      "category": "goal_setting",
      "priority": "high",
      "suggestion": "Goal quality was 'medium' (specificity=low). Next runs should emphasize scope clarity: clearly separate 'fix parseRole()' from 'refactor error handling' if both are needed."
    },
    {
      "category": "scouting",
      "priority": "medium",
      "suggestion": "Scouting report mentioned 3 potential edge cases but coding only addressed 1. Consider having scouting rank edge cases by impact or include examples."
    }
  ]
  ```

- ❌ Poor improvement:

  ```json
  "kaseki_improvement_opportunities": [
    {
      "category": "general",
      "priority": "medium",
      "suggestion": "Do better"
    }
  ]
  ```

#### 5. **Human Review Focus**

What should humans manually review, given what Kaseki already checked?

- ✅ Good human focus:

  ```json
  "human_review_focus": [
    "The retry logic for null input may have side effects on callers; check parseRole(null) call sites",
    "New test file imports three new dependencies (vitest-mock-extended, faker, date-fns); verify these are acceptable"
  ]
  ```

- ❌ Poor human focus:

  ```json
  "human_review_focus": [
    "Make sure it works"
  ]
  ```

#### 6. **Confidence Transparency**

Be explicit about what you did and didn't evaluate.

- ✅ Good:

  ```json
  "warnings": [
    "Goal was low-quality (specificity=low); harder to assess true completion. Assumed parseRole() fix was primary intent based on scouting.",
    "Validation passed but test count unchanged; may indicate tests were pre-existing. Inspect diff for new tests."
  ]
  ```

- ❌ Poor: Empty warnings with high confidence

---

### Run-Evaluation Decision Tree

```
┌─ Goal quality: High ──┐
│ Scouting quality: ✓ ├─► Validation passed ──┬─ Goal-check: met=true with high conf
│ Goal-check: met ────┘                        │
│                                              ├─► reviewer_confidence: high
│                                              │   task_completion: 4-5
│                                              │
│                                              └─ Validation failed ──► reviewer_confidence: medium
│                                                                       task_completion: 2-3
│
├─ Goal quality: Medium ┐
│ Most stages OK ────────├─► All checks pass ──► reviewer_confidence: medium
│                        │   task_completion: 3
│                        │
│                        └─ Some issue ───────► reviewer_confidence: low
│                                              task_completion: 2
│
└─ Goal quality: Low ───────► Any issue ──────► reviewer_confidence: low
                                              task_completion: 1-2
```

---

### Common Run-Evaluation Anti-Patterns

| Anti-Pattern | Why It's Bad | How to Fix |
|---|---|---|
| High confidence regardless of goal quality | Ignores root cause (bad goal = hard outcome to assess) | Reference goal quality metrics in confidence reasoning |
| "Everything looks good" with zero improvement suggestions | Misses optimization opportunities | Analyze what could be better (goal specificity, scouting depth, validation rigor) |
| `human_review_focus` lists 10+ items | Dilutes importance of critical items | Prioritize to 2-4 highest-impact items |
| Ignoring goal-check verdict | May miss that agent failed and needs retry | Explicitly account for goal-check success/failure in your assessment |
| PR summary that echoes the original task | Not useful to reviewer | Summarize the *actual changes* and their impact on the goal |

---

## Part 3: Integrating Goal-Setting Context into Evaluations

Both evaluators receive goal-setting output as context (new in Phase 2 enhancements). Use it.

### Goal-Check Should Leverage

1. **SMART Criteria** — Validate each dimension was addressed
2. **Anti-Patterns** — Verify agent didn't modify `do_not_modify` files
3. **Quality Metrics** — Adjust confidence based on goal clarity/measurability
4. **Examples** — Check if "before/after" matches what agent produced

### Run-Evaluation Should Leverage

1. **Goal Quality Score** — Factor into reviewer_confidence ("low-quality goal = harder to trust outcome")
2. **SMART Dimensions** — Use for task_completion_score ("missing measurability = less clear what success looks like")
3. **Codebase Signals** — Verify changes align with repo's tech stack/patterns
4. **Anti-Patterns** — Check if agent respected `do_not_modify` constraints

---

## Part 4: Feedback Loop Integration

Evaluations feed back into two systems:

### Goal-Check Feedback → Goal Quality Scoring

After goal-check, compare its verdict against goal-setting quality metrics:

| Scenario | Feedback |
|---|---|
| Goal was `measurability=high`, but goal-check found `met=false` with specific unmet tests | Suggests goal was well-formed but scouting/coding missed requirements. Tune agent models/timeouts, not goal quality. |
| Goal was `measurability=low`, and goal-check struggled to assess completion | Suggests goal quality was true root cause. Future goals should emphasize measurable criteria. |
| Goal was `specificity=medium`, and goal-check report is vague | Suggests agent needs clearer scope boundaries. Next goals should increase specificity dimension. |

### Run-Evaluation Feedback → Kaseki Process Improvements

Run-evaluation's `kaseki_improvement_opportunities` field drives infrastructure work:

- "Goal-setting needs to emphasize X" → Add guidance to goal-setting prompt
- "Scouting missed Y" → Enhance scouting prompt or codebase context
- "Validation command Z would catch this class of error" → Add Z to default validation commands

**Not** goal quality feedback — focus on process.

---

## Part 5: Evaluation Confidence Calibration Worksheet

Use this to ground your confidence scores:

### Goal-Check Confidence Grounding

| Confidence | Criteria |
|---|---|
| **High** | ≥3 specific evidence items from artifacts + ≥4 SMART dimensions met (or ≥2 clear unmet + actionable fix) + Validation passed (or failures are pre-existing) |
| **Medium** | 2-3 evidence items + 3-4 SMART dimensions + Validation mostly passed + Some uncertainty remains |
| **Low** | <2 evidence items OR <3 SMART dimensions OR Validation failures + Evaluator unsure of fix |

### Run-Evaluation Confidence Grounding

| Confidence | Criteria |
|---|---|
| **High** | Goal quality ≥80 + Goal-check high + Validation passed + Diff <200 lines + Changed files ≤3 |
| **Medium** | Goal quality 60-79 OR Goal-check medium OR Validation mostly passed OR Diff 200-500 lines |
| **Low** | Goal quality <60 OR Goal-check low/unmet OR Validation failed OR Diff >500 lines OR Changed files >5 |

---

## Part 6: Review Checklist for Evaluators

Before submitting your evaluation JSON, verify:

- [ ] **Goal-Check**: Do I reference specific files/lines in evidence (not generic statements)?
- [ ] **Goal-Check**: Does my confidence match the evidence strength? (High conf requires strong evidence)
- [ ] **Goal-Check**: If `met=false`, is my `retry_prompt` actionable and specific?
- [ ] **Goal-Check**: Did I check each SMART dimension explicitly?
- [ ] **Run-Evaluation**: Does my `reviewer_confidence` account for goal quality?
- [ ] **Run-Evaluation**: Are my `human_review_focus` items prioritized to top 2-4?
- [ ] **Run-Evaluation**: Did I provide 2-3 `kaseki_improvement_opportunities` grounded in what I observed?
- [ ] **Run-Evaluation**: Is my `pr_summary` useful to a human reviewer (not just echoing the task)?
- [ ] **Both**: Did I avoid overconfidence? Do my `confidence`/`reviewer_confidence` match the evidence?
- [ ] **Both**: Did I read and reference the goal-setting output (SMART, anti-patterns, quality metrics)?

---

## References

- [OpenAI Codex Guidance: Using Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)
- [GOAL_SETTING_IMPROVEMENTS.md](GOAL_SETTING_IMPROVEMENTS.md) — Goal-setting best practices (10 improvements)
- [GOAL_SETTING_GUIDE.md](GOAL_SETTING_GUIDE.md) — How goal-setting works in Kaseki
- [FEEDBACK_LOOP_INTEGRATION.md](FEEDBACK_LOOP_INTEGRATION.md) — How evaluations feed back into the system
