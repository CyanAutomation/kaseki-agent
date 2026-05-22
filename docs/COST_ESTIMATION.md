# Cost Estimation & Budget Planning

Guide to understanding and managing costs associated with kaseki-agent operations.

---

## Cost Components

kaseki-agent costs break down into three categories:

### 1. OpenRouter API Costs (Primary)

**What you pay for:** Token usage on the Pi coding agent model.

**Pricing Model:**

- Per-token billing (input + output tokens)
- Pricing varies by model ($0.00001 - $0.01+ per token)
- Charged by OpenRouter

**Average Cost Per Run:**

| Task Type | Estimated Tokens | Estimated Cost |
|-----------|---|---|
| Simple bug fix (1 file) | 5,000-8,000 | $0.10-0.30 |
| Feature addition (3-5 files) | 8,000-12,000 | $0.20-0.50 |
| Complex refactoring | 12,000-20,000 | $0.30-1.00 |
| Full test suite generation | 10,000-15,000 | $0.25-0.75 |

**Monthly Estimate:**

- 10 runs/month: $1-5
- 50 runs/month: $5-25
- 200 runs/month: $20-100
- 500+ runs/month: $50+

### 2. Infrastructure Costs (Secondary)

**What you pay for:** Hosting, storage, compute resources.

| Component | Hosting | Cost/Month |
|-----------|---|---|
| API service instance | AWS t3.small | $10-20 |
| Worker instances | AWS t3.medium (per instance) | $20-40 |
| Shared storage (NFS/EFS) | AWS EFS 1 TB | $30-50 |
| Shared storage (S3) | AWS S3 100 GB | $2-3 |
| Docker registry (if private) | ECR | $0.50 per GB |
| Load balancer | AWS ELB | $16 |
| **Total (single host)** | — | **$10-30** |
| **Total (3-host HA)** | — | **$100-200** |

### 3. Operational Costs (Tertiary)

**What you pay for:** Personnel time, monitoring, support.

| Item | Estimate |
|---|---|
| Initial setup (one-time) | 4-8 hours engineering |
| Maintenance (monthly) | 2-4 hours engineering |
| On-call rotation | Variable per org |
| Monitoring/alerting | Included with most platforms |

---

## Cost Calculator

### Calculate Per-Run Cost

**Formula:**

```
Cost per run = (Input tokens + Output tokens) × Price per token
```

**Typical OpenRouter Models (as of May 2026):**

| Model | Input Price/1M | Output Price/1M | Avg Input Tokens | Avg Output Tokens | Approx Cost |
|---|---|---|---|---|---|
| openrouter/free | Variable | Variable | 5,000 | 3,000 | $0.05-0.20 |
| gpt-4-turbo | $0.01 | $0.03 | 6,000 | 4,000 | $0.18 |
| claude-3-opus | $0.015 | $0.075 | 5,500 | 3,500 | $0.31 |
| gemini-pro | $0.0005 | $0.0015 | 5,000 | 3,000 | $0.01 |

**Example Calculation:**

```
Task: Fix null pointer bug
Model: gpt-4-turbo
Input: 6,000 tokens × $0.01/1M = $0.06
Output: 4,000 tokens × $0.03/1M = $0.12
Total: $0.18 per run

Monthly (50 runs): $0.18 × 50 = $9.00
```

### Calculate Infrastructure Cost

**Single-Host Setup (Small):**

```
API instance:     t3.small  = $15/month
Storage:          10 GB EBS = $1/month
Total:                       = $16/month
```

**3-Host HA Setup (Medium):**

```
3x API instances: t3.medium = $60/month
EFS (500 GB):                = $35/month
Load balancer:               = $16/month
Total:                       = $111/month
```

**Large Setup with Private Registry:**

```
5x Worker instances:         = $200/month
API instances (2x):          = $40/month
EFS (2 TB):                  = $60/month
S3 (backups):                = $5/month
ECR (Docker registry):       = $0.50/month
Total:                       = $305.50/month
```

