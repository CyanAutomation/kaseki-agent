# Performance Tuning & Optimization Guide

> **NPM CLI note:** examples that use `kaseki-agent run` submit work through the configured Kaseki API. Start `kaseki-agent serve` locally or set `KASEKI_API_URL` before benchmarking or tuning task runs.


This guide helps you optimize kaseki-agent for your specific use case: managing timeouts, cache strategies, API rate limits, and resource allocation.

---

## Quick Reference: Common Tuning Scenarios

| Scenario | Issue | Primary Tuning | Secondary |
|----------|-------|---|---|
| Agent finishes quickly (1-2 min) | Timeout too conservative | Decrease `KASEKI_AGENT_TIMEOUT_SECONDS` | Monitor cost/API quota |
| Agent frequently times out | Task too complex | Increase `KASEKI_AGENT_TIMEOUT_SECONDS` | Simplify task prompt |
| Large changes (>200 KB diff) | Scope too broad | Use `KASEKI_CHANGED_FILES_ALLOWLIST` | Or increase `KASEKI_MAX_DIFF_BYTES` |
| Validation is slow | Tests/build slow | Nothing (inherent) | Optimize repository's test suite |
| Too many files modified | Agent scope creep | Tighten allowlist | Clarify task prompt |
| API queue backing up | Not enough workers | Increase `KASEKI_API_MAX_CONCURRENT_RUNS` | Monitor Docker resource usage |
| High OpenRouter costs | Too many/large runs | Use allowlist to reduce search space | Increase timeout to reduce retries |
| Dependency install slow | Fresh npm ci on each run | Enable `KASEKI_CACHE_ENABLED=1` | Pre-warm cache with `docker/workspace-cache/` |
| Cannot exceed 24-hour timeout | Agent genuinely needs more time | Split into multiple smaller tasks | Scope with allowlist |

---

## Agent Timeout Configuration

Agent timeout controls how long the Pi agent has to complete the task.

### Understanding Timeout

```
KASEKI_AGENT_TIMEOUT_SECONDS = time limit for agent reasoning +
  code execution
(Does not include: validation, quality gates, setup)
```

### Default Behavior

- **Default timeout**: 1200 seconds (20 minutes)
- **Max allowed**: 86400 seconds (24 hours)
- **Exit code on timeout**: 124

### When to Adjust

**Decrease timeout:**

- Agent often finishes in 2-5 minutes → set to 300-600 seconds
- Cost-conscious (OpenRouter charges by token count)
- Task is simple (small bug fix, add single test)

```bash
export KASEKI_AGENT_TIMEOUT_SECONDS=300  # 5 min for simple fixes
```

**Increase timeout:**

- Agent frequently times out (exit 124)
- Complex task (major refactor, large feature)
- Allowlist is tight (agent must search carefully)

```bash
export KASEKI_AGENT_TIMEOUT_SECONDS=3600  # 1 hour for complex tasks
```

### Monitoring Actual Usage

```bash
# Check how much time agent actually used
cat /agents/kaseki-results/kaseki-N/pi-summary.json |
  jq '.elapsed_seconds'

# Example: if agent used 150s but timeout was 1200s, reduce to 300s
# if agent used 1180s but timeout was 1200s, increase to 1800s
```

### Cost-Effective Tuning

```bash
# Track agent time across runs
for run in /agents/kaseki-results/kaseki-*/pi-summary.json; do
  elapsed=$(jq '.elapsed_seconds' "$run")
  timeout=$(jq '.timeout_seconds' "$run")
  pct=$((elapsed * 100 / timeout))
  echo "$(basename $(dirname $run)): ${elapsed}s / ${timeout}s (${pct}%)"
done | sort -t: -k2 -n

# If most runs use <30% of timeout, decrease default timeout
# If any runs use >90% of timeout, increase it
```

---

## Allowlist Configuration for Scope Optimization

The tighter the allowlist, the faster the agent can work (less code to search).

### Quick Win: Tight Allowlist

Instead of:

```bash
# ❌ Broad allowlist — agent searches entire codebase
export KASEKI_CHANGED_FILES_ALLOWLIST=""
export KASEKI_AGENT_TIMEOUT_SECONDS=1800
```

Use:

```bash
# ✓ Tight allowlist — agent focuses on specific files
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/lib/parser.test.ts"
export KASEKI_AGENT_TIMEOUT_SECONDS=600
```

### Impact on Performance

```
Tight allowlist (1-2 files):
  - Agent timeout: 600-900s
  - OpenRouter tokens: 3,000-5,000
  - Cost: ~$0.10-0.25

Loose allowlist (entire repo):
  - Agent timeout: 1800-3600s
  - OpenRouter tokens: 8,000-15,000
  - Cost: ~$0.30-0.75
```

### Building Effective Allowlists

**Method 1: Auto-generate from test run**

```bash
# Run once without allowlist (broader scope)
kaseki-agent run $REPO $REF "$TASK"

# Analyze what changed
bash scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-N

# Output example:
# Suggested allowlist:
# src/lib/parser.ts
# src/types.ts
# tests/lib/parser.test.ts
```

