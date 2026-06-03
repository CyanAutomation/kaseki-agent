# Hashline Feature Rollout Strategy

## Overview

This document outlines the safe, phased rollout strategy for the Hashline Content-Based File Editing feature in kaseki-agent.

## Current Status

- **Feature**: Hashline Editing (Feature 1 from OHMYPI)
- **Status**: Production-Ready ✅
- **Test Coverage**: 48 tests, all passing
- **Default State**: Enabled (`KASEKI_HASHLINE_EDITS=1`)

## Rollout Phases

### Phase 1: Full Production (Current)

**Duration**: Immediate  
**Adoption**: 100% of runs  
**Risk Level**: Low (comprehensive test coverage, non-fatal errors)

**Configuration**:

```bash
export KASEKI_HASHLINE_EDITS=1  # Default
```

**Rollout Actions**:

1. ✅ Deploy kaseki-agent image with hashline support
2. ✅ Enable hashline guidance in all task prompts
3. ✅ Monitor hashline event handler logs
4. ✅ Track success/rejection metrics

**Success Criteria**:

- Agent promptly uses hashline_edit tool for file modifications
- No unexpected validation failures
- Rejection rate < 5% (stale anchors only)
- Build/test performance unchanged

**Monitoring Dashboard** (recommended):

- Total hashline events processed
- Applied vs. rejected edits
- Rejection reasons (stale anchor, file not found, etc.)
- Average processing time per edit
- Feature adoption rate (% of runs with >0 edits)

### Phase 2: Optimization & Monitoring (Optional)

**Duration**: Ongoing  
**Adoption**: 100%  
**Focus**: Observability, tuning, metrics collection

**Actions**:

1. Collect baseline metrics on hashline usage
2. Identify common rejection patterns
3. Optimize context_lines parameter based on real data
4. Document best practices for agent prompts

**Metrics to Track**:

| Metric | Target | Current |
|--------|--------|---------|
| Applied edits per run | 2-5 | TBD |
| Rejection rate | <5% | TBD |
| Processing time | <50ms | TBD |
| Success rate | >95% | 100% (test) |

**Tuning Opportunities**:

- If rejection rate high → increase context_lines
- If processing time high → cache file hashes
- If adoption low → enhance task prompt examples
- If failures occur → debug and add to test suite

### Phase 3: Gradual Rollback (Emergency Only)

**When to Trigger**:

- Production incident related to hashline edits
- Unexpected validation failures
- Performance degradation
- Data corruption (extremely unlikely)

**Actions**:

```bash
# Disable hashline for new runs
export KASEKI_HASHLINE_EDITS=0

# Keep existing results for analysis
# Archive: /agents/kaseki-results/kaseki-*/hashline-summary.json
```

**Recovery Procedure**:

1. Disable feature in production
2. Collect all hashline-summary.json files
3. Analyze rejection patterns
4. Fix root cause
5. Deploy updated image
6. Re-enable with monitoring

## Enable/Disable By Deployment

### Kubernetes/Container Orchestration

```yaml
# Enable globally
env:
  - name: KASEKI_HASHLINE_EDITS
    value: "1"

# Or per-pod:
env:
  - name: KASEKI_HASHLINE_EDITS
    value: "0"  # For canary pods
```

### Docker Compose

```yaml
services:
  kaseki-api:
    environment:
      KASEKI_HASHLINE_EDITS: "1"  # default
```

### Single-Run Script

```bash
# Enable
KASEKI_HASHLINE_EDITS=1 ./run-kaseki.sh

# Disable
KASEKI_HASHLINE_EDITS=0 ./run-kaseki.sh
```

## Fallback Behavior

### When Hashline is Disabled

- Task prompt uses standard file editing instructions
- Agent uses bash/write tool (original behavior)
- Quality gates and validation unchanged
- No performance impact

### When Hashline Edit Fails

- Event recorded in hashline-events.jsonl with rejection reason
- Validation pipeline continues (non-fatal)
- Agent can retry with bash/write if needed
- Detailed error message aids debugging

## Monitoring & Alerts

### Recommended Alerts

1. **High Rejection Rate**:

   ```sql
   IF (rejected_edits / (applied_edits + rejected_edits)) > 0.1
   THEN alert("Hashline rejection rate high: >10%")
   ```

2. **Processing Time Spike**:

   ```sql
   IF duration_ms > 100 for consecutive runs
   THEN alert("Hashline processing slower than normal")
   ```

3. **Zero Adoption**:

   ```sql
   IF (runs_with_hashline_events / total_runs) < 0.01
   THEN alert("Hashline not being used by agents")
   ```

### Dashboard Queries

**Total Events Processed** (daily):

```
SELECT COUNT(*) as total_edits
  FROM kaseki_results
 WHERE DATE(created_at) = CURRENT_DATE
   AND file = 'hashline-summary.json'
```

**Success Rate** (last 30 days):

```
SELECT 
  SUM(applied) / (SUM(applied) + SUM(rejected)) as success_rate,
  DATE(created_at) as date
FROM kaseki_results
WHERE DATE(created_at) >= CURRENT_DATE - 30
  AND file = 'hashline-summary.json'
GROUP BY DATE(created_at)
ORDER BY date DESC
```

**Rejection Reasons** (most common):

```
SELECT reason, COUNT(*) as frequency
FROM kaseki_results
WHERE file = 'hashline-events.jsonl'
  AND status = 'rejected'
GROUP BY reason
ORDER BY frequency DESC
LIMIT 10
```

