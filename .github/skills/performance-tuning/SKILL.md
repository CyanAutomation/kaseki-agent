---
name: performance-tuning
description: Optimization strategies for kaseki-agent execution speed, cost, and resource usage
tags: [kaseki, performance, optimization, speed, tuning, cost, timeout]
relatedSkills: [cost-optimization, dependency-cache-optimization, environment-configuration, quality-gate-config]
---

# Performance Tuning for Kaseki Agent

This skill guides optimization of kaseki-agent execution speed, cost, and resource efficiency.

## Overview

**When to Use**:
- Runs are taking too long (approaching timeout)
- Reducing execution time to improve throughput
- Decreasing costs by optimizing token usage
- Improving CI/CD pipeline speed
- Resource optimization for constrained environments

**Key Concepts**:
- **Speed** (execution time) and **cost** (token usage) are correlated but can be optimized independently
- **Agent timeout** affects quality: shorter timeout → rushing → more tokens
- **Allowlist tightness** is the single biggest optimization lever (30–50% savings)
- **Caching** provides consistent 5–15% improvement with minimal config

---

## Quick Tuning Scenarios

### Scenario 1: Runs Are Slow (> 20 minutes)

**Most Common Cause**: Large allowlist or complex task

**Quick Fixes** (in priority order):

1. **Tighten allowlist**
   ```bash
   # Current (loose): explores 50+ files
   KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
   
   # Optimized (tight): targets 2–3 files
   KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"
   
   # Result: 8 min (was 25 min) = 17 min savings
   ```

2. **Increase timeout** (counterintuitive)
   ```bash
   # Default (tight timeout): agent rushes, tries dead ends
   KASEKI_AGENT_TIMEOUT_SECONDS=1200  # 20 min
   
   # Optimized (longer timeout): agent plans, explores methodically
   KASEKI_AGENT_TIMEOUT_SECONDS=2400  # 40 min
   
   # Result: Actually finishes faster (fewer retries)
   ```

3. **Use free model**
   ```bash
   # Current: may use slower model
   KASEKI_MODEL=claude-3.5-sonnet
   
   # Optimized: free tier is usually fast enough
   KASEKI_MODEL=openrouter/free
   ```

### Scenario 2: High Token Usage (Expensive Runs)

**Root Cause**: Agent exploring too much code

**Fixes**:

1. **Tight allowlist** (primary lever)
   ```bash
   # Example: Bug fix cost reduction
   # Loose allowlist: 5,000 tokens → $0.35
   # Tight allowlist: 800 tokens → $0.05
   # Savings: $0.30 per run (87% reduction!)
   ```

2. **Better prompt clarity**
   ```bash
   # Vague (explores multiple approaches):
   TASK_PROMPT="Improve error handling"
   
   # Clear (focused approach):
   TASK_PROMPT="Add try/catch around line 42 in src/db.ts 
   to handle connection timeouts. Update tests/db.test.ts accordingly."
   
   # Result: 30% fewer tokens
   ```

3. **Batch multiple tasks**
   ```bash
   # Sequential runs: 5 tasks × $0.15 each = $0.75
   # Batched (shared cache): 5 tasks × $0.12 each = $0.60 (20% savings)
   # Optimized batch: 5 tasks × $0.05 each = $0.25 (70% savings!)
   ```

### Scenario 3: Validation Is Slow (npm ci takes 3 minutes)

**Root Cause**: Cache miss (npm re-installing dependencies)

**Fixes**:

1. **Check cache hit rate**
   ```bash
   # Review timings across recent runs
   for run in /agents/kaseki-results/kaseki-{1,2,3,4,5}/; do
     duration=$(grep npm "$run/validation-timings.tsv" | awk '{print $2}')
     echo "$(basename $run): ${duration}s"
   done
   
   # Expected:
   # Cache hit (Layer 1): <1 sec
   # Cache hit (Layer 2): 5–30 sec
   # Seed cache (Layer 3): 30–60 sec
   # Fresh install (Layer 4): 1–3 min
   ```

2. **Seed image cache** (if frequent fresh installs)
   ```bash
   # Pre-populate Docker image with target repo's dependencies
   cd docker/workspace-cache
   cp /target/repo/package*.json .
   npm ci
   cd ../..
   
   docker build -t kaseki-template:latest .
   
   # Result: Next runs hit Layer 3 (60s instead of 180s)
   ```