**Method 2: Use templates by task type**

```bash
# For bug fixes (usually 1-2 files)
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/*.ts tests/lib/*.test.ts"

# For feature additions (multiple components)
export KASEKI_CHANGED_FILES_ALLOWLIST="src/features/*.tsx src/types/*.ts tests/features/*.test.tsx"

# For dependency upgrades (any .json, affected code)
export KASEKI_CHANGED_FILES_ALLOWLIST="package.json package-lock.json src/**/*.{ts,tsx} tests/**/*.test.ts"
```

**Method 3: Dry-run with preview**

```bash
# Preview what agent would change without enforcement
bash scripts/dry-run-allowlist.sh $REPO $REF "$TASK"

# Shows:
# - Files agent would touch
# - Estimated allowlist
# - Diff size
```

---

## Dependency Cache Optimization

Dependency caching accelerates `npm install` when running validation commands.

### How Caching Works

```
Cache key = sha256(repo_url) + sha256(package-lock.json) +
  node_major_version

Directory structure:
/agents/kaseki-cache/
  ├── <repo-hash>/<lock-hash>/node_modules/    ← npm dependencies
  └── npm-cache/                                 ← npm package cache
```

### Enabling Cache

```bash
# Method 1: Environment variable (per-run)
export KASEKI_CACHE_ENABLED=1
kaseki-agent run $REPO $REF "$TASK"

# Method 2: Docker Compose (persistent)
# In docker-compose.yml:
volumes:
  - /agents/kaseki-cache:/cache
  
environment:
  KASEKI_CACHE_ENABLED: "1"
  KASEKI_DEPENDENCY_CACHE_DIR: /cache/dependencies
```

### Impact on Performance

**Without cache:**

- `npm ci` on each run: 30-60 seconds (fresh install)
- Suitable for: one-off runs, small projects

**With cache:**

- First run: 30-60 seconds (cache miss, builds cache)
- Subsequent runs: 5-10 seconds (cache hit)
- Suitable for: repeated runs on same repo, API service with
  multiple runs

### Monitoring Cache

```bash
# Check cache hit/miss
grep "cache" /agents/kaseki-results/kaseki-N/progress.log

# Example cache-hit line:
# [progress] dependency install: cache hit (repo: abc123, lock: def456)

# Check cache size
du -sh /agents/kaseki-cache/

# Clear cache if needed
rm -rf /agents/kaseki-cache/*
```

### Cache Invalidation

Cache is **automatically invalidated** when:

- `package-lock.json` changes (hash changes)
- Node.js version changes (container image rebuilt)
- Repository URL changes (repo hash changes)

**Manual invalidation:**

```bash
# Clear all cache
rm -rf /agents/kaseki-cache/*

# Clear cache for one repo
REPO_HASH=$(echo -n "$REPO_URL" | sha256sum | cut -d' ' -f1)
rm -rf /agents/kaseki-cache/$REPO_HASH/

# Clear npm package cache only
rm -rf /agents/kaseki-cache/npm-cache/*
```

---

## OpenRouter API Rate Limits & Cost Management

### Understanding OpenRouter Quotas

- **Rate limit**: Requests per minute (varies by model)
- **Token limit**: Monthly quota (set in account settings)
- **Concurrency limit**: Parallel requests allowed

### Checking Your Quota

```bash
# Via OpenRouter dashboard:
# https://openrouter.ai/account/limits

# Example output:
# RPM Limit: 30 requests/min
# Monthly quota: 1,000,000 tokens
# Current usage: 234,567 tokens (23.5%)
```

### Cost Estimation

```bash
# Average agent run (medium task):
# - Agent thinking: 5,000-8,000 tokens
# - Code generation: 2,000-3,000 tokens
# - Total: 7,000-11,000 tokens per run

# Cost calculation:
# OpenRouter pricing varies by model (~$0.00001 - $0.001 per token)
# Estimate: $0.10-0.50 per run

# Track actual costs
for run in /agents/kaseki-results/kaseki-*/pi-summary.json; do
  tokens=$(jq '.tokens_used' "$run")
  cost=$(echo "scale=2; $tokens * 0.00003" | bc)  # Adjust rate
  echo "$(basename $(dirname $run)): $tokens tokens (~\$$cost)"
done
```

### Cost Control Strategies

**Strategy 1: Use allowlist to reduce search space**

```bash
# Without allowlist: agent searches all 100 files
# Tokens: 10,000

# With allowlist: agent searches 2 target files
# Tokens: 5,000
# Savings: 50% ($0.10-0.15 per run)
```

**Strategy 2: Increase timeout, reduce retries**

```bash
# Short timeout (300s): agent gives up, retries needed
# Retries: 2-3 → tokens: 15,000-20,000

# Longer timeout (1800s): agent has time to solve
# Retries: 0 → tokens: 8,000
# Savings: 40% ($0.20-0.30 per run)
```

**Strategy 3: Batch similar tasks**

