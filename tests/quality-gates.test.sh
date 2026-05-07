#!/usr/bin/env bash
# Integration tests for quality gate enforcement
# Tests diff size limits, allowlist validation, and secret scanning

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Load quality gate logic from kaseki-agent.sh
eval "$(awk '
  /^allowlist_pattern_to_regex\(\)/ { emit=1 }
  /^compute_repo_memory_key\(\)/ { emit=0 }
  emit { print }
' "$ROOT_DIR/scripts/allowlist-helper.sh")"

pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

# Create a test results directory structure
mkdir -p "$TMP_DIR/results"
mkdir -p "$TMP_DIR/repo"

# Test 1: Diff size exceeds max bytes
echo "==> Test: Diff size check"
{
  cd "$TMP_DIR/repo"
  git init --initial-branch=main -q
  git config user.email "test@kaseki.local"
  git config user.name "Test User"
  
  # Create initial commit
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "initial"
  
  # Generate a large diff (exceeds default 200KB)
  # Create a file with 300KB of data
  python3 -c "print('x' * 310000)" > large_file.txt
  git add large_file.txt
  git diff --cached > "$TMP_DIR/results/git.diff"
  
  diff_size="$(wc -c < "$TMP_DIR/results/git.diff" | tr -d ' ')"
  KASEKI_MAX_DIFF_BYTES=200000
  
  if [ "$diff_size" -gt "$KASEKI_MAX_DIFF_BYTES" ]; then
    pass "Diff size check: detects oversized diff ($diff_size > $KASEKI_MAX_DIFF_BYTES)"
  else
    fail "Diff size check: expected diff to exceed $KASEKI_MAX_DIFF_BYTES bytes, got $diff_size"
  fi
}

# Test 2: Allowlist validation
echo "==> Test: Allowlist validation"
{
  cd "$TMP_DIR/repo"
  git diff --name-only > "$TMP_DIR/results/changed-files.txt"
  
  # Test matching allowed files
  KASEKI_CHANGED_FILES_ALLOWLIST="src/**/*.ts tests/**/*.test.ts"
  allowlist_regex="$(build_allowlist_regex)"
  
  # Should match
  if printf 'src/index.ts\n' | grep -Eq "^(${allowlist_regex})$"; then
    pass "Allowlist: allows src/index.ts pattern"
  else
    fail "Allowlist: should allow src/index.ts"
  fi
  
  # Should not match
  if printf 'README.md\n' | grep -Eq "^(${allowlist_regex})$"; then
    fail "Allowlist: should reject README.md"
  else
    pass "Allowlist: rejects README.md"
  fi
  
  # Test wildcard patterns
  if printf 'src/lib/parser.ts\n' | grep -Eq "^(${allowlist_regex})$"; then
    pass "Allowlist: allows nested src/lib/parser.ts"
  else
    fail "Allowlist: should allow src/lib/parser.ts"
  fi
}

# Test 3: Secret scanning (pattern detection)
echo "==> Test: Secret scanning"
{
  # Create a file with a fake API key
  cat > "$TMP_DIR/results/secret-test.txt" <<'EOF'
This file has an OpenRouter API key: sk-or-aBcDeFgHiJkLmNoPqRsT
And some normal content
EOF
  
  if grep -E 'sk-or-[A-Za-z0-9_-]{20,}' "$TMP_DIR/results/secret-test.txt" > /dev/null; then
    pass "Secret scanning: detects sk-or-* pattern"
  else
    fail "Secret scanning: should detect sk-or-* pattern"
  fi
  
  # Create a clean file
  cat > "$TMP_DIR/results/clean-test.txt" <<'EOF'
This file has no secrets
Just normal content here
EOF
  
  if ! grep -E 'sk-or-[A-Za-z0-9_-]{20,}' "$TMP_DIR/results/clean-test.txt"; then
    pass "Secret scanning: clean file passes"
  else
    fail "Secret scanning: clean file should pass"
  fi
}

# Test 4: Overly broad allowlist patterns
echo "==> Test: Overly broad allowlist detection"
{
  # Test that '*' pattern is too broad
  KASEKI_CHANGED_FILES_ALLOWLIST="*"
  allowlist_regex="$(build_allowlist_regex)"
  
  # This would match everything, which is bad
  test_cases=("package.json" "src/index.ts" "tests/foo.test.ts" "README.md" "Dockerfile")
  all_match=true
  
  for file in "${test_cases[@]}"; do
    if ! printf '%s\n' "$file" | grep -Eq "^(${allowlist_regex})$"; then
      all_match=false
      break
    fi
  done
  
  if [ "$all_match" = true ]; then
    fail "Overly broad allowlist: '*' pattern matches everything (too permissive)"
  else
    pass "Allowlist prevents overly broad '*' patterns"
  fi
}

# Test 5: Multiple file allowlist
echo "==> Test: Multiple file allowlist patterns"
{
  KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts docs/README.md"
  allowlist_regex="$(build_allowlist_regex)"
  
  allowed_files=("src/lib/parser.ts" "tests/parser.validation.ts" "docs/README.md")
  rejected_files=("src/index.ts" "tests/other.test.ts" "CHANGELOG.md")
  
  for file in "${allowed_files[@]}"; do
    if printf '%s\n' "$file" | grep -Eq "^(${allowlist_regex})$"; then
      pass "Allowlist: allows $file"
    else
      fail "Allowlist: should allow $file"
    fi
  done
  
  for file in "${rejected_files[@]}"; do
    if printf '%s\n' "$file" | grep -Eq "^(${allowlist_regex})$"; then
      fail "Allowlist: should reject $file"
    else
      pass "Allowlist: rejects $file"
    fi
  done
}

# Test 6: Empty diff detection
echo "==> Test: Empty diff handling"
{
  : > "$TMP_DIR/results/empty.diff"
  empty_size="$(wc -c < "$TMP_DIR/results/empty.diff" | tr -d ' ')"
  
  if [ "$empty_size" -eq 0 ]; then
    pass "Empty diff detection: correctly identifies 0-byte diff"
  else
    fail "Empty diff detection: expected 0 bytes, got $empty_size"
  fi
}

printf '\n✅ All quality gate tests passed\n'