3. **Reduce validation scope**
   ```bash
   # Current (comprehensive): check everything
   KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
   
   # Optimized (focused): only test changed module
   KASEKI_VALIDATION_COMMANDS="npm run test -- tests/parser.test.ts"
   
   # Result: 3 min (was 10 min) = 70% faster
   ```

---

## Agent Timeout Configuration

### Why Longer Timeout = Faster Completion

**Counterintuitive Insight**: Agent with longer timeout spends less total time.

**Explanation**:
- **Short timeout (1200s)**: Agent rushes, tries many approaches, many hit dead ends → thrashing → uses more tokens
- **Long timeout (2400s)**: Agent plans systematically, explores fewer paths → efficient → fewer tokens

**Example Metrics**:

| Timeout | Elapsed | Token Count | Cost |
|---|---|---|---|
| 1200s (20 min) | 20 min (timed out) | 15,000 | $0.35 |
| 1800s (30 min) | 12 min (finished) | 6,000 | $0.15 |
| 2400s (40 min) | 8 min (finished) | 4,000 | $0.10 |

**Optimal Range**: 1800–2400s (30–40 minutes) for most tasks

```bash
# Recommended setting
KASEKI_AGENT_TIMEOUT_SECONDS=1800  # 30 minutes
```

---

## Allowlist Design for Optimization

### Performance Impact of Allowlist Size

| File Count | Agent Tokens | Execution Time | Cost |
|---|---|---|---|
| **1–2** | 600–900 | 6–8 min | $0.05 |
| **3–5** | 1,000–1,500 | 8–12 min | $0.08 |
| **6–10** | 1,500–2,500 | 12–15 min | $0.12 |
| **20+** | 3,000–5,000 | 15–20 min | $0.20 |
| **50+** | 5,000–10,000 | 20–25 min | $0.35 |

**Key Insight**: Tight allowlist (2–3 files) = 30–50% cost reduction

### How to Design Optimal Allowlist

**Step 1**: Manually make the change
```bash
# Do the work yourself to understand scope
git checkout -b feature/fix
# ... make changes ...
git diff --name-only
# Output:
# src/lib/parser.ts
# tests/parser.test.ts
```

**Step 2**: Set allowlist to exact files
```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"
```

**Step 3**: Add 1–2 related files (if agent might need them)
```bash
# If parser imports from types.ts:
git diff --name-only | xargs -I {} grep -l "import" {}
# If types.ts shows up, add it

KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts src/types.ts tests/parser.test.ts"
```

**Step 4**: Exclude everything else
```bash
# Do NOT include:
# - docs/ (agent won't modify these)
# - config files (not needed for parser fix)
# - other modules (unrelated)
```

---

## Dependency Caching Optimization

### The 4-Layer Cache Strategy

```
Layer 1: Stamp Check (< 1 sec)
  └─ Checks if node_modules still valid
  └─ Best case: reuse exact same node_modules

Layer 2: Workspace Cache (5–30 sec)
  └─ Copy from /workspace/.kaseki-cache/
  └─ Used when lock file matches previous run

Layer 3: Image Seed Cache (30–60 sec)
  └─ Copy from Docker image
  └─ Pre-built during docker build

Layer 4: Fresh Install (1–3 min)
  └─ npm ci downloads from registry
  └─ Fallback when no cache hits
```

### Maximizing Cache Hits

**Strategy 1**: Run against same repo repeatedly
```bash
# Cache persists across runs of same repo
# First run: 180s (Layer 4)
# Second run: 10s (Layer 2 or 1)
# Result: 94% faster
```

**Strategy 2**: Minimize lock file changes
```bash
# When updating dependencies:
npm install  # Update lock
git add package-lock.json
git commit -m "chore: update deps"
git push  # Publish lock first

# Subsequent runs will hit cache
```

**Strategy 3**: Pre-populate seed cache
```bash
# For frequently-run repos, seed Docker image
cd docker/workspace-cache
cp /target/repo/package*.json .
npm ci
cd ../..

docker build -t kaseki-template:latest .

# Now Layer 3 hits (60s instead of 180s)
```

### Monitoring Cache Effectiveness

