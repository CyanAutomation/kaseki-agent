#!/usr/bin/env bash
# kaseki-maturity-score.sh
# Calculates the kaseki-agent repository maturity score and outputs JSON
# 
# This script evaluates the repository against 9 maturity signal categories:
# 1. Setup & Installation
# 2. Testing & Quality  
# 3. CI/CD & Automation
# 4. Documentation
# 5. Governance
# 6. Security
# 7. Operability
# 8. Performance & Efficiency
# 9. Maintenance & Sustainability
#
# Usage: kaseki-maturity-score.sh [repo_path] [output_json_file]
# Default: uses /workspace/repo and outputs to /results/maturity-score.json

set -euo pipefail

REPO_PATH="${1:-.}"
OUTPUT_FILE="${2:-/results/maturity-score.json}"

# Score tracking variables
SETUP_SCORE=0
TESTING_SCORE=0
CICD_SCORE=0
DOCS_SCORE=0
GOVERNANCE_SCORE=0
SECURITY_SCORE=0
OPERABILITY_SCORE=0
PERFORMANCE_SCORE=0
MAINTENANCE_SCORE=0

evaluate_setup() {
  local score=0
  
  # Check for package.json (1 point)
  [ -f "$REPO_PATH/package.json" ] && score=$((score + 1))
  
  # Check for package-lock.json (1 point)
  [ -f "$REPO_PATH/package-lock.json" ] && score=$((score + 1))
  
  # Check for TypeScript config (1 point)
  [ -f "$REPO_PATH/tsconfig.json" ] && score=$((score + 1))
  
  # Check for Dockerfile (1 point)
  [ -f "$REPO_PATH/Dockerfile" ] && score=$((score + 1))
  
  # Check for README (1 point)
  [ -f "$REPO_PATH/README.md" ] && score=$((score + 1))
  
  # Check for .gitignore (1 point)
  [ -f "$REPO_PATH/.gitignore" ] && score=$((score + 1))
  
  # Check for Node.js version pinned in Dockerfile (1 point)
  grep -q "node:" "$REPO_PATH/Dockerfile" 2>/dev/null && score=$((score + 1))
  
  SETUP_SCORE="$score"
}

evaluate_testing() {
  local score=0
  
  # Check for jest/test config (1 point)
  [ -f "$REPO_PATH/jest.config.ts" ] || [ -f "$REPO_PATH/jest.config.js" ] && score=$((score + 1))
  
  # Check for test directory (1 point)
  [ -d "$REPO_PATH/test" ] && score=$((score + 1))
  
  # Check for src test files (1 point)
  find "$REPO_PATH/src" -name "*.test.ts" -o -name "*.test.js" 2>/dev/null | grep -q . && score=$((score + 1))
  
  # Check for ESLint config (1 point)
  [ -f "$REPO_PATH/.eslintrc" ] || [ -f "$REPO_PATH/.eslintrc.json" ] || [ -f "$REPO_PATH/.eslintrc.js" ] && score=$((score + 1))
  
  # Check for TypeScript strict mode (1 point)
  grep -q '"strict":\s*true' "$REPO_PATH/tsconfig.json" 2>/dev/null && score=$((score + 1))
  
  TESTING_SCORE="$score"
}

evaluate_cicd() {
  local score=0
  
  # Check for GitHub Actions workflows (2 points)
  [ -d "$REPO_PATH/.github/workflows" ] && score=$((score + 2))
  
  # Check for build workflow (1 point)
  find "$REPO_PATH/.github/workflows" -name "*.yml" -o -name "*.yaml" 2>/dev/null | xargs grep -l "build\|docker" 2>/dev/null | grep -q . && score=$((score + 1))
  
  # Check for Dependabot config (1 point)
  [ -f "$REPO_PATH/.github/dependabot.yml" ] && score=$((score + 1))
  
  # Check for shell linting in workflows (1 point)
  find "$REPO_PATH/.github/workflows" -name "*.yml" 2>/dev/null | xargs grep -l "shellcheck" 2>/dev/null | grep -q . && score=$((score + 1))
  
  CICD_SCORE="$score"
}

evaluate_docs() {
  local score=0
  
  # Check for CONTRIBUTING.md (1 point)
  [ -f "$REPO_PATH/CONTRIBUTING.md" ] && score=$((score + 1))
  
  # Check for CLAUDE.md (1 point)
  [ -f "$REPO_PATH/CLAUDE.md" ] && score=$((score + 1))
  
  # Check for docs directory (1 point)
  [ -d "$REPO_PATH/docs" ] && score=$((score + 1))
  
  # Check for repo-maturity.md (1 point)
  [ -f "$REPO_PATH/docs/repo-maturity.md" ] && score=$((score + 1))
  
  # Check for well-structured README (1 point)
  grep -q "## \|### " "$REPO_PATH/README.md" 2>/dev/null && score=$((score + 1))
  
  DOCS_SCORE="$score"
}

evaluate_governance() {
  local score=0
  
  # Check for issue templates (1 point)
  [ -d "$REPO_PATH/.github/ISSUE_TEMPLATE" ] && [ "$(find "$REPO_PATH/.github/ISSUE_TEMPLATE" -type f | wc -l)" -gt 0 ] && score=$((score + 1))
  
  # Check for PR template (1 point)
  [ -d "$REPO_PATH/.github/PULL_REQUEST_TEMPLATE" ] && [ "$(find "$REPO_PATH/.github/PULL_REQUEST_TEMPLATE" -type f | wc -l)" -gt 0 ] && score=$((score + 1))
  
  # Check for STYLE.md or style guide (0.5 points, counted as 1 if present)
  [ -f "$REPO_PATH/STYLE.md" ] && score=$((score + 1))
  
  GOVERNANCE_SCORE="$score"
}

