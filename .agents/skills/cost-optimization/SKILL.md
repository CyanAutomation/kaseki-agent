---
name: cost-optimization
description: Cost analysis, budgeting, and optimization strategies for kaseki-agent deployments
tags: [kaseki, cost, budget, optimization, token-usage, roi]
relatedSkills: [prompt-engineering, quality-gate-config, dependency-cache-optimization, performance-tuning, environment-configuration]
---

# Cost Optimization for Kaseki Agent

This skill guides cost analysis, budgeting, and optimization for kaseki-agent deployments to reduce API expenses and maximize ROI.

## Overview

**When to Use**:
- Estimating costs for a new kaseki rollout
- Optimizing existing runs to reduce spending
- Planning budgets for team or organizational deployment
- Analyzing cost-benefit of different strategies
- Tracking spending and setting cost alerts

**Key Concepts**:
- OpenRouter API costs are primary expense (80%+ of total cost)
- Token usage scales with task scope (tight allowlist = fewer tokens)
- Batch operations achieve 30–70% cost savings
- Different LLM models have dramatically different prices
- Caching and validation optimization also reduce costs

---

## Cost Components

### Primary Cost: OpenRouter API

**Cost Structure**:
```
Cost = (Input Tokens × Input Price + Output Tokens × Output Price) / 1M
```

**Example Models** (prices per 1M tokens):

| Model | Input | Output | Cost per Run (Typical) |
|---|---|---|---|
| openrouter/free | $0.00 | $0.00 | **Free** |
| claude-3.5-sonnet | $3 | $15 | $0.15–0.30 |
| gpt-4 | $30 | $60 | $0.50–1.00 |
| gpt-4-turbo | $10 | $30 | $0.20–0.40 |
| claude-3-opus | $15 | $75 | $0.30–0.60 |

**Default**: `openrouter/free` (uses whatever is cheapest/available)

### Secondary Costs: Infrastructure

- **Docker compute**: ~$0.02–0.10 per run (ephemeral container)
- **Storage**: ~$0.01–0.05 per run (artifact logs, diff files)
- **Network**: ~$0.01 per run (GitHub API calls, OpenRouter API)

**Total Infrastructure**: ~$0.04–0.15 per run (typically 10–20% of API cost)

### Operational Costs

- **Human time** for troubleshooting, monitoring, optimization
- **Maintenance** of CI/CD pipelines and deployment infrastructure
- **Uptime SLA** and monitoring services

---

## Cost Calculator

### Per-Run Estimation

**Formula**:
```
Cost = Task Complexity × Token Multiplier × Model Price
```

**Typical Cost Ranges**:

| Task Type | Files | Token Range | Cost (free model) | Cost (sonnet) |
|---|---|---|---|---|
| **Small bug fix** | 1–2 | 600–900 | Free | $0.03–0.05 |
| **Add tests** | 2–3 | 1,000–1,500 | Free | $0.05–0.10 |
| **Single feature** | 3–5 | 1,500–3,000 | Free | $0.10–0.20 |
| **Multi-file refactor** | 5–10 | 3,000–8,000 | Free | $0.20–0.40 |
| **Complex feature** | 10+ | 8,000–20,000 | Free | $0.40–1.00 |

**Quick Calculator**:
```bash
# Estimate tokens from allowlist size
TOKEN_ESTIMATE=$(echo "files_in_allowlist * 300" | bc)
COST=$(echo "scale=4; $TOKEN_ESTIMATE * 15 / 1000000" | bc)
echo "Estimated cost (Claude Sonnet): \$$COST"
```

### Monthly Budget Planning

**Scenario**: Team of 5 engineers, 10 kaseki runs per day (50/day company-wide)

**Using Free Model**:
- Cost: **$0** (free tier always available via openrouter/free)
- Monthly: **$0**

**Using Claude Sonnet** (if free tier unavailable):
- Cost per run: ~$0.15 (average)
- Daily: 50 runs × $0.15 = **$7.50**
- Monthly: **$225** (30 days)
- Annual: **$2,700**

**Using GPT-4**:
- Cost per run: ~$0.50
- Daily: 50 runs × $0.50 = **$25**
- Monthly: **$750**
- Annual: **$9,000**