```bash
#!/bin/bash
# Check cache hit ratio

echo "Cache Performance (last 10 runs):"

for run in /agents/kaseki-results/kaseki-{1..10}/; do
  if [[ ! -d "$run" ]]; then continue; fi
  
  npm_time=$(grep npm "$run/validation-timings.tsv" 2>/dev/null | awk '{print $2}')
  [[ -z "$npm_time" ]] && npm_time="0"
  
  if [[ $npm_time -lt 5 ]]; then
    status="Layer 1 (excellent)"
  elif [[ $npm_time -lt 30 ]]; then
    status="Layer 2 (good)"
  elif [[ $npm_time -lt 60 ]]; then
    status="Layer 3 (fair)"
  else
    status="Layer 4 (miss)"
  fi
  
  echo "$(basename $run): ${npm_time}s - $status"
done
```

---

## Validation Performance

### Reducing Validation Time

**Option 1**: Skip unnecessary checks
```bash
# Full validation (10 min)
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"

# Focused validation (3 min)
KASEKI_VALIDATION_COMMANDS="npm run test -- tests/parser.test.ts"

# Savings: 7 minutes (70% faster!)
```

**Option 2**: Parallel validation (if supported)
```bash
# Sequential (10 min total)
KASEKI_VALIDATION_COMMANDS="npm run check && npm run test && npm run build"

# Parallel (faster, if test framework supports it)
KASEKI_VALIDATION_COMMANDS="npm run check & npm run test & npm run build; wait"

# Typical savings: 30–50% (depending on I/O overlap)
```

**Option 3**: Preload dependencies
```bash
# Cache npm modules before validation
npm ci --prefer-offline

# Then run validation
KASEKI_VALIDATION_COMMANDS="npm run test"

# Savings: Skip npm ci step (~2 min)
```

---

## Token Usage Optimization

### Cost Optimization Summary

**Impact of Each Strategy** (compared to baseline):

| Strategy | Impact | Effort | ROI |
|---|---|---|---|
| **Tight allowlist** | 30–50% | 30 min | ⭐⭐⭐⭐⭐ |
| **Better prompt** | 20–30% | 15 min | ⭐⭐⭐⭐ |
| **Longer timeout** | 20–40% | 5 min | ⭐⭐⭐⭐ |
| **Free model** | 100% | 1 min | ⭐⭐⭐⭐ |
| **Reduced validation** | 5–15% | 10 min | ⭐⭐⭐ |
| **Batch operations** | 20–30% | 30 min | ⭐⭐⭐ |
| **Seed cache** | 5–10% | 1 hour | ⭐⭐ |

### Real-World Tuning Example

**Baseline** (untuned):
```bash
KASEKI_MODEL=claude-3.5-sonnet
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
KASEKI_AGENT_TIMEOUT_SECONDS=1200
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"

# Result: $0.25 per run, 20 min execution
```

**Tuned**:
```bash
KASEKI_MODEL=openrouter/free  # Free
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"  # Tight
KASEKI_AGENT_TIMEOUT_SECONDS=1800  # Longer = faster
KASEKI_VALIDATION_COMMANDS="npm run test -- tests/parser.test.ts"  # Focused

# Result: $0.00 per run, 8 min execution (96% faster!)
```

---

## Workflow: Optimal Tuning Process

1. **Start with defaults**
   ```bash
   ./run-kaseki.sh kaseki-baseline
   cat /agents/kaseki-results/kaseki-baseline/result-summary.md
   ```

2. **Identify bottleneck** (time or cost)
   ```bash
   # Check duration
   jq '.duration_seconds' /agents/kaseki-results/kaseki-baseline/metadata.json
   
   # Check tokens
   jq '.token_count' /agents/kaseki-results/kaseki-baseline/pi-summary.json
   ```

3. **Apply high-ROI tuning** (allowlist, timeout, validation)
   ```bash
   ./run-kaseki.sh kaseki-tuned-1
   ```

4. **Measure improvement**
   ```bash
   # Compare:
   diff <(jq '.duration_seconds' /agents/kaseki-results/kaseki-baseline/metadata.json) \
        <(jq '.duration_seconds' /agents/kaseki-results/kaseki-tuned-1/metadata.json)
   ```

5. **Iterate** if further gains needed

---

## See Also

- [PERFORMANCE_TUNING.md](../../docs/PERFORMANCE_TUNING.md) — Comprehensive performance reference
- [COST_ESTIMATION.md](../../docs/COST_ESTIMATION.md) — Cost analysis and ROI
- [dependency-cache-optimization](dependency-cache-optimization.md) — Caching deep-dive
- [quality-gate-config](quality-gate-config.md) — Allowlist design
- [environment-configuration](environment-configuration.md) — Tuning configuration