evaluate_security() {
  local score=0
  
  # Check for Trivy scanning in CI (1.5 points, rounded to 1 or 2)
  find "$REPO_PATH/.github/workflows" -name "*.yml" 2>/dev/null | xargs grep -l "trivy\|Trivy" 2>/dev/null | grep -q . && score=$((score + 2))
  
  # Check for no hardcoded secrets (1 point)
  ! find "$REPO_PATH/src" -type f \( -name "*.ts" -o -name "*.js" \) 2>/dev/null | xargs grep -l "sk-or-\|OPENROUTER_API_KEY=" 2>/dev/null | grep -q . && score=$((score + 1))
  
  # Check for Dockerfile security flags (1 point)
  grep -q "cap-drop\|read-only\|security-opt" "$REPO_PATH/Dockerfile" 2>/dev/null && score=$((score + 1))
  
  SECURITY_SCORE="$score"
}

evaluate_operability() {
  local score=0
  
  # Check for --dry-run support (1 point)
  grep -q "KASEKI_DRY_RUN\|--dry-run" "$REPO_PATH/run-kaseki.sh" 2>/dev/null && score=$((score + 1))
  
  # Check for structured logging (1 point)
  grep -q "json_encode\|emit_progress\|emit_json_log" "$REPO_PATH/run-kaseki.sh" 2>/dev/null && score=$((score + 1))
  
  # Check for health check script (1 point)
  [ -f "$REPO_PATH/scripts/kaseki-healthcheck.sh" ] && score=$((score + 1))
  
  # Check for metrics/timing tracking (1 point)
  grep -q "stage-timings\|validation-timings" "$REPO_PATH/kaseki-agent.sh" 2>/dev/null && score=$((score + 1))
  
  OPERABILITY_SCORE="$score"
}

evaluate_performance() {
  local score=0
  
  # Check for dependency caching (2 points)
  grep -q "kaseki-cache\|KASEKI_DEPENDENCY_CACHE_DIR" "$REPO_PATH/kaseki-agent.sh" 2>/dev/null && score=$((score + 2))
  
  # Check for build cache in Dockerfile (1 point)
  grep -q "cache" "$REPO_PATH/Dockerfile" 2>/dev/null && score=$((score + 1))
  
  # Check for multi-stage build (1 point)
  grep -c "FROM" "$REPO_PATH/Dockerfile" 2>/dev/null | grep -q "[2-9]" && score=$((score + 1))
  
  PERFORMANCE_SCORE="$score"
}

evaluate_maintenance() {
  local score=0
  
  # Check for SECURITY.md (1 point)
  [ -f "$REPO_PATH/SECURITY.md" ] && score=$((score + 1))
  
  # Check for LICENSE (1 point)
  [ -f "$REPO_PATH/LICENSE" ] || [ -f "$REPO_PATH/LICENSE.md" ] && score=$((score + 1))
  
  # Check for version consistency (1 point)
  grep -q '"version"' "$REPO_PATH/package.json" 2>/dev/null && score=$((score + 1))
  
  MAINTENANCE_SCORE="$score"
}

# Run all evaluations
evaluate_setup
evaluate_testing
evaluate_cicd
evaluate_docs
evaluate_governance
evaluate_security
evaluate_operability
evaluate_performance
evaluate_maintenance

# Calculate total score
TOTAL_SCORE=$((
  SETUP_SCORE +
  TESTING_SCORE +
  CICD_SCORE +
  DOCS_SCORE +
  GOVERNANCE_SCORE +
  SECURITY_SCORE +
  OPERABILITY_SCORE +
  PERFORMANCE_SCORE +
  MAINTENANCE_SCORE
))

# Maximum possible score
MAX_SCORE=50  # Calculated from all categories above

# Percentage
PERCENTAGE=$((TOTAL_SCORE * 100 / MAX_SCORE))

# Output JSON
mkdir -p "$(dirname "$OUTPUT_FILE")"
cat > "$OUTPUT_FILE" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "total_score": $TOTAL_SCORE,
  "max_score": $MAX_SCORE,
  "percentage": $PERCENTAGE,
  "rating": "$(
    if [ $TOTAL_SCORE -ge 45 ]; then
      echo "Exemplary"
    elif [ $TOTAL_SCORE -ge 40 ]; then
      echo "Mature"
    elif [ $TOTAL_SCORE -ge 30 ]; then
      echo "Capable"
    else
      echo "Developing"
    fi
  )",
  "categories": {
    "setup_and_installation": {
      "score": $SETUP_SCORE,
      "max": 7
    },
    "testing_and_quality": {
      "score": $TESTING_SCORE,
      "max": 5
    },
    "cicd_and_automation": {
      "score": $CICD_SCORE,
      "max": 5
    },
    "documentation": {
      "score": $DOCS_SCORE,
      "max": 5
    },
    "governance": {
      "score": $GOVERNANCE_SCORE,
      "max": 3
    },
    "security": {
      "score": $SECURITY_SCORE,
      "max": 4
    },
    "operability": {
      "score": $OPERABILITY_SCORE,
      "max": 4
    },
    "performance_and_efficiency": {
      "score": $PERFORMANCE_SCORE,
      "max": 4
    },
    "maintenance_and_sustainability": {
      "score": $MAINTENANCE_SCORE,
      "max": 3
    }
  }
}
EOF

# Output to stdout as well
cat "$OUTPUT_FILE"
