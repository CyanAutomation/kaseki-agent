---
name: Quality Gate Configuration
description: Defining and validating quality gates for kaseki runs
tags: [kaseki, quality-gates, validation, constraints, security]
relatedSkills: [prompt-engineering, workflow-diagnosis]
---

# Quality Gate Configuration for Kaseki Agent

This skill guides designing and validating quality gates for kaseki runs, ensuring changes stay within acceptable bounds.

## Overview

**When to Use**:
- Designing quality gates for a new task
- Troubleshooting allowlist violations or diff size limits
- Tuning validation command timeouts
- Reviewing security constraints
- Defining gates for a target repository

**Key Concepts**:
- Quality gates enforce boundaries (file scope, diff size, security rules)
- Gates run after the agent completes, before reporting success
- Violations can trigger exit codes and halt the pipeline
- Gates provide both safety (prevent unintended changes) and insight (validate scope)

---

## Core Quality Gates

### 1. **File Allowlist** (KASEKI_CHANGED_FILES_ALLOWLIST)

**Purpose**: Restrict changes to specific files or directories

**Environment Variable**:
```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts src/lib/validator.ts"
```

**Syntax**: Space-separated file paths or glob patterns

#### Syntax Examples

| Pattern | Matches | Example |
|---|---|---|
| `src/file.ts` | Exact file | `src/lib/parser.ts` |
| `src/**/*.ts` | Recursive glob | `src/lib/parser.ts`, `src/util/index.ts` |
| `tests/*.test.ts` | Directory glob | `tests/parser.test.ts`, `tests/utils.test.ts` |
| `*.md` | Root-level glob | `README.md`, `CHANGELOG.md` |

**❌ Invalid Patterns**:
- Wildcards alone: `*` (too broad; be explicit)
- Relative paths: `../src/file.ts` (stay in repo)
- Regex: `src/(parser\|validator)\.ts` (use glob syntax)

#### Design Allowlist for a Task

**Example 1: Bug Fix**

```bash
# Task: Fix normalizeRole to handle non-string inputs
TASK_PROMPT="Fix normalizeRole function in src/lib/role.ts..."

# Allowlist: Only the bug fix file + tests
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role.ts tests/role.test.ts"
```

**Example 2: Multi-File Refactor**

```bash
# Task: Add TypeScript support to config module
TASK_PROMPT="Add type annotations to src/config/..."

# Allowlist: Config directory + related tests
KASEKI_CHANGED_FILES_ALLOWLIST="src/config/** tests/config/**"
```

**Example 3: Documentation**

```bash
# Task: Update docs for new API
TASK_PROMPT="Update docs/api.md with new endpoint..."

# Allowlist: Documentation + changelog
KASEKI_CHANGED_FILES_ALLOWLIST="docs/api.md CHANGELOG.md"
```

#### Validating Allowlist

```bash
# Before running kaseki, check what you expect to change
git diff --name-only main -- $(your task scope)

# Example output:
# src/lib/role.ts
# tests/role.test.ts

# Set allowlist to match
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role.ts tests/role.test.ts"

# Run kaseki
./run-kaseki.sh
```

#### Allowlist Violations

If agent changes files outside the allowlist:

```bash
# Check what changed
cat /agents/kaseki-results/kaseki-N/changed-files.txt
# Output:
# src/lib/role.ts
# tests/role.test.ts
# src/other/config.ts  ← NOT in allowlist!

# Check quality gate failure
cat /agents/kaseki-results/kaseki-N/quality.log
# Output: File 'src/other/config.ts' not in allowlist
```

**Fix**:
1. **Refine the prompt** — be more explicit about constraints
2. **Expand the allowlist** — if the change was legitimate
3. **Retry** — with updated config

---

### 2. **Maximum Diff Size** (KASEKI_MAX_DIFF_BYTES)

**Purpose**: Prevent unexpectedly large changes

**Environment Variable**:
```bash
KASEKI_MAX_DIFF_BYTES=200000  # 200 KB default
```

**Format**: Bytes (integer)

