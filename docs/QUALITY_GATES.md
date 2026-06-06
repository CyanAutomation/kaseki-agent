# Kaseki Quality Gates: Allowlist Configuration Guide

This document explains kaseki's **allowlist** quality gate, how to configure it, and best practices for managing file changes during agent runs.

## What is the Allowlist?

The allowlist is a **quality gate** that controls which files the kaseki agent is permitted to modify. When the agent completes, kaseki compares the modified files against the allowlist patterns:

- **Files matching the allowlist** → kept (validated and tested)
- **Files outside the allowlist** → automatically restored (reverted) before validation

This prevents **scope creep** — where an agent makes unintended changes to files outside the task scope.

## Why Use an Allowlist?

### Problem It Solves

When you ask an agent to "fix a parser bug in `src/lib/parser.ts`", it might:

1. ✅ Fix the bug correctly
2. ❌ Also modify `tests/other-module.ts` (test interference)
3. ❌ Update `package.json` (version bump)
4. ❌ Reformat `docs/DESIGN.md` (style changes)

Without an allowlist, these unintended changes would fail validation or create noise in the diff.

### With Allowlist

```
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts"
```

Only files matching this pattern are validated. Everything else is automatically reverted.

## Configuration

### Environment Variable

Set `KASEKI_CHANGED_FILES_ALLOWLIST` before running kaseki:

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts"
./run-kaseki.sh
```

### Pattern Syntax

The allowlist supports **glob-style patterns**:

| Pattern | Matches | Example |
|---------|---------|---------|
| `path/file.ts` | Exact file | `src/lib/parser.ts` |
| `path/**` | All files in directory (recursive) | `src/lib/**` matches `src/lib/parser.ts`, `src/lib/utils/helper.ts` |
| `**/name.ts` | File in any directory | `**/test.ts` matches `src/test.ts`, `tests/test.ts` |
| `path/*` | Files in direct children (one level) | `src/*` matches `src/file.ts` but NOT `src/lib/file.ts` |

### Examples

#### Single File

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts"
```

#### Multiple Files

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.test.ts tests/parser.validation.ts"
```

#### Directory Pattern

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/**"  # All files under src/lib/
```

#### Multiple Patterns

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/components/** tests/components/** src/hooks/**"
```

#### Combination

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/** src/types/parser.ts"
```

## Using Templates

We provide pre-built allowlist templates for common task types:

### Template: Parser Fix

For fixing parsing logic in a specific module.

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-parser-fix.txt | tr '\n' ' ')"
./run-kaseki.sh
```

**Includes:** `src/lib/parser.ts tests/parser.validation.ts`

### Template: UI Component

For modifying or creating React/Vue components.

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-ui-component.txt | tr '\n' ' ')"
./run-kaseki.sh
```

**Includes:** `src/components/** src/lib/ui/** src/hooks/** tests/components/**`

### Template: API Route

For implementing or fixing API endpoints.

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-api-route.txt | tr '\n' ' ')"
./run-kaseki.sh
```

**Includes:** `src/app/api/** tests/api/**`

### Template: Utility

For fixing utility functions and helper libraries.

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-utility.txt | tr '\n' ' ')"
./run-kaseki.sh
```

**Includes:** `src/lib/** src/utils/** tests/** src/types/**`

### Template: Comprehensive

For larger tasks that legitimately require changes across multiple areas.

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-comprehensive.txt | tr '\n' ' ')"
./run-kaseki.sh
```

**Includes:** `src/** tests/**`

## Finding the Right Allowlist

### Decision Tree

```
Start: What are you asking the agent to do?

├─ Fix a bug in [specific file]?
│  └─ Use: src/path/to/file.ts tests/path/to/file.test.ts
│
├─ Implement/modify a React component?
│  └─ Use: allowlist-ui-component template
│
├─ Implement/fix an API endpoint?
│  └─ Use: allowlist-api-route template
│
├─ Fix a utility function or helper?
│  └─ Use: allowlist-utility template
│
└─ Large refactor affecting multiple areas?
   └─ Use: allowlist-comprehensive template
```

### If You're Unsure

1. **Do a test run** with a broad allowlist:

   ```bash
   KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**" ./run-kaseki.sh
   ```

2. **Check the results:**
   - Look at `/results/restoration-report.md`
   - See which files were kept vs. restored
   - Copy the "kept files" into a more specific allowlist

3. **Or use the suggestion helper:**

   ```bash
   ./scripts/suggest-allowlist.sh /results/kaseki-N
   ```

   This generates `allowlist-suggestions.md` with patterns based on actual files changed.

## What Happens During Restoration

When kaseki detects files outside the allowlist:

### Restoration Phase (after agent completes, before validation)

| Action | Description |
|--------|-------------|
| Files matching allowlist | Logged as "kept" |
| Files outside allowlist | Automatically reverted using `git restore` |
 | Summary | Written to `quality.log`: "Restored: X files; Kept: Y files" |
| Detailed events | Written to `restoration.jsonl` (JSONL format for parsing) |

### Report Generation (at end of run)

| Report | Description |
|--------|-------------|
| `restoration-report.md` | Human-readable summary with recommendations |
| Coverage percentage | Allowlist coverage percentage |
| Next steps | Suggestions if coverage is low |

### Metrics in Summary

- `kaseki-report` shows: "Allowlist coverage: X/Y files (Z%)"
- Visual indicator of how restrictive the allowlist was

### When Coverage is Low (0-50%)

> ⚠️ **If your allowlist coverage is below 50%**, many files are being restored. This is **expected behavior** but suggests your allowlist may need adjustment.
>
> **Quick fixes:**
>
> 1. **Widen the allowlist** — Add related file patterns (e.g., tests, types, related utilities)
> 2. **Run the suggestion helper** — `./scripts/suggest-allowlist.sh /results/kaseki-N` generates improved patterns
> 3. **Review the task prompt** — Is it clear enough? Consider adding "Do not modify X" constraints
>
> **See also:** [Troubleshooting section](#problem-too-many-files-restored) below

## Troubleshooting

### Problem: Too Many Files Restored

**Symptom:** Run completes but `restoration-report.md` shows many files were restored.

**Cause:** Allowlist is too narrow for the task.

**Solutions:**

1. Widen the allowlist to include related files
2. Use a broader template (e.g., `allowlist-utility` instead of single file)
3. Run `./scripts/suggest-allowlist.sh` to auto-generate better patterns from the results:

   ```bash
   ./scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-N
   ```

   This analyzes what files were actually changed and suggests improved glob patterns.

4. Review the TASK_PROMPT — is the agent task clear enough? Consider adding constraints like:

   ```
   Do not modify config files, documentation, or unrelated test files.
   Focus only on src/lib/parser.ts and its direct test files.
   ```

**Example workflow:**

```bash
# Run 1: Test with a broad allowlist to see what changes
KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**" ./run-kaseki.sh

# Run 2: Analyze what was kept vs. restored
./scripts/suggest-allowlist.sh /agents/kaseki-results/kaseki-1

# Run 3: Use the suggested allowlist for precision
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts" ./run-kaseki.sh
```

**More help:**

- [Using Templates](#using-templates) — Pre-built patterns for common task types
- [scripts/suggest-allowlist.sh](../scripts/suggest-allowlist.sh) — Auto-generate patterns from completed runs
- [docs/TASK_PROMPT_TEMPLATES.md](./TASK_PROMPT_TEMPLATES.md) — Writing better prompts that minimize scope creep

### Problem: Allowlist Coverage is 0%

**Symptom:** All files were restored; nothing was kept.

**Cause:**

- Agent made no changes
- OR agent changed files in completely different areas than allowlist specifies

**Check:**

1. Look at `changed-files.txt` to see what actually changed
2. Look at `pi-stderr.log` to see if agent had errors
3. Verify `TASK_PROMPT` was clear and specific

### Problem: Specific File Not Matching Pattern

**Symptom:** Expected file `src/lib/utils/helper.ts` should match but was restored.

**Cause:** Pattern syntax issue.

**Common Mistakes:**

- ❌ `src/lib/*` — matches only direct children, not `src/lib/utils/helper.ts`
- ✅ `src/lib/**` — matches all files recursively

- ❌ `src/lib/*/helper.ts` — matches one level, not nested
- ✅ `src/lib/**/helper.ts` — matches any nesting level

- ❌ `/src/lib/**` — leading slash prevents matching
- ✅ `src/lib/**` — no leading slash

**Test your pattern:**

```bash
./scripts/allowlist-helper.sh  # (See implementation for pattern testing)
```

## Advanced: Disabling Auto-Restoration

By default, kaseki **automatically restores** files outside the allowlist before validation. To change this:

```bash
# Do not restore; just log violations (allows validation to run with all files)
KASEKI_RESTORE_DISALLOWED_CHANGES=0 ./run-kaseki.sh
```

**Warning:** This may cause validation to fail on unintended changes. Use only if you know what you're doing.

## Related

- [CLAUDE.md](../CLAUDE.md) — Overall kaseki-agent documentation
- [docs/TASK_PROMPT_TEMPLATES.md](./TASK_PROMPT_TEMPLATES.md) — How to write prompts that minimize scope creep
- [scripts/suggest-allowlist.sh](../scripts/suggest-allowlist.sh) — Auto-generate allowlist from completed run
- `templates/allowlist-*.txt` — Pre-built templates for common task types

## Examples

### Example 1: Simple Bug Fix

**Task:** Fix a parser bug in `src/lib/parser.ts`

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/**"
TASK_PROMPT="Fix the parsing bug in src/lib/parser.ts that fails on empty input" ./run-kaseki.sh
```

**Expected:** Only `src/lib/parser.ts` and test files change.

### Example 2: UI Component Implementation

**Task:** Create a new button component with tests

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="$(cat templates/allowlist-ui-component.txt | tr '\n' ' ')"
TASK_PROMPT="Implement a new Button component in src/components/button.tsx with storybook examples" ./run-kaseki.sh
```

**Expected:** Component, tests, and related files change; docs and config files restored.

### Example 3: API Endpoint

**Task:** Implement a new API endpoint

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/app/api/** tests/api/**"
TASK_PROMPT="Create a new POST /api/users endpoint that validates email and returns user details" ./run-kaseki.sh
```

**Expected:** API route, types, and tests change; everything else restored.

### Example 4: Large Refactor

**Task:** Refactor module structure

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/** src/types/**"
TASK_PROMPT="Refactor the auth module: extract utils to separate files and update imports" ./run-kaseki.sh
```

**Expected:** Multiple files across multiple directories change.

## Compilation Gate (Earlier Build Validation)

Kaseki's **compilation gate** validates that code compiles **before the main agent runs**, catching build errors early rather than waiting until validation phase.

### What is the Compilation Gate?

For **typed languages** (TypeScript, Go, Rust, Java, Python), kaseki:

1. **Scouting phase** → Detects build system (e.g., `npm run build`)
2. **Pre-main phase** → Runs build command; if it fails, exits with code 10 (quality gate)
3. **Main agent** → Runs aware that compilation is critical
4. **Validation phase** → Runs build again; reports improvement/regression

### Supported Languages

| Language | Config | Build Command | Exit Code 10 |
|----------|--------|---|---|
| TypeScript | `tsconfig.json` | `npm run build` | ✅ Pre-main build failure blocks agent |
| Go | `go.mod` | `go build ./...` | ✅ Pre-main build failure blocks agent |
| Rust | `Cargo.toml` | `cargo build` | ✅ Pre-main build failure blocks agent |
| Java | `pom.xml` / `build.gradle` | `mvn clean install` / `gradle build` | ✅ Pre-main build failure blocks agent |
| Python | `setup.py` / `pyproject.toml` | `python -m build` | ✅ Pre-main build failure blocks agent |

### Exit Code 10: Pre-Main Compilation Failure

| Condition | Exit Code | Meaning |
|-----------|-----------|---------|
| Pre-main compilation succeeds | — | Agent runs normally |
| Pre-main compilation fails | 10 | **QUALITY GATE** — Agent blocked; repo has build errors |
| Repo already broken, allow agent anyway | — | Set `KASEKI_ALLOW_BROKEN_BUILD=true` to skip pre-main check |

### Configuration

```bash
# Basic: Just run kaseki (detects build automatically)
export OPENROUTER_API_KEY="sk-or-..."
export TASK_PROMPT="Fix TypeScript compilation errors"
./run-kaseki.sh

# With timeouts
export KASEKI_COMPILATION_TIMEOUT_SECONDS=600  # 10 minutes for slow builds
./run-kaseki.sh

# Override build command
export KASEKI_BUILD_COMMAND="make build"
export KASEKI_BUILD_LANGUAGE="make"
./run-kaseki.sh

# Skip pre-main check (repo already broken)
export KASEKI_ALLOW_BROKEN_BUILD=true
./run-kaseki.sh
```

### Examples

#### TypeScript Project: Fix Compilation

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="src/** tests/**"
export TASK_PROMPT="Fix all TypeScript strict mode errors in the data layer"
./run-kaseki.sh
```

**Result:**

```
Pre-main build: ✅ PASSED (or ❌ FAILED → exit 10)
Agent runs if pre-main passed
Post-main build: ✅ PASSED (agent fixed errors) or ❌ FAILED (agent broke compilation)
```

#### Go Project: Ensure Compilation

```bash
export KASEKI_CHANGED_FILES_ALLOWLIST="cmd/** pkg/**"
export TASK_PROMPT="Refactor the HTTP server to use context.Context"
./run-kaseki.sh
```

**Result:**

- Pre-main: `go build ./...` checks current state
- If success: Agent runs with confidence build will be tested
- Post-main: Build again, report if compilation improved/regressed

### Result Artifacts

All compilation results in `/agents/kaseki-results/kaseki-N/`:

- `metadata.json` → `"pre-main-compilation"`: {success, exitCode, duration}
- `pre-main-build.log` → Output from initial compilation
- `result-summary.md` → "Compilation Status: ✅ PASSED" or "❌ FAILED"
- `validation.log` → Post-main build output (as part of validation commands)

### Troubleshooting

**Issue: Pre-main build fails immediately (exit code 10)**

```bash
# The repo already has build errors. Either:

# Option 1: Let the agent fix them
export KASEKI_ALLOW_BROKEN_BUILD=true
export TASK_PROMPT="Fix the compilation errors preventing build"
./run-kaseki.sh

# Option 2: Check build locally first
cd /repo/root
npm run build  # Debug locally

# Option 3: Set a longer timeout if build is slow
export KASEKI_COMPILATION_TIMEOUT_SECONDS=600
./run-kaseki.sh
```

**Issue: Agent breaks compilation (post-main fails)**

Check the `validation.log` for errors:

```bash
cat /agents/kaseki-results/kaseki-N/validation.log | grep -A 20 "npm run build"
```

See [COMPILATION_VALIDATION.md](COMPILATION_VALIDATION.md) for comprehensive compilation guide.

## Related

- [docs/COMPILATION_VALIDATION.md](./COMPILATION_VALIDATION.md) — Full compilation validation guide
- [docs/ASYNC_AWARENESS.md](./ASYNC_AWARENESS.md) — Async-aware code changes and mock file handling
- [CLAUDE.md](../CLAUDE.md) — Overall kaseki-agent documentation
- [docs/TASK_PROMPT_TEMPLATES.md](./TASK_PROMPT_TEMPLATES.md) — How to write prompts that minimize scope creep
- [scripts/suggest-allowlist.sh](../scripts/suggest-allowlist.sh) — Auto-generate allowlist from completed run
- `templates/allowlist-*.txt` — Pre-built templates for common task types