---

## Optimization Strategies

### Strategy 1: Use Free Model (30–50% savings if forced to paid)

Kaseki defaults to `openrouter/free`, which routes to the cheapest available model (usually Claude Haiku or similar free-tier option).

**When**: For routine tasks, always use free model
**Impact**: $0 (free), vs. $0.20–0.30 per run for paid models
**Savings**: 100% if you'd otherwise use paid model

```bash
# Explicitly use free model
KASEKI_MODEL=openrouter/free ./run-kaseki.sh

# Or accept default (already free)
./run-kaseki.sh
```

### Strategy 2: Tight Allowlist (30–50% cost reduction)

Tighter allowlists reduce token usage because agent explores fewer files.

**Impact**: Tight (2 files) vs. Loose (50+ files)

| Allowlist | Token Usage | Cost (Sonnet) | Time |
|---|---|---|---|
| Tight (1–2 files) | 700 | $0.05 | 8 min |
| Moderate (5–10 files) | 2,000 | $0.15 | 15 min |
| Loose (50+ files) | 5,000 | $0.35 | 25 min |

**ROI**: 30-minute allowlist design effort → saves $0.30 per run → breaks even after 1 run

```bash
# Design tight allowlist
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts"

# vs. loose (explores unnecessary code)
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
```

### Strategy 3: Increase Timeout (20–40% cost reduction via faster completion)

Longer timeout allows agent to think through problem more thoroughly, reducing token thrashing and retries.

**Counterintuitive**: Longer timeout → faster completion → lower cost

**Impact**:
- 20-minute timeout: Agent rushes, tries many dead ends → 20,000 tokens
- 40-minute timeout: Agent plans, explores systematically → 8,000 tokens

**ROI**: Small config change → saves $0.10+ per run

```bash
# Default timeout (too short for complex tasks)
KASEKI_AGENT_TIMEOUT_SECONDS=1200  # 20 min

# Extended timeout (better for complex changes)
KASEKI_AGENT_TIMEOUT_SECONDS=2400  # 40 min
```

### Strategy 4: Batch Tasks (70% cost reduction via amortization)

Run multiple related tasks in sequence; reuse same environment and cache.

**Impact**:
- **Sequential runs**: 5 tasks × $0.15 each = $0.75
- **Batch run**: 5 tasks × $0.12 each (shared overhead) = $0.60 (20% savings)
- **Optimized batch**: 5 tasks × $0.05 each (tight allowlists + shared cache) = $0.25 (70% savings!)

**Example**:
```bash
#!/bin/bash
# Batch 5 related bug fixes

for bug in parser validator formatter normalizer sanitizer; do
  export TASK_PROMPT="Fix $bug.ts..."
  export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/${bug}.ts tests/${bug}.test.ts"
  
  ./run-kaseki.sh kaseki-batch-$bug
done

# Result: 5 runs, shared cache, saves ~$0.50
```

### Strategy 5: Validation Optimization (5–15% time savings)

Skip or parallelize validation commands to reduce overall execution time.

**Impact**:
- Full validation: `npm run check;npm run test;npm run build` = 10 min
- Targeted validation: `npm run test -- tests/parser.test.ts` = 3 min
- Savings: 7 minutes × (cost-per-minute) = modest but cumulative

**Example**:
```bash
# Targeted validation (only test changed module)
KASEKI_VALIDATION_COMMANDS="npm run test -- tests/parser.test.ts"

# vs. full validation
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
```

### Strategy 6: Dependency Cache Tuning (5–10% time savings via fewer installs)

Maximize cache hits to skip `npm ci` and save install time.

**Impact**:
- Cache hit: Skip npm (0 sec)
- Seed cache: Restore from image (30 sec)
- Fresh install: Download packages (180 sec)

**Example**:
```bash
# Ensure lock file is not changing unnecessarily
# Check before task:
git diff package-lock.json

# If changing, consider committing to main first
# to populate cache for subsequent runs
```

---

## Cost Monitoring & Tracking

### Manual Tracking Script