#### Choosing an Appropriate Limit

| Task Type | Typical Range | Example Limit |
|---|---|---|
| Small bug fix | 1–10 KB | 50000 (50 KB) |
| Single feature | 5–50 KB | 100000 (100 KB) |
| Module refactor | 20–200 KB | 300000 (300 KB) |
| Large refactor | 50–500 KB | 500000 (500 KB) |

**Heuristic**:
- Start with 200 KB (default) for typical tasks
- Increase if legitimate changes exceed limit
- Decrease if you want strict scope enforcement

#### Estimating Diff Size

```bash
# For a task you've done manually, check the diff size
git diff HEAD -- <files> | wc -c
# Output: 12345 bytes

# Round up 50% for safety
# 12345 * 1.5 = 18517 → set limit to 25000 (25 KB)
```

#### Diff Size Violations

```bash
# Check the actual diff size
wc -c < /agents/kaseki-results/kaseki-N/git.diff
# Output: 250000 bytes

# Check the limit that was set
cat /agents/kaseki-results/kaseki-N/quality.log
# Output: Diff size 250000 exceeds KASEKI_MAX_DIFF_BYTES (200000)

# See what changed
head -100 /agents/kaseki-results/kaseki-N/git.diff
```

**Fix**:
1. **Simplify the task** — scope it down further
2. **Increase the limit** — if the change is legitimate
3. **Check for unintended changes** — agent may have refactored more than intended

---

### 3. **Validation Commands** (KASEKI_VALIDATION_COMMANDS)

**Purpose**: Run tests, type checks, builds to validate changes

**Environment Variable**:
```bash
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
```

**Format**: Semicolon-separated commands

#### Command Chaining

Commands run in sequence. If one fails, the pipeline stops.

```bash
# Runs in order:
1. npm run check    # Type checking
2. npm run test     # Unit tests
3. npm run build    # Build verification
```

**With Early Exit**:
```bash
# Stop on first failure (default)
npm run check && npm run test && npm run build
```

#### Choosing Validation Commands

| Repo Type | Recommended Commands |
|---|---|
| **TypeScript** | `npm run check;npm run test;npm run build` |
| **JavaScript (ESM)** | `npm run lint;npm run test` |
| **Python** | `python -m pytest;mypy src/` |
| **Rust** | `cargo check;cargo test;cargo build` |
| **Minimal** | `npm test` (single comprehensive test) |

#### Examples

**Example 1: Minimal (just tests)**
```bash
KASEKI_VALIDATION_COMMANDS="npm run test"
```

**Example 2: Comprehensive (types + tests + build)**
```bash
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
```

**Example 3: Targeted (specific test file)**
```bash
# If you only care about changes to one module
KASEKI_VALIDATION_COMMANDS="npm run test -- tests/role.test.ts"
```

#### Timeout Tuning

Commands run with the `KASEKI_AGENT_TIMEOUT_SECONDS` (default 1200s = 20 min).

If validation is slow:

```bash
# Check which command is slow
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv
# Output:
# command            duration_seconds
# npm ci             120 ← long (see Dependency Cache Optimization)
# npm run check      45
# npm run test       150 ← very long
# npm run build      60
```

**Optimize**:
1. **Reduce test scope** — run only relevant tests
2. **Increase timeout** — if all commands are slow due to slow repo
3. **Improve caching** — see [Dependency Cache Optimization](dependency-cache-optimization.md)

```bash
# Run only tests for changed files
KASEKI_VALIDATION_COMMANDS="npm run test -- --changed"

# Or increase timeout
KASEKI_AGENT_TIMEOUT_SECONDS=1800  # 30 minutes
```

---

### 4. **Security Gates**

**Purpose**: Prevent credential leaks and other security issues

**Gates** (built-in, not configurable):
- Secret scanning (detects `sk-or-*` patterns)
- No credentials in diffs or logs
- No `.env` files committed

#### Secret Scanning

Kaseki automatically scans outputs for credential patterns:

```bash
# Check if secrets were found
cat /agents/kaseki-results/kaseki-N/secret-scan.log
# Output: Found secret pattern sk-or-abc123 in pi-events.jsonl:42
```

**Patterns Detected**:
- `sk-or-*` — OpenRouter API keys
- `sk-ant-*` — Anthropic API keys (if used)
- `.env` file commits
- Environment variable dumps

**Prevention**:
- ✓ Never include API keys in examples
- ✓ Describe credentials without showing them ("API key" not "sk-or-123")
- ✓ Ensure task prompts don't leak env vars
- See [Prompt Engineering](prompt-engineering.md) for security checklist

---

## Designing Quality Gates for a New Task

### Step-by-Step Workflow

**Step 1: Understand the Task**
```bash
# What files will change?
# What validation is appropriate?
# What's the realistic diff size?
```

**Step 2: Design Allowlist**
```bash
# Manually make the change locally
git checkout -b feature/task

# Manually fix the issue
# (Make the minimal change the agent should make)

# See what changed
git diff --name-only
# Output:
# src/lib/role.ts
# tests/role.test.ts

# Set allowlist
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role.ts tests/role.test.ts"
```

**Step 3: Estimate Diff Size**
```bash
# Check the diff size of your manual change
git diff | wc -c
# Output: 8234 bytes

# Round up to account for agent variations (1.5x safety factor)
# 8234 * 1.5 = 12351 → set limit to 20000 (20 KB)

export KASEKI_MAX_DIFF_BYTES=20000
```

**Step 4: Verify Validation Commands**
```bash
# Run validation commands locally (without your changes!)
git checkout main

# Install deps
npm ci

# Test validation commands work
npm run check  # No errors?
npm run test   # All pass?
npm run build  # Success?

# Now apply your changes and verify again
git checkout feature/task
npm run check && npm run test && npm run build
```

**Step 5: Set Validation Commands**
```bash
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build"
```

**Step 6: Run a Test Kaseki Instance**
```bash
OPENROUTER_API_KEY=sk-or-... \
  REPO_URL=https://github.com/org/repo \
  TASK_PROMPT="$(cat task.txt)" \
  KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role.ts tests/role.test.ts" \
  KASEKI_MAX_DIFF_BYTES=20000 \
  KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run build" \
  ./run-kaseki.sh kaseki-test-1
```

**Step 7: Review Results**
```bash
# Check if gates passed
cat /agents/kaseki-results/kaseki-test-1/quality.log

# If all gates passed, you're ready!
```

---

## Common Configuration Examples

### Example 1: Small Bug Fix

```bash
#!/bin/bash
# fix-small-bug.sh

export TASK_PROMPT="Fix the NullPointerException in User.getUsername() 
when input is null. Should return empty string instead of throwing."

export KASEKI_CHANGED_FILES_ALLOWLIST="src/User.java tests/UserTest.java"
export KASEKI_MAX_DIFF_BYTES=15000  # 15 KB
export KASEKI_VALIDATION_COMMANDS="mvn test"

./run-kaseki.sh kaseki-bugfix-1
```

### Example 2: Feature Addition (Multi-File)

```bash
#!/bin/bash
# add-feature.sh

export TASK_PROMPT="Add support for JWT authentication tokens.
Modify src/auth/jwt.ts and update types/auth.ts.
Update tests/auth.test.ts with JWT test cases.
Do NOT change other authentication mechanisms."

export KASEKI_CHANGED_FILES_ALLOWLIST="src/auth/jwt.ts types/auth.ts tests/auth.test.ts"
export KASEKI_MAX_DIFF_BYTES=50000  # 50 KB
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test -- tests/auth.test.ts"

./run-kaseki.sh kaseki-feature-1
```

### Example 3: Documentation Update

```bash
#!/bin/bash
# update-docs.sh

export TASK_PROMPT="Update docs/API.md to document the new getUserBy endpoint.
Include request/response examples."

export KASEKI_CHANGED_FILES_ALLOWLIST="docs/API.md"
export KASEKI_MAX_DIFF_BYTES=10000  # 10 KB
export KASEKI_VALIDATION_COMMANDS="npm run test"  # No special validation

./run-kaseki.sh kaseki-docs-1
```

