# Hashline Feature Monitoring Guide

## Overview

This guide provides practical monitoring and observability strategies for the Hashline Content-Based File Editing feature in kaseki-agent production deployments.

## Key Metrics

### 1. Feature Adoption

**What to Track**: How often agents use the hashline_edit tool

**Metric Definition**:
```
adoption_rate = runs_with_hashline_events / total_runs
```

**Target**: > 50% of applicable runs (runs that modify files)

**Collection**:
```bash
# Count runs with hashline events
find /agents/kaseki-results -name "hashline-summary.json" | wc -l

# Count total runs
find /agents/kaseki-results -name "metadata.json" | wc -l

# Calculate adoption
adopted=$(find /agents/kaseki-results -name "hashline-summary.json" | wc -l)
total=$(find /agents/kaseki-results -name "metadata.json" | wc -l)
echo "Adoption: $(( adopted * 100 / total ))%"
```

**Dashboard Query** (Prometheus):
```promql
count(hashline_events_total) / count(kaseki_run_total)
```

### 2. Success Rate

**What to Track**: Percentage of hashline edits that succeed

**Metric Definition**:
```
success_rate = applied_edits / (applied_edits + rejected_edits)
```

**Target**: > 95%

**Collection**:
```bash
# Extract stats from all runs
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  jq '.applied, .rejected' "$summary"
done | awk '{applied += $1; rejected += $2} END {
  print "Success Rate: " (applied * 100 / (applied + rejected)) "%"
}'
```

**Dashboard Query**:
```promql
sum(hashline_applied_total) / (sum(hashline_applied_total) + sum(hashline_rejected_total))
```

### 3. Rejection Analysis

**What to Track**: Why edits are rejected and how often

**Common Reasons**:
- "start_hash not found" → content moved/changed
- "end_hash not found" → incomplete context
- "file not found" → wrong file path
- "invalid edit" → malformed request

**Collection**:
```bash
# Find all rejections
for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  jq 'select(.status=="rejected") | .reason' "$events"
done | sort | uniq -c | sort -rn
```

**Expected Output**:
```
     42 "start_hash not found"      ← stale anchors (OK, expected)
      3 "file not found"            ← path issues (investigate)
      1 "invalid edit"              ← malformed (investigate)
```

**Dashboard Query**:
```promql
topk(10, sum by (reason) (hashline_rejected_total))
```

### 4. Performance

**What to Track**: Speed of hashline event processing

**Metric Definition**:
```
duration_ms = time to process all edits in a run
avg_duration = sum(duration_ms) / count(runs_with_edits)
```

**Target**: < 50ms average (< 5ms per edit)

**Collection**:
```bash
# Extract duration from all runs
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  jq '.duration_ms' "$summary"
done | awk '{sum += $1; count++} END {
  print "Average: " (sum / count) "ms"
  print "Median: " (sort[count/2]) "ms"
}'
```

**Dashboard Query**:
```promql
histogram_quantile(0.95, rate(hashline_duration_seconds_bucket[1h]))
```

### 5. Lines Modified

**What to Track**: Total lines changed by hashline edits

**Metric Definition**:
```
total_lines_modified = sum of linesModified across all edits
avg_lines_per_edit = total_lines_modified / count(edits)
```

**Target**: 1-10 lines per edit (typical refactor size)

**Collection**:
```bash
# Extract lines modified
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  jq '.totalLinesModified' "$summary"
done | awk '{sum += $1; count++} END {
  print "Total Lines: " sum
  print "Runs with edits: " count
  print "Avg per run: " (sum / count)
}'
```

## Alert Thresholds

### Critical Alerts

**High Rejection Rate**:
```
IF success_rate < 0.90 for 5 consecutive runs
THEN ALERT "Hashline rejection rate > 10%"
SEVERITY: HIGH
```

**Immediate Action**:
1. Check rejection reasons
2. If "start_hash not found": increase context_lines
3. If "file not found": verify working directory
4. Review recent changes to kaseki-agent.sh

**High Processing Time**:
```
IF avg_duration_ms > 100 for 5 consecutive runs
THEN ALERT "Hashline processing slower than expected"
SEVERITY: MEDIUM
```

**Immediate Action**:
1. Check file sizes being edited
2. If large files: implement caching
3. Review recent code changes
4. Profile with large test files

### Warning Alerts

**Low Adoption**:
```
IF adoption_rate < 0.30 for 1 day
THEN ALERT "Hashline adoption rate low"
SEVERITY: LOW
```

