#!/usr/bin/env bash
# scripts/measure-caveman-impact.sh
#
# Measures the token usage impact of KASEKI_CAVEMAN setting.
# Runs the same task twice (caveman=0 vs caveman=1) and compares token metrics.
#
# Usage:
#   TASK_PROMPT="Fix bug in auth" REPO_URL=org/repo ./scripts/measure-caveman-impact.sh
#   ./scripts/measure-caveman-impact.sh --task "Fix bug" --repo "org/repo"
#
# Output: Markdown report with before/after token comparison

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
TASK_PROMPT="${TASK_PROMPT:-Fix parser bug in src/parser.ts}"
REPO_URL="${REPO_URL:-CyanAutomation/crudmapper}"
GIT_REF="${GIT_REF:-main}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/caveman-impact-$(date +%s)}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --task)
      TASK_PROMPT="$2"
      shift 2
      ;;
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --ref)
      GIT_REF="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

# ============================================================================
# Run with caveman=0 (verbose mode)
# ============================================================================

echo "==> Running with KASEKI_CAVEMAN=0 (verbose mode)..."
VERBOSE_RESULTS="$OUTPUT_DIR/verbose"
mkdir -p "$VERBOSE_RESULTS"

KASEKI_CAVEMAN=0 \
TASK_PROMPT="$TASK_PROMPT" \
REPO_URL="$REPO_URL" \
GIT_REF="$GIT_REF" \
KASEKI_RESULTS_DIR="$VERBOSE_RESULTS" \
  "$PROJECT_ROOT/run-kaseki.sh" || echo "Warning: verbose run failed (exit $?)"

# ============================================================================
# Run with caveman=1 (terse mode, default)
# ============================================================================

echo "==> Running with KASEKI_CAVEMAN=1 (terse mode)..."
TERSE_RESULTS="$OUTPUT_DIR/terse"
mkdir -p "$TERSE_RESULTS"

KASEKI_CAVEMAN=1 \
TASK_PROMPT="$TASK_PROMPT" \
REPO_URL="$REPO_URL" \
GIT_REF="$GIT_REF" \
KASEKI_RESULTS_DIR="$TERSE_RESULTS" \
  "$PROJECT_ROOT/run-kaseki.sh" || echo "Warning: terse run failed (exit $?)"

# ============================================================================
# Extract token metrics
# ============================================================================

extract_tokens() {
  local summary_path="$1"
  if [ ! -f "$summary_path" ]; then
    echo "ERROR: Summary file not found: $summary_path"
    return 1
  fi
  
  node -e "
const fs = require('fs');
const summary = JSON.parse(fs.readFileSync('$summary_path', 'utf8'));

const total = summary.token_usage || {};
const phases = summary.phase_token_stats || {};

console.log(JSON.stringify({
  total_input: total.total_input_tokens || 0,
  total_output: total.total_output_tokens || 0,
  total_tokens: total.total_tokens || 0,
  cache_efficiency: total.cache_efficiency_percent || 0,
  phases: phases
}, null, 2));
"
}

echo "==> Extracting token metrics..."
VERBOSE_TOKENS=$(extract_tokens "$VERBOSE_RESULTS/pi-summary.json")
TERSE_TOKENS=$(extract_tokens "$TERSE_RESULTS/pi-summary.json")

# ============================================================================
# Generate comparison report
# ============================================================================

REPORT_PATH="$OUTPUT_DIR/caveman-impact-report.md"

cat > "$REPORT_PATH" <<'EOREPORT'
# Caveman Token Usage Impact Report

## Test Configuration

- **Task**: `${TASK_PROMPT}`
- **Repository**: `${REPO_URL}`
- **Ref**: `${GIT_REF}`
- **Date**: $(date -Iseconds)

---

## Token Usage Comparison

### Verbose Mode (KASEKI_CAVEMAN=0)

```json
${VERBOSE_TOKENS}
```