---

## Cost Optimization Strategies

### Strategy 1: Use Tight Allowlists (Highest ROI)

**Impact:** 30-50% reduction in tokens used

```bash
# ❌ Loose allowlist
export KASEKI_CHANGED_FILES_ALLOWLIST=""
# Agent searches entire codebase
# Tokens: 8,000 → Cost: $0.20

# ✓ Tight allowlist
export KASEKI_CHANGED_FILES_ALLOWLIST="src/parser.ts tests/parser.test.ts"
# Agent focuses on 2 files
# Tokens: 4,000 → Cost: $0.10
# Savings: 50%
```

**Implementation Cost:** 5 minutes to review changed files once

**ROI:** Break-even after ~30 runs

### Strategy 2: Increase Timeout (Reduce Retries)

**Impact:** 20-40% reduction if retries are common

```bash
# ❌ Short timeout (many retries)
export KASEKI_AGENT_TIMEOUT_SECONDS=300
# Average retries: 2-3
# Total tokens/cost: ×2-3

# ✓ Longer timeout (fewer retries)
export KASEKI_AGENT_TIMEOUT_SECONDS=1800
# Average retries: 0-1
# Total tokens/cost: ×1

# Savings: ~50% when retries are eliminated
```

**Implementation Cost:** Configuration change

**ROI:** Immediate if retries are happening

### Strategy 3: Cheaper Model Selection

**Impact:** 50-90% reduction in per-token cost

```bash
# ❌ Expensive model
export KASEKI_MODEL="anthropic/claude-3-opus"
# Cost: $0.31 per run

# ✓ Budget model
export KASEKI_MODEL="google/gemini-pro"
# Cost: $0.01 per run
# Savings: 97% per run

# Trade-off: Model quality/capability lower
```

**Best for:** Simple tasks (bug fixes, test generation)
**Not recommended for:** Complex refactoring, architecture changes

### Strategy 4: Batch Similar Tasks

**Impact:** Reduced total overhead

```bash
# ❌ Serial execution
# 10 separate runs × 8,000 tokens = 80,000 tokens
# Cost: $2.40

# ✓ Combined execution
# 3 combined runs × 8,000 tokens = 24,000 tokens
# Cost: $0.72
# Savings: 70%

# Trade-off: Less granular control
```

**Best for:** Bulk operations (add tests to 10 files)

### Strategy 5: Cache Dependencies

**Impact:** 5-10% faster validation → lower timeouts

```bash
# ❌ No caching
export KASEKI_CACHE_ENABLED=0
# npm install: 60 seconds per run

# ✓ Enable caching
export KASEKI_CACHE_ENABLED=1
# npm install: 5 seconds (hit) or 60 seconds (miss)
# Average: 15 seconds
# Savings: Indirectly reduces timeout needed
```

**Implementation Cost:** Negligible; automatic

**ROI:** Immediate on repeated tasks

### Strategy 6: Reduce Validation

**Impact:** 5-15% time savings (if validation is slow)

```bash
# ✓ Default validation (recommended)
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test"
# Time: 60-90 seconds

# ❌ Minimal validation (no type checking or linting)
export KASEKI_VALIDATION_COMMANDS="npm run test"
# Time: 30-45 seconds
# Savings: ~40%

# Trade-off: Less quality assurance (no linting/type checks)
```

**Best for:** When you have other verification (manual review, CI)

---

## Cost Monitoring

### Track Per-Run Costs

```bash
#!/bin/bash
# track-costs.sh

for run in /agents/kaseki-results/kaseki-*/pi-summary.json; do
  TOKENS=$(jq '.tokens_used' "$run")
  
  # Estimate cost (adjust rate based on your model)
  RATE=0.0001  # Example: $0.0001 per token
  COST=$(echo "scale=4; $TOKENS * $RATE" | bc)
  
  INSTANCE=$(basename $(dirname "$run"))
  echo "$INSTANCE: $TOKENS tokens (~\$$COST)"
done
```

