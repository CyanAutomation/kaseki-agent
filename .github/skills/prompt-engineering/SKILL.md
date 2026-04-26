---
name: prompt-engineering
description: Composing, testing, and validating TASK_PROMPT for kaseki agent runs
tags: [kaseki, prompts, task-design, security]
relatedSkills: [quality-gate-config, workflow-diagnosis]
---

# Prompt Engineering for Kaseki Agent

This skill guides the design, testing, and security review of `TASK_PROMPT` — the instruction given to the Pi coding agent for isolated code changes.

## Overview

**When to Use**:
- Designing a new kaseki task (bug fix, refactor, feature)
- Testing prompt clarity or scope before a run
- Security-reviewing prompts to prevent information leakage
- Validating that agent output matches expectations

**Key Concepts**:
- Task prompts define what the agent should do and boundaries
- Prompts must be scoped (avoid over-ambition)
- Security is critical: never include env vars, secrets, or sensitive paths
- Validation happens post-run via pi-summary.json analysis

---

## Task Prompt Structure

A well-formed `TASK_PROMPT` has three parts:

### 1. **Problem Statement** (2–3 sentences)
Clearly describe *what* is broken or needs changing.

```
The normalizeRole function in src/lib/role.ts does not safely handle 
non-string Name inputs. When Name is a number or object, it causes 
a runtime error. Fix this to accept any input type and convert it safely.
```

**Best Practices**:
- ✓ Specific and actionable (e.g., "function X in file Y")
- ✓ Context about impact (why it matters)
- ✗ Vague or exploratory (e.g., "improve performance")
- ✗ Multiple unrelated problems (tackle one at a time)

### 2. **Scope Constraints** (2–4 bullet points)
Define *which files* the agent can and should change.

```
- Only modify src/lib/role.ts (implementation)
- Update tests/role.test.ts to cover new cases
- Do NOT modify other files or dependencies
- Do NOT refactor unrelated code
```

**Best Practices**:
- ✓ Explicit file allowlist (easier to validate)
- ✓ Clear "do not" constraints (prevents scope creep)
- ✗ Overly broad changes (e.g., "fix all type issues in src/")
- ✗ Ambiguous patterns (be specific: files or directories)

### 3. **Validation Criteria** (3–5 measurable checks)
Define what success looks like.

```
- Tests must pass: npm run test -- tests/role.test.ts
- Type checking must pass: npm run check
- No other tests should break
- Code style must match existing patterns (reviewed visually)
```

**Best Practices**:
- ✓ Measurable and automated where possible
- ✓ Specific test commands or files
- ✗ Subjective criteria alone (e.g., "code should be readable")
- ✗ Validation commands that hang or timeout

---

## Security Guardrails Checklist

**Before submitting a prompt, verify**:

- [ ] **No environment variables or secrets**
  - ✗ "Use OPENROUTER_API_KEY to…"
  - ✓ "The Pi CLI will be available"

- [ ] **No file paths to sensitive data**
  - ✗ "/home/user/.ssh/id_rsa"
  - ✗ "~/.config/credentials"
  - ✓ Paths within the cloned repo only

- [ ] **No credential patterns**
  - ✗ API key examples (sk-or-*, sk-ant-*, etc.)
  - ✗ Bearer tokens or JWT tokens
  - ✓ Mention "API key" without examples

- [ ] **No internal organizational details**
  - ✗ Internal service URLs, IP addresses
  - ✗ Org-specific naming conventions
  - ✓ Public repo references

- [ ] **No version-specific constraints** (unless critical)
  - ✗ "Must use Node 22.22.2" (this is already in the image)
  - ✓ "Must support Node 20+"

**Post-Run Secret Scan**:  
Kaseki automatically scans outputs for `sk-or-*` patterns. Review `secret-scan.log` in results.

---

## Common Prompt Pitfalls

### ❌ Over-Scoped Task
```
"Refactor the entire src/lib/ directory to improve type safety 
and performance. Update all 50+ test files."
```

**Problem**: Too large; agent may timeout or produce oversized diff.  
**Fix**: Target one module; save refactoring for follow-up.

### ❌ Vague Success Criteria
```
"Make the code better. Tests should pass and code should be readable."
```

**Problem**: "Better" and "readable" are subjective.  
**Fix**: "Fix bug X so tests pass; ensure no regressions in tests/other.test.ts."

### ❌ Implicit Dependencies
```
"The user.ts file should handle both user IDs and email addresses."
```

**Problem**: "User IDs and email addresses" undefined; type system unclear.  
**Fix**: "user.ts `getUserBy()` should accept `userId: string | number` and return User | null. Update types/user.ts and tests accordingly."

### ❌ Multi-Module Edits Without Allowlist
```
"Improve the authentication system."
```

**Problem**: Unbounded scope; agent could change auth-related code across src/.  
**Fix**: "Fix the bug in src/auth/login.ts where sessions expire immediately (line 45). Only modify src/auth/login.ts and tests/auth.test.ts. Do NOT change middleware or other modules."

### ❌ No Validation Commands
```
"Tests should pass."
```

**Problem**: Which tests? How do we verify?  
**Fix**: "Run: npm run test -- tests/auth.test.ts. All tests must pass with 0 failures."

---

## Example Prompts

### Example 1: Bug Fix (Small Scope)

```
PROBLEM:
The getUsername() function in src/utils/string.ts crashes when given 
null or undefined. It should return an empty string for null/undefined 
instead of throwing.

SCOPE:
- Modify src/utils/string.ts (fix getUsername function)
- Update tests/utils/string.test.ts (add null/undefined test cases)
- Do NOT change other utility functions or modules

VALIDATION:
- npm run test -- tests/utils/string.test.ts (all tests pass)
- npm run check (no type errors)
- Code must follow existing conventions (checked visually)
```