**Investigation**:
1. Verify KASEKI_HASHLINE_EDITS=1
2. Check if Pi model supports hashline_edit
3. Review agent task prompts
4. Check for feature flag bugs

**Increased Errors**:
```
IF error_count > 5 for 1 hour
THEN ALERT "Hashline processing errors increasing"
SEVERITY: MEDIUM
```

**Investigation**:
1. Check error types in hashline-events.jsonl
2. Look for recent code changes
3. Verify Docker image is latest
4. Check file system permissions

## Dashboard Setup

### Prometheus Scrape Config

```yaml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: 'kaseki-hashline'
    static_configs:
      - targets: ['localhost:9090']
    relabel_configs:
      - source_labels: [__address__]
        target_label: instance
```

### Grafana Dashboard

**URL**: `/api/dashboards/db/kaseki-hashline`

**Panels**:

1. **Feature Adoption** (Gauge):
   ```promql
   count(hashline_events_total) / count(kaseki_run_total) * 100
   ```
   Target: 50%

2. **Success Rate** (Gauge):
   ```promql
   sum(hashline_applied_total) / (sum(hashline_applied_total) + sum(hashline_rejected_total)) * 100
   ```
   Target: > 95%

3. **Processing Time** (Line Graph):
   ```promql
   histogram_quantile(0.95, rate(hashline_duration_seconds_bucket[5m]))
   ```

4. **Rejections by Reason** (Bar Chart):
   ```promql
   topk(5, sum by (reason) (rate(hashline_rejected_total[1h])))
   ```

5. **Lines Modified** (Area Chart):
   ```promql
   sum(rate(hashline_lines_modified_total[1h]))
   ```

## Observability in Artifacts

### hashline-summary.json

Every kaseki run produces a summary with key metrics:

```json
{
  "applied": 3,           // Successful edits
  "rejected": 1,          // Failed edits
  "errors": 0,            // Exceptions
  "totalLinesModified": 12,
  "duration_ms": 42
}
```

**What to Look For**:
- `applied > 0`: Feature is being used ✓
- `rejected` close to `applied`: Success rate low ⚠
- `duration_ms < 50`: Performance good ✓
- `errors > 0`: Unexpected failures 🚨

### hashline-events.jsonl

Detailed per-edit results (one JSON per line):

```json
{
  "file": "src/handlers.ts",
  "status": "applied",
  "hash": "7a2f8c1e",
  "linesModified": 3
}
{
  "file": "src/utils.ts",
  "status": "rejected",
  "reason": "start_hash not found",
  "error": "Could not find anchor in file"
}
```

**Analysis Script**:
```bash
#!/bin/bash
# Analyze hashline results across multiple runs

for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  echo "=== $(dirname $events) ==="
  
  # Count by status
  jq -r '.status' "$events" | sort | uniq -c
  
  # Show rejections
  jq 'select(.status=="rejected") | {file, reason}' "$events"
  
  # Stats
  jq -s '{
    total: length,
    applied: map(select(.status=="applied")) | length,
    rejected: map(select(.status=="rejected")) | length,
    lines_modified: map(.linesModified // 0) | add
  }' "$events"
done
```

## Manual Verification

### Daily Checklist

```bash
#!/bin/bash
# Daily hashline health check

echo "=== Hashline Daily Health Check ==="
date

# 1. Adoption rate
adopted=$(find /agents/kaseki-results -mtime -1 -name "hashline-summary.json" | wc -l)
total=$(find /agents/kaseki-results -mtime -1 -name "metadata.json" | wc -l)
adoption=$((adopted * 100 / total))
echo "Adoption (last 24h): ${adoption}% ($adopted/$total runs)"

# 2. Success rate
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  jq '.applied, .rejected' "$summary"
done | awk '{a += $1; r += $2} END {
  if (a + r > 0) {
    sr = a * 100 / (a + r)
    printf "Success Rate: %.1f%% (%d applied, %d rejected)\n", sr, a, r
  }
}'

# 3. Performance
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  jq '.duration_ms' "$summary"
done | awk '{sum += $1; n++} END {
  if (n > 0) printf "Avg Duration: %.0fms (n=%d)\n", sum/n, n
}'

# 4. Rejection reasons
echo "Top rejection reasons:"
for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  jq 'select(.status=="rejected") | .reason' "$events"
done | sort | uniq -c | sort -rn | head -5

# 5. Error count
error_count=$(find /agents/kaseki-results -name "hashline-events.jsonl" -exec \
  grep -c '"status":"error"' {} \; | awk '{sum+=$1} END {print sum}')
echo "Errors (last 24h): $error_count"

if [ "$adoption" -lt 30 ]; then
  echo "⚠ WARNING: Adoption low, check feature flag"
fi

success_rate=$(grep -oP '"applied":\K[0-9]+' /agents/kaseki-results/*/hashline-summary.json | \
  awk '{a+=$1} END {print a}')
# ... calculate and check
```