### Monthly Cost Report

```bash
#!/bin/bash
# monthly-cost-report.sh

MONTH="${1:-$(date +%Y-%m)}"

echo "=== Kaseki Agent Cost Report: $MONTH ==="

# Count runs
RUNS=$(find /agents/kaseki-results -type d -name "kaseki-*" \
  -newermt "${MONTH}-01" ! -newermt "$(date -d "${MONTH}-01 +1 month" +%Y-%m-%d)" | wc -l)

# Total tokens
TOTAL_TOKENS=0
for run in /agents/kaseki-results/kaseki-*/pi-summary.json; do
  [ -f "$run" ] && TOTAL_TOKENS=$((TOTAL_TOKENS + $(jq -r '.tokens_used // 0' "$run")))
done

# Estimate cost
RATE=0.0001
COST=$(echo "scale=2; $TOTAL_TOKENS * $RATE" | bc)

echo "Runs: $RUNS"
echo "Tokens: $TOTAL_TOKENS"
echo "Estimated Cost: \$$COST"
echo "Cost per Run: \$$(echo "scale=4; $COST / $RUNS" | bc)"
```

### Set Budget Alerts

```bash
# In your monitoring system (e.g., Prometheus, CloudWatch)

# Alert if monthly estimated cost exceeds budget
IF monthly_kaseki_cost_estimate > $50 THEN
  NOTIFY team@example.com "Kaseki costs exceeding budget"
END

# Alert if cost per run is unusually high
IF kaseki_run_cost > $1 THEN
  NOTIFY team@example.com "High-cost run: check logs"
END
```

---

## Cost Benchmarks by Deployment

### Development / Testing

```
Runs per month:     20
Avg tokens/run:     6,000
Model cost/token:   $0.00005 (free tier)

Monthly API cost:   $6
Infrastructure:     $0 (local laptop)
Total:              $6

Cost per run:       $0.30
```

### Small Production (Single Host)

```
Runs per month:     50
Avg tokens/run:     7,000
Model cost/token:   $0.00005

Monthly API cost:   $17.50
Infrastructure:     $16
Total:              $33.50

Cost per run:       $0.67
```

### Medium Production (3-Host HA)

```
Runs per month:     200
Avg tokens/run:     8,000
Model cost/token:   $0.0001

Monthly API cost:   $160
Infrastructure:     $111
Total:              $271

Cost per run:       $1.35
```

### Large Production (Distributed, Private Registry)

```
Runs per month:     500
Avg tokens/run:     7,000 (optimized)
Model cost/token:   $0.00003 (discount plan)

Monthly API cost:   $105
Infrastructure:     $305.50
Total:              $410.50

Cost per run:       $0.82
```

---

## Budget Planning Worksheet

```markdown
## Kaseki Agent Budget Planning

### Projected Usage
- Runs per month: _____
- Expected growth: _____% per month

### Model Selection
- Primary model: _____
- Token cost (input): $_____/1M
- Token cost (output): $_____/1M
- Avg tokens per run: _____

### Cost Calculation
- API cost per run: $_____ = (avg tokens × combined rate)
- Runs per month: _____
- Monthly API cost: $_____ = (cost per run × runs)
- Annual API cost: $_____ = (monthly × 12)

### Infrastructure
- Hosting model: [Single-host / HA / Distributed]
- Monthly cost: $_____
- Annual cost: $_____

### Total Budget
- Monthly: $_____
- Annual: $_____

### Optimization Targets
- Reduce cost by implementing: [allowlist / timeout / cheaper model / ...]
- Target cost: $_____
- Projected savings: $_____ / month
```

---

## See Also

- [PERFORMANCE_TUNING.md](PERFORMANCE_TUNING.md) — Optimization strategies (overlaps with cost)
- [ENV_VARS.md](ENV_VARS.md) — Configuration for tuning
- [EXAMPLES.md](EXAMPLES.md) — Real-world scenarios with estimated costs
