# Evaluation Enhancements Rollout Checklist

**Status**: Phase 1 & 2 Complete (May 2026)  
**Target**: Full rollout with monitoring enabled  

This document guides deployment of the evaluation prompt enhancements and feedback loop integration, ensuring smooth adoption and quality monitoring.

---

## Phase 1: Foundation (✅ Complete)

### Documentation & Best Practices Framework

- [x] Create [docs/EVALUATION_BEST_PRACTICES.md](../docs/EVALUATION_BEST_PRACTICES.md)
  - SMART framework for goal-check evaluation
  - Confidence grounding guidance
  - Anti-patterns and examples
- [x] Create [docs/FEEDBACK_LOOP_INTEGRATION.md](../docs/FEEDBACK_LOOP_INTEGRATION.md)
  - Feedback data flow and schema
  - Correlation analysis methodology
  - Example feedback loops
- [x] Update [docs/GOAL_SETTING_GUIDE.md](../docs/GOAL_SETTING_GUIDE.md)
  - Cross-reference evaluation phases
  - Show how goal quality feeds into evaluation
- [x] Update [CONTRIBUTING.md](../CONTRIBUTING.md)
  - Section 6: Evaluation best practices for contributors
  - PR checklist for evaluation changes

---

## Phase 2: Prompt Enhancement (✅ Complete)

### Goal-Check Prompt Improvements

- [x] Include goal-setting artifact in prompt context
  - Provides SMART criteria, quality metrics, anti-patterns
  - File: `build_goal_check_prompt()` in kaseki-agent.sh (line ~3116)
- [x] Add SMART framework validation instructions
  - Explicit guidance to check each SMART dimension
  - Map dimensions to evidence requirements
- [x] Add confidence grounding guidance
  - Clear mapping: high/medium/low confidence → evidence count
  - Prevent over/under-confidence
- [x] Require specific, verifiable evidence
  - Reference files, line numbers, test results
  - Reject generic statements
- [x] Guide retry_prompt structure
  - Reference unmet SMART dimensions
  - Provide actionable next steps

### Run-Evaluation Prompt Improvements

- [x] Include goal-setting artifact for quality context
  - File: `build_run_evaluation_prompt()` in kaseki-agent.sh (line ~3374)
- [x] Guide reviewer_confidence calculation
  - Account for goal quality
  - Provide grounding worksheet
- [x] Define task_completion_score framework
  - Tied to SMART criteria
  - Explicit 1-5 scale with criteria
- [x] Add stage value assessment framework
  - Value vs effort distinction
  - Examples of high/medium/low value
- [x] Structure kaseki improvement suggestions
  - Categories (goal_setting, scouting, coding, validation, etc.)
  - Priority levels (high, medium, low)
  - Actionable and specific guidance
- [x] Add confidence transparency expectations
  - Require warnings if confidence is uncertain
  - Justify high confidence verdicts

### Feedback Collection & Analysis

- [x] Create [scripts/collect-feedback.js](../scripts/collect-feedback.js)
  - Collects goal-check feedback (quality → verdict correlation)
  - Collects run-evaluation feedback (improvement suggestions)
  - Outputs JSONL format for append
- [x] Create [scripts/analyze-goal-feedback.js](../scripts/analyze-goal-feedback.js)
  - Analyzes feedback across multiple runs
  - Computes success rate by goal quality bucket
  - Generates recommendations
- [x] Integrate feedback collection in kaseki-agent.sh
  - `collect_goal_check_feedback()` after goal-check phase
  - `collect_run_evaluation_feedback()` after run-evaluation phase
  - Append to `/results/goal-feedback.jsonl` and `/results/kaseki-improvements.jsonl`

### Testing & Documentation

- [x] Create [tests/evaluation-prompts.test.ts](../tests/evaluation-prompts.test.ts)
  - Verify goal-setting context is included
  - Verify SMART framework mention
  - Verify confidence grounding guidance
  - Verify schema validation remains intact
  - Verify feedback collection integration

---

## Phase 3: Pilot Deployment & Monitoring

### Before Rollout to Production

**Minimum Requirements**:

- [ ] Test suite passes: `npm run test:unit -- tests/evaluation-prompts.test.ts`
- [ ] No regressions in existing goal-check/run-evaluation tests
- [ ] 5+ test runs completed successfully with new prompts
- [ ] Manual review of 3 sample goal-check and run-evaluation outputs
  - Verify evidence quality is improved
  - Confirm confidence grounding makes sense
  - Check that SMART framework is being used