```bash
# Instead of running 10 separate bug fixes:
# ❌ 10 runs × 8,000 tokens = 80,000 tokens (~$2.40)

# Consider combining related fixes (if using allowlist):
# ✓ 2-3 runs × 8,000 tokens = 16,000-24,000 tokens (~$0.50-0.70)
```

### Rate Limit Handling

If you hit rate limits:

```bash
# Check current usage
curl -H "Authorization: Bearer sk-or-..." \
  https://openrouter.ai/api/v1/models | jq '.data[0].pricing'

# Implement exponential backoff in scripts
#!/bin/bash
ATTEMPT=1
MAX_ATTEMPTS=5
WAIT=10

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  if kaseki-agent run $REPO $REF "$TASK"; then
    break
  fi
  
  if [ $? -eq 429 ]; then  # Rate limit error
    echo "Rate limit hit. Waiting ${WAIT}s..."
    sleep $WAIT
    WAIT=$((WAIT * 2))
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
done
```

---

## API Service Concurrency Tuning

### Default Behavior

```
KASEKI_API_MAX_CONCURRENT_RUNS = 3
(Other runs wait in queue)
```

### When to Adjust

**Increase concurrency:**

- Queue frequently backs up (>5 pending jobs)
- Docker host has spare CPU/memory
- Multiple teams submitting tasks

```bash
export KASEKI_API_MAX_CONCURRENT_RUNS=5  # Allow 5 parallel jobs
docker-compose restart kaseki-api
```

**Decrease concurrency:**

- High CPU/memory usage on host
- OpenRouter rate limits being hit
- Docker resource constraints

```bash
export KASEKI_API_MAX_CONCURRENT_RUNS=1  # Serialize runs
docker-compose restart kaseki-api
```

### Monitoring Concurrency

```bash
# Check queue status
curl http://localhost:8080/health | jq '.queue'

# Output:
# {
#   "pending": 2,
#   "running": 3,
#   "maxConcurrent": 3
# }

# If pending >> 0, increase concurrency (or reduce timeout)
```

### Resource Scaling

Estimate resources for concurrent runs:

```
Per run:
  - CPU: 1-2 cores (agent + validation)
  - Memory: 512 MB - 1 GB (node_modules + npm ci)
  - Disk: 100-500 MB (repo clone + changes)
  - Network: 10-50 MB (code download, OpenRouter API)

Example: 4 concurrent runs on 8-core system:
  - CPU usage: ~50-80% (4 runs × 1-2 cores)
  - Memory: 2-4 GB (4 runs × 512MB-1GB)
  - Disk: 500MB-2GB (per-run workspaces)
```

---

## Validation Performance

Validation step speed depends on your repository's test/build suite, not kaseki-agent.

### Monitoring Validation Time

```bash
# View per-command timing
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv

# Output:
# command             exit_code  elapsed_seconds
# npm run check       0          15
# npm run test        0          45
# npm run build       0          30
```

### Optimizing Validation (Repository-Level)

These are **not kaseki-agent changes**, but improve overall throughput:

1. **Parallelize tests**:

   ```bash
   # Slow: 45 seconds sequential
   npm run test
   
   # Fast: 15 seconds parallel
   npm run test -- --maxWorkers=4
   ```

2. **Cache test artifacts**:

   ```bash
   # Use jest cache
   npm run test -- --cache --cacheDirectory=/tmp/jest
   ```

3. **Incremental builds**:

   ```bash
   # Rebuild only changed files
   npm run build -- --incremental
   ```

4. **Lint only changed files**:

   ```bash
   # Instead of: lint entire codebase
   npm run lint  # 30s
   
   # Use: lint only changed files
   npm run lint -- --changed-files  # 3s
   ```

---

## Summary: Typical Tuning Workflow

1. **Baseline run** (with defaults):

   ```bash
   kaseki-agent run $REPO $REF "$TASK"
   # Note exit code, elapsed time, diff size, changed files
   ```

2. **Analyze results**:

   ```bash
   cat /agents/kaseki-results/kaseki-N/pi-summary.json | jq '.elapsed_seconds'
   cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
   cat /agents/kaseki-results/kaseki-N/changed-files.txt
   ```

3. **Apply tuning** (by scenario):
   - If diff is large → tighten allowlist
   - If agent times out → increase timeout or simplify task
   - If validation is slow → this is repository-level (not kaseki)
   - If running multiple times → enable cache

4. **Repeat run** with tuning:

   ```bash
   export KASEKI_CHANGED_FILES_ALLOWLIST="..."
   export KASEKI_AGENT_TIMEOUT_SECONDS=...
   export KASEKI_CACHE_ENABLED=1
   
   kaseki-agent run $REPO $REF "$TASK"
   ```

5. **Compare metrics**:
   - Elapsed time: shorter?
   - Diff size: smaller?
   - Tokens used: fewer?
   - Cost: lower?

---

## See Also

- [QUALITY_GATES.md](QUALITY_GATES.md) — Allowlist patterns & configuration
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Diagnosing performance issues
- [EXAMPLES.md](EXAMPLES.md) — Real-world tuning patterns
