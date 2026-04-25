# Kaseki Agent Code Style Guide

This document outlines the code style expectations for contributions to the Kaseki Agent repository. All code must pass linting checks before submission. See [CONTRIBUTING.md](CONTRIBUTING.md#3-code-quality-linting-and-style) for how to run linters locally.

## JavaScript Style

### General Principles

- **Clarity over cleverness:** Write code that is easy to understand and maintain.
- **Node.js idioms:** Follow standard Node.js conventions and built-in modules (fs, path, child_process, etc.).
- **JSDoc comments:** Document public functions, classes, and complex logic with JSDoc.

### Formatting Rules (Enforced by ESLint)

| Rule | Style |
|------|-------|
| **Indentation** | 2 spaces (no tabs) |
| **Line endings** | Unix (LF) — enforced via `linebreak-style` |
| **Quotes** | Single quotes (`'string'`), except where escaping is needed or template literals are required |
| **Semicolons** | Required at end of statements |
| **Trailing whitespace** | Not allowed |
| **Blank lines** | Max 1 consecutive blank line |
| **Line length** | No strict limit; aim for readability (typically <100 chars per line) |

### Examples

**Good:**
```javascript
/**
 * List all kaseki instances.
 * Returns array of instance objects with metadata.
 */
function listInstances() {
  const instances = [];
  const results = fs.readdirSync(config.KASEKI_RESULTS_DIR);
  for (const dir of results) {
    instances.push({ name: dir });
  }
  return instances;
}
```

**Bad:**
```javascript
// Don't use double quotes unless escaping is needed
function listInstances() {
  const instances = []
  const results = fs.readdirSync(config.KASEKI_RESULTS_DIR); // missing indentation or semicolon
  for (const dir of results)
    instances.push({ name: dir })  // missing semicolon
  return instances
}
```

### Variable and Function Naming

- Use **camelCase** for variables and functions
- Use **UPPER_SNAKE_CASE** for constants (e.g., `KASEKI_RESULTS_DIR`)
- Use **PascalCase** for classes (rare in this repo, but when used)
- **Descriptive names:** `listInstances()` not `list()`, `exitCode` not `code`

### Comments

- Use `//` for single-line comments
- Use `/* */` for multi-line comments (rare)
- Use JSDoc (`/** */`) for function and class documentation
- Keep comments concise and explain *why*, not *what* (code shows what)

**Example JSDoc:**
```javascript
/**
 * Resolve a memory file path to its fully qualified URI.
 * @param {string} path - The memory file path (e.g., /memories/session/plan.md)
 * @returns {string} The resolved URI
 */
function resolveMemoryFileUri(path) {
  // implementation
}
```

### Imports and Requires

Use `require()` for Node.js modules (consistent with existing codebase):

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
```

Avoid wildcard imports; be specific:

```javascript
// Good
const { listInstances, getStatus } = require('./kaseki-cli-lib.js');

// Avoid
const * as lib = require('./kaseki-cli-lib.js');
```

### Error Handling

- Always handle errors explicitly; avoid swallowing errors silently
- Use `try-catch` for synchronous operations with error recovery
- Use descriptive error messages

```javascript
try {
  const metadata = JSON.parse(fs.readFileSync(path, 'utf8'));
  return metadata;
} catch (err) {
  console.error(`Failed to load metadata from ${path}: ${err.message}`);
  return null;
}
```

### Console Output

- `console.log()` is allowed (this is a CLI tool)
- Use `console.error()` for error/warning output
- Avoid debug logs in production; use conditional logging if needed

## Shell Script Style

### General Principles

- **Bash idioms:** Use standard Bash 4.x+ features; avoid overly POSIX-only code
- **Error handling:** Always use `set -euo pipefail` at the top to catch errors
- **Comments:** Document non-obvious logic
- **Readability:** Prefer clarity over brevity

### Formatting Rules (Checked by ShellCheck)

| Rule | Style |
|------|-------|
| **Indentation** | 2 spaces (no tabs) |
| **Line endings** | Unix (LF) |
| **Function declarations** | `function_name() { ... }` (preferred) or `function function_name { ... }` |
| **Variables** | Quote expansions: `"$var"` not `$var` |
| **Conditionals** | Use `[[ ]]` for conditions (Bash), not `[ ]` (POSIX) |
| **Command substitution** | Use `$(...)` not `` `...` `` |

### Examples

**Good:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Initialize paths
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
RESULTS="$KASEKI_ROOT/kaseki-results"

# Create directories
mkdir -p "$RESULTS"

# Loop with proper quoting
for instance in "${instances[@]}"; do
  echo "Instance: $instance"
done
```

**Bad:**
```bash
#!/bin/bash
# Missing error handling (no set -euo pipefail)
KASEKI_ROOT=${KASEKI_ROOT:-/agents}  # Unquoted expansion
mkdir $RESULTS  # Unquoted variable
for instance in $instances  # No array handling
```

### Variable Naming

- Use **UPPER_SNAKE_CASE** for environment variables and constants
- Use **lower_snake_case** for local variables
- Quote all variable expansions: `"$var"` not `$var`

```bash
# Good
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
results_dir="$KASEKI_ROOT/results"
```

### Functions

- Declare functions at the top of the script
- Use descriptive names
- Document non-obvious behavior

```bash
# Good
doctor() {
  # Check Docker availability
  if command -v docker >/dev/null 2>&1; then
    printf 'Docker: %s\n' "$(docker --version)"
  else
    printf 'Docker: missing\n' >&2
    return 1
  fi
}
```

### Error Handling

- Use `set -euo pipefail` to catch failures
- Use `|| true` to explicitly ignore an expected error
- Use `&& command` to chain dependent operations
- Provide clear error messages

```bash
# Good
PI_VERSION="$(pi --version 2>&1 | head -n 1 || true)"
mkdir -p "$RESULTS" || { printf 'Failed to create %s\n' "$RESULTS" >&2; return 1; }
```

### Comments

- Use `#` for single-line comments
- Keep comments concise
- Explain the "why" not the "what"

```bash
# Initialize with environment default, fallback to /agents
KASEKI_ROOT="${KASEKI_ROOT:-/agents}"
```

## Linting and Auto-Fix

### Running Linters

```bash
npm install                    # One-time setup
npm run lint                   # Check all files
npm run lint:fix               # Auto-fix issues
```

### Common Issues and Fixes

| Issue | Fix |
|-------|-----|
| Double quotes in JS | `npm run lint:js:fix` auto-fixes to single quotes |
| Missing semicolons | `npm run lint:js:fix` adds them |
| Trailing whitespace | `npm run lint:js:fix` removes it |
| Incorrect indentation | `npm run lint:js:fix` corrects to 2 spaces |
| Shell quoting errors | Review `npm run lint:sh` output; fix manually |

### Exceptions and Overrides

If you disagree with a linting rule:

1. **File an issue** describing the rule and why it's problematic for your use case
2. **Document the exception** in the PR description
3. **Discuss with reviewers** before committing

Avoid inline ESLint directives (e.g., `// eslint-disable`) unless absolutely necessary and well-justified.

## Testing and Validation

While this repo doesn't have a test suite yet, the scripts are validated by the target repositories they orchestrate. Keep scripts:

- **Deterministic:** Same inputs → same outputs
- **Idempotent where possible:** Running twice is safe
- **Well-documented:** Explain environment variables and options

## Related Documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
- [README.md](README.md) — Project overview and usage
- [CLAUDE.md](CLAUDE.md) — Internal guidance for Claude Code
