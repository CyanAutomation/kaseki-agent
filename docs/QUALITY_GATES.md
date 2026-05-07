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

1. **Restoration Phase** (after agent completes, before validation)
   - Files matching allowlist → logged as "kept"
   - Files outside allowlist → automatically reverted using `git restore`
   - Summary written to `quality.log`: "Restored: X files; Kept: Y files"
   - Detailed events written to `restoration.jsonl` (JSONL format for parsing)

2. **Report Generation** (at end of run)
   - `restoration-report.md` — human-readable summary with recommendations
   - Includes allowlist coverage percentage
   - Suggests next steps if coverage is low

3. **Metrics in Summary**
   - `kaseki-report` shows: "Allowlist coverage: X/Y files (Z%)"
   - Visual indicator of how restrictive the allowlist was

## Troubleshooting

### Problem: Too Many Files Restored

**Symptom:** Run completes but `restoration-report.md` shows many files were restored.

**Cause:** Allowlist is too narrow for the task.

**Solutions:**
1. Widen the allowlist to include related files
2. Use a broader template (e.g., `allowlist-utility` instead of single file)
3. Run `./scripts/suggest-allowlist.sh` to auto-generate better patterns
4. Review the TASK_PROMPT — is the agent task clear enough?

**Example:**
```bash
# Too narrow:
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts"

# Better (parser + related types and tests):
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts src/types/** tests/parser**"
```

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
