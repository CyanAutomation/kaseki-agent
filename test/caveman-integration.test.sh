#!/bin/bash
# Integration test for Caveman mode injection into kaseki-agent

set -u

# Source necessary test helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# Test that KASEKI_CAVEMAN default is 1 (enabled)
echo "✓ Testing KASEKI_CAVEMAN default value..."
# We'll verify this by checking the kaseki-agent.sh source
if grep -q 'KASEKI_CAVEMAN="\${KASEKI_CAVEMAN:-1}"' "$PARENT_DIR/kaseki-agent.sh"; then
  echo "  KASEKI_CAVEMAN default is set to 1 (enabled by default)"
else
  echo "  ERROR: KASEKI_CAVEMAN default not found or not set to 1"
  exit 1
fi

# Test that get_caveman_instruction function exists
echo "✓ Testing get_caveman_instruction function..."
if grep -q 'get_caveman_instruction()' "$PARENT_DIR/kaseki-agent.sh"; then
  echo "  get_caveman_instruction function found in kaseki-agent.sh"
else
  echo "  ERROR: get_caveman_instruction function not found"
  exit 1
fi

# Test that caveman instruction is injected into goal-setting prompt
echo "✓ Testing caveman injection in build_goal_setting_prompt..."
if grep -A 5 'build_goal_setting_prompt()' "$PARENT_DIR/kaseki-agent.sh" | grep -q 'caveman_instruction'; then
  echo "  Caveman instruction injection found in build_goal_setting_prompt"
else
  echo "  ERROR: Caveman instruction not injected in build_goal_setting_prompt"
  exit 1
fi

# Test that caveman instruction is injected into scouting prompt
echo "✓ Testing caveman injection in build_scouting_prompt..."
if grep -A 10 'build_scouting_prompt()' "$PARENT_DIR/kaseki-agent.sh" | grep -q 'caveman_instruction'; then
  echo "  Caveman instruction injection found in build_scouting_prompt"
else
  echo "  ERROR: Caveman instruction not injected in build_scouting_prompt"
  exit 1
fi

# Test that caveman instruction is injected into goal-check prompt
echo "✓ Testing caveman injection in build_goal_check_prompt..."
if grep -A 5 'build_goal_check_prompt()' "$PARENT_DIR/kaseki-agent.sh" | grep -q 'caveman_instruction'; then
  echo "  Caveman instruction injection found in build_goal_check_prompt"
else
  echo "  ERROR: Caveman instruction not injected in build_goal_check_prompt"
  exit 1
fi

# Test that caveman instruction is injected into evaluation prompt
echo "✓ Testing caveman injection in build_run_evaluation_prompt..."
if grep -A 5 'build_run_evaluation_prompt()' "$PARENT_DIR/kaseki-agent.sh" | grep -q 'caveman_instruction'; then
  echo "  Caveman instruction injection found in build_run_evaluation_prompt"
else
  echo "  ERROR: Caveman instruction not injected in build_run_evaluation_prompt"
  exit 1
fi

# Test that caveman instruction is injected into agent-prompt.sh
echo "✓ Testing caveman injection in build_agent_prompt..."
if grep -A 10 'build_agent_prompt()' "$PARENT_DIR/scripts/agent-prompt.sh" | grep -q 'caveman_instruction'; then
  echo "  Caveman instruction injection found in build_agent_prompt"
else
  echo "  ERROR: Caveman instruction not injected in build_agent_prompt"
  exit 1
fi

# Test that environment variable is documented
echo "✓ Testing KASEKI_CAVEMAN documentation..."
if grep -q 'KASEKI_CAVEMAN' "$PARENT_DIR/.agents/skills/environment-configuration/SKILL.md"; then
  echo "  KASEKI_CAVEMAN documented in environment-configuration SKILL.md"
else
  echo "  ERROR: KASEKI_CAVEMAN not documented"
  exit 1
fi

# Test that caveman-instructions.ts library exists
echo "✓ Testing caveman-instructions.ts library..."
if [ -f "$PARENT_DIR/src/caveman/caveman-instructions.ts" ]; then
  echo "  caveman-instructions.ts library found"
else
  echo "  ERROR: caveman-instructions.ts library not found"
  exit 1
fi

# Verify getCavemanInstruction function is exported
echo "✓ Testing getCavemanInstruction export..."
if grep -q 'export function getCavemanInstruction' "$PARENT_DIR/src/caveman/caveman-instructions.ts"; then
  echo "  getCavemanInstruction function exported"
else
  echo "  ERROR: getCavemanInstruction function not exported"
  exit 1
fi

# Verify instruction includes key Caveman skill rules
echo "✓ Testing Caveman instruction content..."
if grep -q 'Terse.*professional\|professional.*Terse' "$PARENT_DIR/src/caveman/caveman-instructions.ts"; then
  echo "  Caveman instruction includes 'terse' and 'professional'"
else
  echo "  ERROR: Caveman instruction missing key phrases"
  exit 1
fi

echo ""
echo "✅ All integration tests passed!"
exit 0
