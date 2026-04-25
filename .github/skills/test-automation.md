---
name: Test Automation
description: Testing kaseki-agent behavior changes and adding new test coverage
tags: [kaseki, testing, qa, automation, vitest]
relatedSkills: [workflow-diagnosis]
---

# Test Automation for Kaseki Agent

This skill guides adding and updating tests when kaseki-agent behavior changes, ensuring quality and catching regressions.

## Overview

**When to Use**:
- Adding a new feature to kaseki-agent (e.g., new cache layer)
- Changing behavior of existing scripts (run-kaseki.sh, kaseki-agent.sh)
- Security or validation logic changes
- Bug fixes in core components
- Pre-PR validation of changes

**Key Concepts**:
- Tests include unit tests (scripts, logic) and integration tests (Docker-based)
- Validation in CI/CD must pass before merging
- Coverage expectations vary by change type (bug fix vs. new feature)
- Tests should validate both success and failure paths

---

## Test Structure Overview

Kaseki-agent uses a two-tier testing strategy:

### 1. **Unit Tests** (JavaScript/Node.js)
Location: `tests/` directory (or integrated in repo root)  
Tools: Vitest, Node.js assertions  
Scope: Pure logic (not Docker-dependent)

**Examples**:
- `pi-event-filter.js` logic: filtering JSONL events correctly
- `kaseki-report.js` logic: parsing metadata and formatting output
- Utility functions: hashing, path construction, env var handling

**Run Locally**:
```bash
npm test
npm test -- tests/pi-event-filter.test.js  # Single test file
npm test -- --watch  # Watch mode during development
```

### 2. **Integration Tests** (Docker-based)
Location: `.github/workflows/` or custom scripts  
Scope: Full pipeline (clone, build image, run container)

**Examples**:
- Image builds successfully on amd64 + arm64
- kaseki-agent.sh correctly clones repo and runs agent
- Quality gates properly reject oversized diffs
- Secret scan correctly identifies credential patterns

**Run Locally**:
```bash
docker build -t kaseki-template:latest .
docker run --rm kaseki-template:latest --doctor  # Sanity check
```

---

## Unit Test Patterns

### Test File Naming
- Source: `src/lib/parser.ts`
- Test: `tests/lib/parser.test.ts` (or `parser.test.js` for JS files)

### Basic Test Structure

```javascript
import { describe, it, expect } from 'vitest';
import { piEventFilter } from '../pi-event-filter.js';

describe('pi-event-filter', () => {
  it('filters out thinking blocks from events', () => {
    const input = [
      { type: 'thought', content: 'Let me think about this...' },
      { type: 'tool_call', tool: 'bash', input: 'echo hello' },
    ];
    
    const output = piEventFilter(input);
    
    expect(output).toHaveLength(1);
    expect(output[0].type).toBe('tool_call');
  });

  it('handles empty input gracefully', () => {
    const output = piEventFilter([]);
    expect(output).toEqual([]);
  });
});
```

### Testing Success Paths

**Pattern**: Expected behavior under normal conditions

```javascript
describe('kaseki-report', () => {
  it('parses metadata.json correctly', () => {
    const metadata = {
      instance: 'kaseki-1',
      exit_codes: { overall: 0 },
      duration_seconds: 600,
    };
    
    const report = generateReport(metadata);
    
    expect(report).toContain('kaseki-1');
    expect(report).toContain('600s');
  });
});
```

### Testing Failure Paths

**Pattern**: Graceful degradation and error handling

```javascript
describe('run-kaseki.sh validation', () => {
  it('exits with code 2 when OPENROUTER_API_KEY is missing', async () => {
    const result = await runKasekiWithEnv({
      OPENROUTER_API_KEY: undefined,
    });
    
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('API key required');
  });

  it('exits with code 5 when changed files violate allowlist', async () => {
    const result = await runKasekiWithDiff({
      changedFiles: ['src/lib/parser.ts', 'src/other/config.ts'],
      allowlist: 'src/lib/parser.ts',
    });
    
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain('allowlist');
  });
});
```

### Testing Edge Cases

**Pattern**: Boundary conditions and unusual inputs

```javascript
describe('dependency cache', () => {
  it('handles repos with no package-lock.json', () => {
    const lockHash = computeLockHash({ hasLock: false });
    expect(lockHash).toBe('no-lock');
  });

  it('detects lock file changes and busts cache', () => {
    const oldStamp = 'repo-abc123-lock-def456';
    const newLock = 'lock-xyz789';
    
    const shouldBust = shouldBustCache(oldStamp, newLock);
    expect(shouldBust).toBe(true);
  });

  it('handles very large lock files (>1MB)', () => {
    const largeContent = 'x'.repeat(2000000);
    const hash = computeLockHash({ content: largeContent });
    
    expect(hash).toHaveLength(40);  // SHA1 hex digest
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });
});
```