### Terse Mode (KASEKI_CAVEMAN=1)

```json
${TERSE_TOKENS}
```

---

## Impact Analysis

EOREPORT

# Calculate deltas using Node.js
node -e "
const verbose = $VERBOSE_TOKENS;
const terse = $TERSE_TOKENS;

const inputDelta = verbose.total_input - terse.total_input;
const outputDelta = verbose.total_output - terse.total_output;
const totalDelta = verbose.total_tokens - terse.total_tokens;

const inputPct = verbose.total_input > 0 ? ((inputDelta / verbose.total_input) * 100).toFixed(1) : '0.0';
const outputPct = verbose.total_output > 0 ? ((outputDelta / verbose.total_output) * 100).toFixed(1) : '0.0';
const totalPct = verbose.total_tokens > 0 ? ((totalDelta / verbose.total_tokens) * 100).toFixed(1) : '0.0';

console.log('### Overall Token Reduction\\n');
console.log('| Metric | Verbose | Terse | Delta | Reduction % |');
console.log('|--------|---------|-------|-------|-------------|');
console.log(\`| Input tokens | \${verbose.total_input.toLocaleString()} | \${terse.total_input.toLocaleString()} | \${inputDelta.toLocaleString()} | \${inputPct}% |\`);
console.log(\`| Output tokens | \${verbose.total_output.toLocaleString()} | \${terse.total_output.toLocaleString()} | \${outputDelta.toLocaleString()} | \${outputPct}% |\`);
console.log(\`| **Total tokens** | **\${verbose.total_tokens.toLocaleString()}** | **\${terse.total_tokens.toLocaleString()}** | **\${totalDelta.toLocaleString()}** | **\${totalPct}%** |\`);
console.log('');

// Per-phase comparison
console.log('### Per-Phase Token Comparison\\n');
const allPhases = new Set([...Object.keys(verbose.phases || {}), ...Object.keys(terse.phases || {})]);

if (allPhases.size > 0) {
  console.log('| Phase | Verbose Total | Terse Total | Delta | Reduction % |');
  console.log('|-------|---------------|-------------|-------|-------------|');
  
  for (const phase of allPhases) {
    const vPhase = verbose.phases[phase] || { total_tokens: 0 };
    const tPhase = terse.phases[phase] || { total_tokens: 0 };
    const delta = vPhase.total_tokens - tPhase.total_tokens;
    const pct = vPhase.total_tokens > 0 ? ((delta / vPhase.total_tokens) * 100).toFixed(1) : '0.0';
    
    console.log(\`| \${phase} | \${vPhase.total_tokens.toLocaleString()} | \${tPhase.total_tokens.toLocaleString()} | \${delta.toLocaleString()} | \${pct}% |\`);
  }
} else {
  console.log('*No per-phase data available (requires updated pi-event-filter)*');
}
console.log('');

// Recommendations
console.log('### Recommendations\\n');
if (totalDelta > 0 && Number(totalPct) >= 10) {
  console.log(\`✅ **Caveman mode is effective**: \${totalPct}% total token reduction observed.\\n\`);
} else if (totalDelta > 0 && Number(totalPct) < 10) {
  console.log(\`⚠️  **Marginal impact**: Only \${totalPct}% reduction. Consider additional optimizations.\\n\`);
} else {
  console.log(\`❌ **No benefit observed**: Caveman mode did not reduce token usage. Check implementation.\\n\`);
}

// Cost impact
const avgCostPer1M = 0.50; // USD per 1M tokens (typical model)
const costSavings = (totalDelta / 1000000) * avgCostPer1M;
console.log(\`**Estimated cost savings**: ~$\${costSavings.toFixed(4)} per run (at $\${avgCostPer1M}/1M tokens)\\n\`);
" >> "$REPORT_PATH"

echo ""
echo "✓ Report generated: $REPORT_PATH"
echo ""
cat "$REPORT_PATH"