### Example 2: Feature Addition (Bounded Scope)

```
PROBLEM:
The Role class currently supports role names only (string). Add support 
for role IDs (numbers) so callers can use either identifier type.

SCOPE:
- Modify src/lib/role.ts (Role class and helper functions)
- Modify types/role.ts (TypeScript types)
- Update tests/role.test.ts (new test cases for ID support)
- Do NOT refactor unrelated code or modify other files

VALIDATION:
- npm run test -- tests/role.test.ts (all tests pass, no regressions)
- npm run check (no type errors)
- npm run build (build succeeds)
- Diff size must not exceed 500 lines (scope check)
```

### Example 3: Refactor (Constrained Change)

```
PROBLEM:
The parseConfig() function in src/config.ts uses nested if/else logic 
that's hard to follow. Simplify it using a switch statement while 
preserving exact behavior.

SCOPE:
- Modify src/config.ts (parseConfig function only)
- Modify tests/config.test.ts (ensure all test cases still pass)
- Do NOT add new features or change function signatures

VALIDATION:
- npm run test -- tests/config.test.ts (all tests pass)
- npm run check (no type errors)
- Behavior must be identical: compare inputs/outputs before/after
```

---

## Dry-Run Validation Workflow

Before running a real kaseki task on your target repo:

### Step 1: Prepare Locally
```bash
# Clone and inspect the target repo
git clone https://github.com/org/repo.git
cd repo
git checkout main  # or your target branch

# Install dependencies
npm ci

# Run validation commands that the agent will run
npm run check
npm run test
npm run build
```

### Step 2: Design the Prompt
Write your prompt following the 3-part structure above. Save it in a file:
```bash
cat > /tmp/task-prompt.txt << 'EOF'
PROBLEM: ...
SCOPE: ...
VALIDATION: ...
EOF
```

### Step 3: Sanity Check
Verify manually that the task is achievable:
```bash
# Can I make this change manually in 5 minutes?
# Do all validation commands work without the change?
# Is the scope clear and bounded?
```

### Step 4: Use --doctor to Check Setup
```bash
REPO_URL=https://github.com/org/repo \
  ./run-kaseki.sh --doctor
```

This verifies API key, Docker, and Pi CLI without running the agent.

### Step 5: Run a Test Kaseki Instance
```bash
OPENROUTER_API_KEY=sk-or-... \
  REPO_URL=https://github.com/org/repo \
  TASK_PROMPT="$(cat /tmp/task-prompt.txt)" \
  ./run-kaseki.sh kaseki-test-1
```

### Step 6: Analyze Results
Check `/agents/kaseki-results/kaseki-test-1/`:

```bash
# Quick summary
cat result-summary.md

# Event details
cat pi-summary.json | jq '.statistics'

# Did the agent understand the task?
cat pi-events.jsonl | jq '.type' | sort | uniq -c

# Check diff size
wc -c < git.diff
```

**Success Indicators**:
- ✓ `pi-summary.json` shows "status": "completed"
- ✓ Diff size is reasonable (not 0 bytes, not 10+ MB)
- ✓ Changed files match your expectations
- ✓ All validation commands passed
- ✓ No secret leaks in `secret-scan.log`

**If Something's Wrong**:
- See [Workflow Diagnosis](workflow-diagnosis.md) for root-cause analysis
- Refine prompt and retry with a new kaseki instance (e.g., kaseki-test-2)

---

## Security Review Checklist

Before sharing a prompt or running it against a sensitive repo:

**Content Review**:
- [ ] No API keys, passwords, or tokens in examples
- [ ] No internal URLs or IP addresses
- [ ] No org-specific names or secrets
- [ ] No file paths outside the target repo
- [ ] No version-pinning (Node, npm, Pi CLI)

**Scope Review**:
- [ ] Allowlist is explicit (files, not wildcards)
- [ ] Constraints prevent unintended changes
- [ ] Validation commands are safe to run
- [ ] No dangerous shell commands in validation

**Post-Run Review**:
- [ ] Secret scan passes (no sk-or-* patterns found)
- [ ] Changed files are within allowlist
- [ ] Diff size is within expected range
- [ ] No credentials in pi-events.jsonl or pi-summary.json

---

## Tips for Better Prompts

1. **Be Specific, Not Generic**
   - ✗ "Fix the bug in authentication"
   - ✓ "Fix the SessionTimeout bug in src/auth/session.ts (line 42)"

2. **Use Code References**
   - ✗ "Improve error handling"
   - ✓ "Wrap the try/catch in src/db.ts (lines 12–25) to handle connection timeouts"

3. **Show Examples When Helpful**
   - Include input/output examples for parsing or transformation logic
   - But avoid secrets or real user data

4. **Keep Validation Deterministic**
   - ✓ `npm run test -- tests/file.test.ts` (runs specific test file)
   - ✗ `npm test` (might run all tests, could be slow)

5. **Test Locally First**
   - Make the change yourself in 5 minutes
   - Verify all validation commands pass
   - Then give it to the agent

---

## Related Skills & Docs

- [Quality Gate Configuration](quality-gate-config.md) — Set allowlists and diff limits for your task
- [Workflow Diagnosis](workflow-diagnosis.md) — Analyze task results and troubleshoot failures
- [Test Automation](test-automation.md) — Ensure validation tests are robust
- [CLAUDE.md](../../CLAUDE.md) — Architecture and defaults (background reading)
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Contribution guidelines and validation rules