### Monitoring During Pilot

**Data Collection**:

1. **Feedback Quality**
   - Are goal-check verdicts including 3+ evidence items? (target: >80%)
   - Are confidence levels justified? (target: >85% correct verdicts)
   - Are retry prompts actionable? (subjective review)

2. **Goal Quality Impact**
   - Success rate for high-quality goals (≥85 score): Target >80%
   - Success rate for low-quality goals (<60 score): Baseline capture
   - Correlation strength: Does goal quality predict success?

3. **Run-Evaluation Quality**
   - Reviewer confidence distribution (high/medium/low)
   - Kaseki improvement suggestions submitted: count & categories
   - PR merge speed impact: Are humans trusting evaluations?

**Measurement Commands**:

```bash
# Analyze collected feedback after 20+ runs
node scripts/analyze-goal-feedback.js /results/goal-feedback.jsonl

# Sample output:
# - High-quality goals: 87% success (4/5 runs)
# - Medium-quality goals: 62% success (5/8 runs)
# - Low-quality goals: 31% success (1/3 runs)
# Recommendations: "Goal quality is primary success predictor"
```

### Go/No-Go Decision Criteria

**Go** if:

- ✅ Test suite passes (>95% success rate)
- ✅ Manual review of 3 samples shows improved clarity
- ✅ Zero regressions in existing evaluation functionality
- ✅ Feedback collection works without errors
- ✅ Initial correlation analysis shows clear signal

**No-Go** if:

- ❌ Feedback collection fails >10% of runs
- ❌ Manual review shows no improvement (or regression) in evaluation quality
- ❌ Evaluator prompts cause token limit issues
- ❌ Correlation analysis shows weak signal
- ❌ Breaking changes to existing outputs detected

---

## Phase 4: Production Rollout

### Feature Flag Strategy

Evaluation enhancements are **enabled by default** but can be disabled per-run:

```bash
# Disable goal-check feedback collection (if issues detected)
export KASEKI_GOAL_CHECK_FEEDBACK=0
./run-kaseki.sh

# Disable run-evaluation feedback collection
export KASEKI_RUN_EVALUATION_FEEDBACK=0
./run-kaseki.sh
```

### Rollout Stages

**Stage 1: Early Adopters (Week 1)**

- Deploy to internal test instances
- Monitor feedback quality metrics
- Collect 50+ runs of data
- Daily review of correlation analysis

**Stage 2: Gradual Rollout (Week 2-3)**

- Enable for 25% of production runs
- Monitor error rates and user feedback
- A/B comparison: new vs. old evaluation quality
- Publish preliminary correlation findings

**Stage 3: Full Rollout (Week 4+)**

- Enable for 100% of production runs
- Maintain continuous monitoring dashboard
- Address any edge cases discovered
- Publish final correlation analysis

### Monitoring Dashboard (Future Capability)

Dashboard should track:

```
Goal Quality → Success Rate Correlation
┌─────────────────────────────────────┐
│ Goal Quality Buckets:              │
│ High (≥85):   87% success (4/5)    │
│ Medium (60-84): 62% success (5/8)  │
│ Low (<60):    31% success (1/3)    │
│                                     │
│ 💡 Primary success predictor       │
│    Recommend: Focus on goal quality│
└─────────────────────────────────────┘

Evaluator Confidence Calibration
┌─────────────────────────────────────┐
│ Confidence=High: 92% correct        │
│ Confidence=Medium: 68% correct      │
│ Confidence=Low: 45% correct         │
│                                     │
│ ✅ High confidence is reliable     │
│ ⚠️ Low confidence needs review     │
└─────────────────────────────────────┘

Kaseki Improvements Submitted
┌─────────────────────────────────────┐
│ Category          High  Med  Low   │
│ goal_setting      12    8    4     │
│ scouting          8     6    2     │
│ validation        5     3    1     │
│ process           2     1    0     │
│                                     │
│ → Prioritize goal_setting work     │
└─────────────────────────────────────┘
```

---

## Phase 5: Continuous Improvement

### Feedback Loop Closure

After 100+ runs, analyze:

1. **Goal Quality Impact**
   - Correlation: goal quality → success rate
   - Strongest predictive dimensions (clarity vs measurability vs specificity)
   - ROI: time to improve goals vs success rate gain

2. **Evaluator Effectiveness**
   - Confidence calibration: are predictions accurate?
   - Evidence quality: are evaluators providing 3+ items?
   - Retry guidance: do retries succeed when suggested?

3. **Kaseki Improvements**
   - Most common suggestions
   - Implementation pipeline (tracked, in-progress, completed)
   - Impact measurement: did implementations improve success rate?

### Actions Based on Feedback

**If goal quality is strong predictor** (>70% correlation):

- Increase goal-setting investment
- Update onboarding to emphasize SMART criteria
- Consider making goal quality a PR merge gate

**If evaluators are miscalibrated**:

- Refine confidence grounding guidance
- Provide retraining or updated examples
- Consider using different models for evaluation

**If kaseki improvements are valuable**:

- Implement top 3 suggestions from high/medium priority
- Measure impact on success rate
- Document which improvements had >10% impact

---

## Rollout Checklist

### Pre-Rollout (Week 0)

- [ ] All Phase 1 & 2 items complete and merged
- [ ] Test suite passes: `npm run test:unit -- tests/evaluation-prompts.test.ts`
- [ ] Manual QA on 3 goal-check outputs
- [ ] Manual QA on 3 run-evaluation outputs
- [ ] Documentation reviewed and published
- [ ] Team trained on new evaluation best practices
- [ ] Monitoring scripts deployed and tested

### Pilot Phase (Week 1)

- [ ] Deploy to 5 internal test instances
- [ ] Run 10 test jobs per day
- [ ] Collect feedback for analysis
- [ ] Daily standup review of metrics
- [ ] Go/No-Go decision by end of week

### Rollout Phases (Week 2-5)

- [ ] Stage 1: Early adopters (25% of runs)
  - [ ] Day 1-3: Deploy and monitor
  - [ ] Day 4-7: Gather feedback, measure impact
- [ ] Stage 2: Gradual increase (50% of runs)
  - [ ] Monitor error rates, confidence calibration
  - [ ] Compare old vs. new evaluation quality
- [ ] Stage 3: Full rollout (100% of runs)
  - [ ] Enable for all new instances
  - [ ] Publish preliminary findings
  - [ ] Set up continuous monitoring dashboard

### Post-Rollout (Week 6+)

- [ ] Continuous monitoring active
- [ ] Feedback analysis at Week 6 and Week 10
- [ ] Improvements tracked and implemented
- [ ] Dashboard published to team
- [ ] Lessons learned documented
- [ ] Plan next iteration of enhancements

---

## Rollback Plan

If critical issues detected:

1. **Immediate Actions** (minutes)
   - Disable evaluation feedback collection: `export KASEKI_GOAL_CHECK_FEEDBACK=0; export KASEKI_RUN_EVALUATION_FEEDBACK=0`
   - Revert prompt changes in kaseki-agent.sh to previous version
   - Post incident alert to team

2. **Root Cause Analysis** (hours)
   - Review error logs from failed runs
   - Identify broken feedback collection or prompt issues
   - Determine scope (goal-check vs run-evaluation)

3. **Fix & Re-Test** (1-2 days)
   - Fix identified issue
   - Re-run test suite
   - Manual QA on 5 samples
   - Deploy to pilot group again

4. **Communication** (ongoing)
   - Update team on issue and resolution
   - Document what went wrong
   - Plan improvements to prevent recurrence

---

## Success Metrics

**Primary**: Goal quality predicts success rate (correlation coefficient >0.6)
**Secondary**:

- Evaluator confidence is well-calibrated (>85% correct at "high" confidence)
- Evidence quality improves (80%+ of verdicts include 3+ items)
- Feedback collection runs without errors (>99% success rate)
- Kaseki improvements are actionable (>70% are implementable)

---

## References

- [docs/EVALUATION_BEST_PRACTICES.md](../docs/EVALUATION_BEST_PRACTICES.md)
- [docs/FEEDBACK_LOOP_INTEGRATION.md](../docs/FEEDBACK_LOOP_INTEGRATION.md)
- [docs/GOAL_SETTING_IMPROVEMENTS.md](../docs/GOAL_SETTING_IMPROVEMENTS.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Section 6 (Evaluation Best Practices)