### Example 4: Refactor with Safety

```bash
#!/bin/bash
# refactor-safely.sh

export TASK_PROMPT="Refactor Parser.parseConfig() to use switch statement 
instead of if/else chain. Preserve exact behavior."

export KASEKI_CHANGED_FILES_ALLOWLIST="src/Parser.ts tests/ParserTest.ts"
export KASEKI_MAX_DIFF_BYTES=30000  # 30 KB (refactors are often larger)
export KASEKI_VALIDATION_COMMANDS="npm run check;npm run test"

./run-kaseki.sh kaseki-refactor-1
```

---

## Troubleshooting Quality Gate Violations

### Allowlist Violation

**Symptom**: Agent changed files outside the allowlist

```bash
# Check what the allowlist was
echo $KASEKI_CHANGED_FILES_ALLOWLIST

# Check what actually changed
cat /agents/kaseki-results/kaseki-N/changed-files.txt
```

**Solution**:
1. **Expand allowlist** if change was legitimate:
   ```bash
   export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role.ts tests/role.test.ts src/other/file.ts"
   ./run-kaseki.sh kaseki-retry-1
   ```

2. **Refine prompt** if change was unintended:
   ```bash
   # Be more explicit: "ONLY modify src/lib/role.ts and tests/role.test.ts"
   export TASK_PROMPT="..."
   ./run-kaseki.sh kaseki-retry-2
   ```

### Diff Size Exceeded

**Symptom**: Changes are too large

```bash
# Check actual size
wc -c < /agents/kaseki-results/kaseki-N/git.diff

# Check what changed
cat /agents/kaseki-results/kaseki-N/changed-files.txt
```

**Solution**:
1. **Increase limit** if legitimate:
   ```bash
   export KASEKI_MAX_DIFF_BYTES=300000  # 300 KB
   ./run-kaseki.sh kaseki-retry-1
   ```

2. **Narrow task scope** if changes are too broad:
   ```bash
   # Focus on just one module, not multiple
   export TASK_PROMPT="Fix parser.ts only, not validator.ts"
   ./run-kaseki.sh kaseki-retry-2
   ```

### Validation Command Failed

**Symptom**: Tests or checks failed

```bash
# Check which command failed
cat /agents/kaseki-results/kaseki-N/result-summary.md | grep -A 3 "Validation"

# See full output
cat /agents/kaseki-results/kaseki-N/validation.log | tail -50
```

**Solution**:
1. **Check local validation** (reproduce locally):
   ```bash
   git clone <repo>
   cd repo
   npm ci
   npm run check && npm run test
   # Did they pass without any changes?
   ```

2. **Review what agent changed**:
   ```bash
   head -100 /agents/kaseki-results/kaseki-N/git.diff
   # Is the change correct? Did it introduce type errors?
   ```

3. **Adjust commands or prompts** based on what failed

---

## Best Practices

1. **Start Conservative, Expand as Needed**
   - Begin with tight allowlists and small diff limits
   - Only loosen if agent fails legitimately
   - Prevents unexpected changes

2. **Test Locally First**
   - Make the change manually
   - Verify all validation commands pass
   - Use those results to set gates

3. **Document Your Reasoning**
   - Comment why you chose specific limits
   - Link to the original issue/task
   - Makes maintenance easier

4. **Review Gate Violations**
   - Don't automatically increase limits
   - Understand why the violation occurred
   - Update prompt if needed

5. **Keep Gates Reasonable**
   - Gates should be meaningful, not arbitrary
   - Overly strict gates defeat the purpose
   - Overly loose gates provide no protection

---

## Related Skills & Docs

- [Prompt Engineering](prompt-engineering.md) — Design prompts to work with quality gates
- [Workflow Diagnosis](workflow-diagnosis.md) — Troubleshoot gate violations
- [CLAUDE.md](../../CLAUDE.md) — Architecture and environment variables reference
