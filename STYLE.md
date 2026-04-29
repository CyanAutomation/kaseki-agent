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

## TypeScript Style

### General Principles

- **Type Safety:** All code must pass `npm run type-check` with no errors. Strict mode is enforced.
- **Explicit Types:** Function parameters, return types, and complex variables must have explicit type annotations. Never use implicit `any`.
- **Clarity:** Type signatures should make code intent clear; avoid overly complex generic types.
- **Consistency:** Follow the same patterns established in existing `.ts` files (e.g., `src/kaseki-cli-lib.ts`).

### Type Annotations

**Always annotate:**

```typescript
// Good: explicit parameter and return types
function listInstances(): KasekiInstance[] {
  const instances: KasekiInstance[] = [];
  // ...
  return instances;
}

// Good: interface for complex data
interface Metadata {
  exitCode: number;
  timestamp: string;
  model: string;
}

// Bad: implicit any
function listInstances() {
  const instances = [];  // any[], should be typed
  return instances;
}

// Bad: missing return type
function getStatus(name: string) {
  return { running: true };
}
```

### Interface and Type Definitions

- Use **PascalCase** for interface and type names
- Group related interfaces at the top of the file
- Document with JSDoc comments

```typescript
/**
 * Represents a kaseki instance with metadata and status.
 */
interface KasekiInstance {
  name: string;
  running: boolean;
  elapsed?: number;
  timeout?: number;
}

/**
 * Configuration for kaseki directories.
 */
interface Config {
  resultsDir: string;
  runsDir: string;
}
```

### Imports and Exports

Use **ES2024 import/export syntax** in source files:

```typescript
// Good: ES2024 imports
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface KasekiInstance { ... }
export function listInstances(): KasekiInstance[] { ... }
```

The build process compiles to CommonJS for Node.js compatibility.

### Union Types and Type Guards

Use discriminated unions and type guards for flexibility:

```typescript
// Good: discriminated union
type EventType = 
  | { type: 'tool_start'; timestamp: string }
  | { type: 'tool_end'; timestamp: string };

function handleEvent(event: EventType): void {
  switch (event.type) {
    case 'tool_start':
      console.log('Tool started:', event.timestamp);
      break;
    case 'tool_end':
      console.log('Tool ended:', event.timestamp);
      break;
  }
}

// Bad: optional fields without discrimination
interface Event {
  type?: string;
  startTime?: string;
  endTime?: string;
}
```

### Null and Undefined Handling

Use explicit null checks and nullish coalescing:

```typescript
// Good: explicit null check
function readMetadata(path: string): Metadata | null {
  try {
    const text = fs.readFileSync(path, 'utf8');
    return JSON.parse(text) as Metadata;
  } catch {
    return null;
  }
}

// Good: nullish coalescing
const timeout = metadata.timeout ?? 3600;

// Good: optional chaining
const model = metadata?.model?.toLowerCase();
```

### Generics

Use generics for reusable functions, but keep them readable:

```typescript
// Good: simple generic
function first<T>(array: T[]): T | undefined {
  return array[0];
}

// Avoid: overly complex generics without clear benefit
function transform<T, U extends Record<string, T>, V = U>(input: U): V { ... }
```

### Async/Await

Always use async/await; avoid bare Promises when possible:

```typescript
// Good: async function
async function loadConfig(): Promise<Config> {
  const text = await fs.promises.readFile(configPath, 'utf8');
  return JSON.parse(text);
}

// Acceptable: Promise for library functions
function createReadStream(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // ...
  });
}
```

### Error Handling

Handle errors explicitly with specific types:

```typescript
// Good: specific error type
async function processFile(path: string): Promise<void> {
  try {
    const text = await fs.promises.readFile(path, 'utf8');
    const data = JSON.parse(text) as PiEvent;
    // ...
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to process ${path}: ${message}`);
    throw err;
  }
}
```

### Comments and JSDoc

Use JSDoc for public functions and complex logic:

```typescript
/**
 * Load and parse a Pi event from a JSONL file.
 * @param path - Path to the JSONL file
 * @returns Parsed event, or null if file not found
 * @throws Error if JSON parsing fails
 */
function loadEvent(path: string): PiEvent | null {
  // ...
}
```

### Const Assertions and readonly

Use `as const` for literal tuples and type-safe constants:

```typescript
// Good: const assertion for tuple
const ENV_VARS = ['OPENROUTER_API_KEY', 'KASEKI_TIMEOUT'] as const;

// Good: readonly for immutable arrays
function processItems(items: readonly string[]): void {
  // items cannot be modified
}
```

### Testing TypeScript Files

Jest tests for TypeScript use the same style rules:

```typescript
describe('MyFunction', () => {
  it('should return correct result', () => {
    const input: MyType = { ... };
    const result: ExpectedType = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

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
npm run type-check             # Check TypeScript types
npm run lint                   # Check all TypeScript and shell files
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

### Unit Tests

This repo includes Jest test suites for TypeScript utilities and CLI functions:

```bash
npm test                       # Run type-check, Jest tests, and bash integration tests
npm run test:watch             # Watch mode for active development
npm run test:coverage          # Generate coverage report
```

- **Location:** `src/**/*.test.ts`
- **Framework:** Jest 29.7 with ts-jest 29.2
- **Coverage:** Collected from all `src/**/*.ts` files, excluding tests
- **Timeout:** Most tests complete in milliseconds; memory stress test has 120s timeout

### Integration Tests

The scripts are also validated by the target repositories they orchestrate. Keep scripts:

- **Deterministic:** Same inputs → same outputs
- **Idempotent where possible:** Running twice is safe
- **Well-documented:** Explain environment variables and options

## Related Documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
- [README.md](README.md) — Project overview and usage
- [CLAUDE.md](CLAUDE.md) — Internal guidance for Claude Code