```bash
#!/bin/bash
# Track spending across recent runs

TOTAL_COST=0
for run in /agents/kaseki-results/kaseki-*/; do
  # Estimate tokens from pi-summary.json
  TOKENS=$(jq '.token_estimate // 1000' "$run/pi-summary.json" 2>/dev/null)
  
  # Assume Claude Sonnet prices
  INPUT_PRICE=3   # $3 per 1M input tokens
  OUTPUT_PRICE=15 # $15 per 1M output tokens
  
  # Rough estimate: input + output
  ESTIMATED_COST=$(echo "scale=4; ($TOKENS * 2) * $INPUT_PRICE / 1000000" | bc)
  TOTAL_COST=$(echo "scale=2; $TOTAL_COST + $ESTIMATED_COST" | bc)
  
  echo "$(basename $run): ~\$$ESTIMATED_COST"
done

echo "---"
echo "Total estimated: \$$TOTAL_COST"
```

### Production Cost Dashboard

For full cost tracking, monitoring, and alerting, see [COST_ESTIMATION.md](../../docs/COST_ESTIMATION.md).

---

## ROI Analysis Examples

### Example 1: Bug Fix Automation

**Manual approach**:
- Engineer time: 2 hours @ $100/hr = **$200**
- Result: One bug fixed

**Kaseki approach**:
- Kaseki cost: $0.10 (API + infrastructure)
- Engineer time: 15 minutes (design prompt, verify) = $25
- Total: **$25.10**
- **Savings: $175 per fix** (87% ROI)

### Example 2: Test Coverage Addition

**Manual approach**:
- Engineer time: 3 hours = **$300**

**Kaseki approach**:
- Kaseki cost: $0.20 (more complex task)
- Engineer time: 30 minutes = $50
- Total: **$50.20**
- **Savings: $250** (83% ROI)

### Example 3: Batch Refactoring (5 modules)

**Manual approach**:
- Engineer time: 10 hours = **$1,000**

**Kaseki approach**:
- 5 kaseki runs × $0.12 (batched) = $0.60
- Engineer time: 1 hour (design prompts, verify) = $100
- Total: **$100.60**
- **Savings: $900** (90% ROI)

---

## Budget Planning Worksheet

```bash
#!/bin/bash
# Fill in your numbers

TEAM_SIZE=5
RUNS_PER_ENGINEER_PER_DAY=3
DAYS_PER_MONTH=22
COST_PER_RUN_ESTIMATE=0.15  # Claude Sonnet avg

TOTAL_RUNS_PER_MONTH=$((TEAM_SIZE * RUNS_PER_ENGINEER_PER_DAY * DAYS_PER_MONTH))
ESTIMATED_MONTHLY_COST=$(echo "scale=2; $TOTAL_RUNS_PER_MONTH * $COST_PER_RUN_ESTIMATE" | bc)
ESTIMATED_ANNUAL_COST=$(echo "scale=2; $ESTIMATED_MONTHLY_COST * 12" | bc)

echo "=== Kaseki Cost Budget ==="
echo "Team size: $TEAM_SIZE engineers"
echo "Runs per engineer per day: $RUNS_PER_ENGINEER_PER_DAY"
echo "Working days per month: $DAYS_PER_MONTH"
echo "Cost per run (avg): \$$COST_PER_RUN_ESTIMATE"
echo ""
echo "Total runs per month: $TOTAL_RUNS_PER_MONTH"
echo "Estimated monthly cost: \$$ESTIMATED_MONTHLY_COST"
echo "Estimated annual cost: \$$ESTIMATED_ANNUAL_COST"
echo ""
echo "ROI (if engineers saved 30 min per day):"
echo "Time saved: $TEAM_SIZE engineers × 0.5 hours × $DAYS_PER_MONTH × 12 months = \$$(echo "scale=2; $TEAM_SIZE * 0.5 * $DAYS_PER_MONTH * 12 * 50" | bc) per year"
```

---

## See Also

- [COST_ESTIMATION.md](../../docs/COST_ESTIMATION.md) — Authoritative cost reference and detailed analysis
- [PERFORMANCE_TUNING.md](../../docs/PERFORMANCE_TUNING.md) — Tuning strategies with cost impact
- [quality-gate-config](quality-gate-config.md) — Allowlist design for cost control
- [environment-configuration](environment-configuration.md) — Model selection and API configuration