---

## Integration Test Patterns

### Docker Image Tests

**Pattern**: Verify image builds and basic functionality

```bash
#!/bin/bash
# tests/docker-image.test.sh

set -e

echo "Building Docker image..."
docker build -t kaseki-test:latest .

echo "Testing Pi CLI is installed..."
docker run --rm kaseki-test:latest which pi
docker run --rm kaseki-test:latest pi --version | grep -q "0.70.2"

echo "Testing non-root user..."
docker run --rm kaseki-test:latest id -u | grep -q "10001"

echo "✓ All image tests passed"
```

**Run**:
```bash
bash tests/docker-image.test.sh
```

### Multi-Arch Build Tests

**Pattern**: Verify builds work on amd64 + arm64 (if using buildx)

```bash
#!/bin/bash
# tests/multi-arch-build.test.sh

set -e

echo "Building for amd64..."
docker buildx build --platform linux/amd64 -t kaseki-amd64:test .

echo "Building for arm64..."
docker buildx build --platform linux/arm64 -t kaseki-arm64:test .

echo "✓ Multi-arch builds successful"
```

### Smoke Tests (Sanity Check)

**Pattern**: Run --doctor without actually invoking the agent

```bash
#!/bin/bash
# tests/smoke.test.sh

set -e

echo "Testing --doctor (sanity check)..."

# This should verify setup without requiring API key
./run-kaseki.sh --doctor
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "✓ Setup is valid"
else
  echo "✗ Setup check failed with code $EXIT_CODE"
  exit 1
fi
```

---

## Test Coverage Expectations

### By Change Type

| Change Type | Expected Coverage | Example |
|---|---|---|
| **Bug Fix** | Regression test + fix verification | Add test for null/undefined case, then fix |
| **New Feature** | Feature test + edge cases | New cache layer: test hit, miss, invalidation |
| **Refactor** | Preserve all existing tests | Move function: same tests still pass |
| **Performance** | Baseline + improvement test | Caching: measure time before/after |
| **Security** | Security test + validation | Secret scan: test detection of credentials |
| **Dependency Update** | Compatibility test | Node upgrade: verify no breaking changes |

### Calculating Coverage

```bash
# Run tests with coverage report (if configured)
npm test -- --coverage

# Output example:
# PASS  tests/pi-event-filter.test.js
# ✓ filters out thinking blocks (25ms)
# ✓ handles empty input (2ms)
#
# PASS  tests/kaseki-report.test.js
# ✓ parses metadata correctly (5ms)
#
# Test Files: 2 passed (2)
# Tests: 5 passed (5)
# Coverage: 85% (target: 80%+)
```

---

## Adding Tests for Common Changes

### Change: New Quality Gate

**Scenario**: Add a new validation rule (e.g., "no console.log in production code")

**Test Plan**:
1. Success case: Valid code passes gate
2. Failure case: Invalid code fails gate
3. Edge case: Empty or unusual input

**Test Code**:
```javascript
describe('no-console-log gate', () => {
  it('passes when code has no console.log', () => {
    const diff = `
+function log() {
+  logger.debug('message');
+}
    `;
    
    const result = validateNoConsoleLog(diff);
    expect(result.passed).toBe(true);
  });

  it('fails when code has console.log', () => {
    const diff = `
+function log() {
+  console.log('debug');
+}
    `;
    
    const result = validateNoConsoleLog(diff);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('console.log');
  });

  it('handles diffs with multiple console references', () => {
    const diff = `
+console.log('start');
+console.error('failed');
-console.warn('old');
    `;
    
    const result = validateNoConsoleLog(diff);
    expect(result.violations).toHaveLength(2);  // log + error
  });
});
```

### Change: Dependency Cache Logic

**Scenario**: Modify the 4-layer cache strategy

**Test Plan**:
1. Cache hit: Stamp matches, skip install
2. Cache miss: Stamp mismatch, run install
3. Layer hierarchy: Try workspace → seed → fresh

**Test Code**:
```javascript
describe('dependency cache', () => {
  it('skips npm install if stamp matches', async () => {
    const workspace = createTempWorkspace({
      stamp: 'repo-abc-lock-def',
    });
    
    const result = await prepareNodeDependencies(workspace, {
      expectedStamp: 'repo-abc-lock-def',
    });
    
    expect(result.cacheHit).toBe(true);
    expect(result.npmInstallRan).toBe(false);
  });

  it('restores from workspace cache if available', async () => {
    const workspace = createTempWorkspace({
      stamp: 'old-stamp',
      cacheDir: '.kaseki-cache/repo-abc/lock-def/',
    });
    
    const result = await prepareNodeDependencies(workspace);
    
    expect(result.source).toBe('workspace-cache');
    expect(result.npmInstallRan).toBe(false);
  });

  it('falls back to npm install on cache miss', async () => {
    const workspace = createTempWorkspace({
      stamp: 'missing',  // No cache
    });
    
    const result = await prepareNodeDependencies(workspace);
    
    expect(result.source).toBe('fresh-install');
    expect(result.npmInstallRan).toBe(true);
  });
});
```