## Hotfix Procedures

### Issue: High Rejection Rate (>10%)

**Diagnosis**:

1. Check `hashline-summary.json` for rejection reasons
2. Most common: "start_hash not found" → stale anchors
3. Solution: Increase context_lines in validator

**Fix**:

```typescript
// src/hashline-validator.ts
if (contextLines < 5) {
  contextLines = 5;  // Increase for ambiguous files
}
```

**Redeploy**:

```bash
npm run build
docker build -t kaseki-agent:fixed .
docker push kaseki-agent:fixed
# Update deployment to use new tag
```

### Issue: Performance Degradation

**Diagnosis**:

1. Check hashline duration_ms in metadata
2. If > 100ms consistently, likely large file
3. Solution: Optimize hash computation

**Fix**: Implement caching in HashlineValidator

```typescript
private lineHashCache: Map<string, string[]> = new Map();

async getLineHashes(filePath: string): Promise<string[]> {
  const cached = this.lineHashCache.get(filePath);
  if (cached) return cached;
  
  const hashes = this.computeLineHashes(lines);
  this.lineHashCache.set(filePath, hashes);
  return hashes;
}
```

**Redeploy**: Same process as above

### Issue: Zero Adoption

**Diagnosis**:

1. Check if feature is enabled: `KASEKI_HASHLINE_EDITS=1`
2. Check if Pi CLI supports hashline_edit tool
3. Check agent prompt includes hashline guidance

**Possible Causes**:

- Feature disabled by mistake: `KASEKI_HASHLINE_EDITS=0`
- Pi model doesn't support hashline_edit (use fallback)
- Task prompt not mentioning hashline_edit (update prompt)

**Fix**:

```bash
# Verify feature enabled
echo $KASEKI_HASHLINE_EDITS

# Check prompt includes guidance
grep -i "hashline" /results/pi-task-prompt.txt
```

## Rollout Timeline

### Week 1: Deployment

- [ ] Deploy image with hashline support
- [ ] Enable in staging environment
- [ ] Verify basic functionality
- [ ] Monitor for errors

### Week 2: Full Production

- [ ] Deploy to production (100%)
- [ ] Set up monitoring dashboard
- [ ] Document metrics in runbook

### Week 3-4: Observation

- [ ] Collect baseline metrics
- [ ] Identify tuning opportunities
- [ ] Document lessons learned
- [ ] Update documentation

### Ongoing: Maintenance

- [ ] Monitor rejection rates
- [ ] Track performance metrics
- [ ] Respond to issues
- [ ] Optimize as needed

## Testing Before Rollout

**Automated Tests** (all passing):

- ✅ 20 unit tests (HashlineValidator)
- ✅ 11 unit tests (HashlineEventHandler)
- ✅ 5 integration tests (CLI workflow)
- ✅ 5 kaseki-agent.sh integration tests
- ✅ 7 TDD prompt enhancement tests

**Manual Testing Checklist**:

- [ ] Run single-run with hashline enabled
- [ ] Verify hashline edits applied correctly
- [ ] Check artifacts generated (hashline-events.jsonl, hashline-summary.json)
- [ ] Verify validation passes with hashline changes
- [ ] Test with hashline disabled (fallback works)
- [ ] Test with large files (>1000 lines)
- [ ] Test with stale anchors (rejection recorded)

**Staging Validation**:

- [ ] Deploy to staging cluster
- [ ] Run 10 sample tasks with hashline
- [ ] Verify success rate >95%
- [ ] Check processing time <50ms per edit
- [ ] Confirm no unexpected errors

## Communication Plan

### Internal Teams

**Engineering**:

- Notify on deployment
- Share runbook with monitoring setup
- Provide alert thresholds

**DevOps/Platform**:

- Update deployment documentation
- Add metrics to dashboards
- Create playbooks for alerts

**Support**:

- Document feature for agents
- Provide troubleshooting guide
- Share FAQ

### External Communication

**When Deploying**:

- Announce new feature in changelog
- Link to documentation
- Provide examples

**When Enabling**:

- No customer notification needed (internal improvement)
- Update internal documentation
- Prepare response to questions

**If Issues Occur**:

- Document incident
- Post-mortem after resolution
- Share lessons learned

## Success Criteria

**Deployment Success**:

- ✅ Feature deployed to production
- ✅ 48 tests passing
- ✅ Monitoring in place
- ✅ Runbook documented

**Operational Success** (after 2 weeks):

- Success rate > 95% on valid anchors
- Rejection rate < 5%
- Processing time < 50ms per edit
- Zero production incidents
- Agent adoption of tool > 50% of applicable runs

**Long-term Success** (after 4 weeks):

- Validation failure rate reduced by 5-15%
- Cost savings measured (token reduction)
- Best practices documented
- Tuning parameters optimized

## References

- [HASHLINE_ARCHITECTURE.md](HASHLINE_ARCHITECTURE.md) — Architecture deep-dive
- [PI_TOOL_HASHLINE_EDIT.md](PI_TOOL_HASHLINE_EDIT.md) — Tool specification
- [OHMYPI_FEATURE_INTEGRATION.md](OHMYPI_FEATURE_INTEGRATION.md) — Feature integration overview
- [kaseki-agent.sh](../kaseki-agent.sh) — Implementation in orchestration