## Troubleshooting Guide

### Issue: Adoption Rate 0%

**Check**:
1. Feature enabled?
   ```bash
   grep KASEKI_HASHLINE_EDITS kaseki-agent.sh | head -1
   ```

2. Image updated?
   ```bash
   docker inspect kaseki-agent | grep "hashline"
   ```

3. Any errors?
   ```bash
   grep -i "hashline" /agents/kaseki-results/*/stdout.log | head -10
   ```

**Fix**:
- Rebuild Docker image with latest code
- Ensure KASEKI_HASHLINE_EDITS=1 in environment
- Check Pi model supports hashline_edit tool

### Issue: High Rejection Rate

**Analysis**:
```bash
# Find most common rejection reason
for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  jq 'select(.status=="rejected")' "$events"
done | jq -r '.reason' | sort | uniq -c | sort -rn
```

**If "start_hash not found"** (most common):
- Content is moving between reads and edits
- Solution: Increase context_lines in validation
- Or: Add more specific guidance to task prompt

**If "file not found"**:
- Agent is targeting wrong file paths
- Solution: Check workspace directory setup
- Or: Add file path clarification to prompt

### Issue: Performance Degradation

**Check**:
```bash
# Look for slow runs
for summary in /agents/kaseki-results/*/hashline-summary.json; do
  duration=$(jq '.duration_ms' "$summary")
  if [ "$duration" -gt 100 ]; then
    echo "Slow: $summary - ${duration}ms"
  fi
done
```

**Analysis**:
```bash
# Which files are being edited?
for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  jq -r '.file' "$events"
done | sort | uniq -c | sort -rn
```

**Fix Options**:
- If large files: Implement hash caching
- If many edits: Optimize validator
- If content big: Consider streaming

## Long-term Trends

### Monthly Reports

Generate monthly summary:
```bash
#!/bin/bash
month=$1  # e.g., "2026-05"

echo "=== Hashline Feature Report: $month ==="

# Adoption trend
echo "Daily Adoption Rate:"
for day in $(seq 1 31); do
  date="${month}-$(printf "%02d" $day)"
  count=$(find /agents/kaseki-results -newermt "$date 00:00" -oldermm "$date 23:59" \
    -name "hashline-summary.json" | wc -l)
  total=$(find /agents/kaseki-results -newermt "$date 00:00" -oldermm "$date 23:59" \
    -name "metadata.json" | wc -l)
  [ "$total" -gt 0 ] && echo "$date: $((count * 100 / total))%"
done

# Top issues
echo "Top Rejection Reasons:"
for events in /agents/kaseki-results/*/hashline-events.jsonl; do
  jq 'select(.status=="rejected") | .reason' "$events"
done | sort | uniq -c | sort -rn | head -10
```

## Metrics Export

### For External Analytics

```bash
#!/bin/bash
# Export hashline metrics to JSON for analysis

cat > /tmp/hashline-metrics.json <<'EOF'
{
  "timestamp": "$(date -Iseconds)",
  "period_days": 30,
  "metrics": {
EOF

# Add adoption
adoption=$(find /agents/kaseki-results -mtime -30 -name "hashline-summary.json" | wc -l)
total=$(find /agents/kaseki-results -mtime -30 -name "metadata.json" | wc -l)
echo "  \"adoption_rate\": $((adoption * 100 / total))," >> /tmp/hashline-metrics.json

# Add success rate
# ... more metrics ...

echo "}" >> /tmp/hashline-metrics.json

# Send to monitoring backend
curl -X POST https://analytics.example.com/hashline-metrics \
  -d @/tmp/hashline-metrics.json \
  -H "Content-Type: application/json"
```

## References

- [HASHLINE_ROLLOUT_STRATEGY.md](HASHLINE_ROLLOUT_STRATEGY.md) — Rollout phases
- [HASHLINE_ARCHITECTURE.md](HASHLINE_ARCHITECTURE.md) — Technical details
- [kaseki-agent.sh](../kaseki-agent.sh) — Implementation