### Change: Secret Scanning

**Scenario**: Update secret patterns or scanning logic

**Test Plan**:
1. Detect real pattern: sk-or-* credentials
2. Avoid false positives: sk-or in comments
3. Scan all artifacts: logs, diffs, metadata

**Test Code**:
```javascript
describe('secret scanning', () => {
  it('detects sk-or- API keys', () => {
    const content = 'OPENROUTER_API_KEY=sk-or-abc123xyz789';
    const secrets = scanForSecrets(content);
    
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatch(/sk-or-[a-z0-9]+/);
  });

  it('ignores sk-or in comments or strings', () => {
    const content = `
// This is a comment about sk-or- keys
const example = 'sk-or- pattern';
    `;
    
    const secrets = scanForSecrets(content);
    expect(secrets).toHaveLength(0);  // No real keys
  });

  it('scans all artifact files', async () => {
    const artifacts = {
      'pi-events.jsonl': 'some sk-or-secret in event',
      'git.diff': 'another sk-or-secret in diff',
    };
    
    const result = scanArtifacts(artifacts);
    expect(result.violations).toHaveLength(2);
    expect(result.files).toContain('pi-events.jsonl');
    expect(result.files).toContain('git.diff');
  });
});
```

---

## Running Tests Locally

### Setup
```bash
# Install dependencies
npm ci

# Or, if you've modified package.json
npm install
```

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test -- tests/pi-event-filter.test.js
```

### Watch Mode (TDD)
```bash
npm test -- --watch
```

### With Coverage
```bash
npm test -- --coverage
```

### Specific Test (by name)
```bash
npm test -- -t "filters out thinking blocks"
```

---

## CI/CD Integration

### GitHub Actions Workflow

Tests typically run in `.github/workflows/` on pull requests and merges:

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '22.22.2'
      
      - run: npm ci
      
      - run: npm test
        # Fails PR if tests don't pass
      
      - run: npm test -- --coverage
        # Optional: report coverage
```

### Pre-Commit Hook (Optional)

Optionally run tests before committing:

```bash
# .husky/pre-commit
#!/bin/sh
npm test
```

---

## Debugging Failed Tests

### Test Fails Locally

**Step 1**: Read the error message carefully
```
FAIL tests/pi-event-filter.test.js
  ✓ filters out thinking blocks (25ms)
  ✗ handles empty input (12ms)
    
    Expected: []
    Received: [{ type: 'message', content: '' }]
```

**Step 2**: Isolate the test
```bash
npm test -- -t "handles empty input"
```

**Step 3**: Add debug output
```javascript
it('handles empty input gracefully', () => {
  const output = piEventFilter([]);
  console.log('Actual output:', JSON.stringify(output, null, 2));
  expect(output).toEqual([]);
});
```

**Step 4**: Run in watch mode to iterate
```bash
npm test -- --watch
```

### Test Fails in CI

**Diagnose**:
1. Check GitHub Actions logs (Actions tab in PR)
2. Look for differences from local environment (Node version, OS, etc.)
3. Reproduce locally with same Node version:
   ```bash
   nvm use 22.22.2  # Match CI version
   npm ci
   npm test
   ```

---

## Best Practices

1. **Test Behavior, Not Implementation**
   - ✓ "Function returns null when input is null"
   - ✗ "Function calls helper.check() exactly once"

2. **Use Descriptive Test Names**
   - ✓ "exits with code 5 when changed files violate allowlist"
   - ✗ "test allowlist"

3. **Keep Tests Isolated**
   - Each test should be independent
   - Don't rely on test execution order
   - Clean up (mock cleanup, temp files) in `afterEach`

4. **Test Both Success and Failure**
   - Happy path + error cases
   - Edge cases and boundaries
   - Upstream failures (e.g., Docker unavailable)

5. **Use Realistic Test Data**
   - Real exit codes, diff formats, API responses
   - Redact sensitive information
   - Keep data minimal (just enough for test)

---

## Related Skills & Docs

- [Workflow Diagnosis](workflow-diagnosis.md) — Validate test results and troubleshoot failures
- [Docker Image Management](docker-image-management.md) — Integration test patterns
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — Contribution guidelines and validation expectations
- [Dockerfile](../../Dockerfile) — Image structure for integration tests
