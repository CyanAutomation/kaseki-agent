# Real-World Examples & Integration Patterns

> **NPM CLI note:** `kaseki-agent run`, `list`, `report`, `status`, and `stop`/`cancel` are API-backed commands. Start `kaseki-agent serve` locally or set `KASEKI_API_URL` (and `KASEKI_API_KEY` for authenticated services) before running these examples.

This document provides concrete examples for common kaseki-agent use cases and integration patterns. Each example is executable and can be adapted to your workflow.

---

## Example 1: Bug Fix in a Single File

**Scenario:** Fix a specific bug in one file; prevent agent from modifying other files.

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="main"
TASK_PROMPT="Fix the null pointer bug in src/utils/parser.ts at line 42. The bug is: if (value) should be if (value !== null && value !== undefined). Only modify src/utils/parser.ts."
KASEKI_CHANGED_FILES_ALLOWLIST="src/utils/parser.ts"
KASEKI_MAX_DIFF_BYTES=50000  # Expect small diff
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Verify only the intended file changed
cat /agents/kaseki-results/kaseki-N/changed-files.txt
# Output should contain: src/utils/parser.ts

# Review the fix
git diff HEAD~1 src/utils/parser.ts
```

### Expected Result

- Exit code: 0 (success)
- Changed files: 1 (src/utils/parser.ts only)
- Diff size: <10 KB
- Validation: ✓ Passes

---

## Example 2: Add Tests for Existing Function

**Scenario:** Agent adds comprehensive test coverage for an untested function.

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="main"
TASK_PROMPT="Add comprehensive unit tests for the calculateDiscount() function in src/pricing/discount.ts. Write tests in tests/pricing/discount.test.ts covering: normal cases, edge cases (0%, 100%), and error cases (invalid input). Use the existing test framework (Jest). Do NOT modify src/pricing/discount.ts itself."
KASEKI_CHANGED_FILES_ALLOWLIST="tests/pricing/discount.test.ts"
KASEKI_AGENT_TIMEOUT_SECONDS=1800  # 30 min for thoughtful test writing
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Check if tests pass
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv | grep "npm run test"
# Should show exit code 0

# Review test count
grep -c "it(" /agents/kaseki-results/kaseki-N/git.diff
```

### Expected Result

- Exit code: 0 (success)
- Changed files: 1 (tests/pricing/discount.test.ts)
- Validation: ✓ npm run test passes
- Quality gates: ✓ File within allowlist

---

## Example 3: Multi-File Feature Addition

**Scenario:** Add a new feature that requires changes to multiple files (component, types, tests, docs).

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="feature/branch"
TASK_PROMPT="Add a UserPreferences feature. Create:
1. src/features/UserPreferences.tsx — React component with hook integration
2. src/types/preferences.ts — TypeScript types (UserPreference, PreferenceKey)
3. tests/features/UserPreferences.test.tsx — Unit tests (rendering, state changes)
4. docs/features/USER_PREFERENCES.md — Usage documentation

Requirements:
- Use React hooks (useState, useContext)
- Follow existing code style in src/components/
- Ensure tests achieve >80% coverage
- Export types and component from src/index.ts
Do NOT modify existing features or public API."

KASEKI_CHANGED_FILES_ALLOWLIST="src/features/UserPreferences.tsx src/types/preferences.ts tests/features/*.test.tsx docs/features/*.md src/index.ts"
KASEKI_MAX_DIFF_BYTES=150000  # Expect 50-100 KB for multi-file feature
KASEKI_AGENT_TIMEOUT_SECONDS=2400  # 40 min for feature work
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Count changed files
wc -l /agents/kaseki-results/kaseki-N/changed-files.txt  # Should be ~5

# Check diff size
wc -c /agents/kaseki-results/kaseki-N/git.diff

# Verify tests pass
grep "npm run test" /agents/kaseki-results/kaseki-N/validation-timings.tsv | awk '{print $2}'
```

### Expected Result

- Exit code: 0 (success)
- Changed files: ~5 (component, types, tests, docs, exports)
- Diff size: 50-100 KB
- Validation: ✓ Tests pass, build succeeds

---

## Example 4: Refactor Legacy Code with Tests

**Scenario:** Refactor deeply nested callback code to async/await while maintaining test coverage.

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="main"
TASK_PROMPT="Refactor src/api/fetch.ts from callback-based to async/await. Constraints:
1. Maintain exact same behavior and API surface
2. Update existing tests in tests/api/fetch.test.ts to match new async patterns
3. Add 3+ new test cases for error scenarios
4. Do NOT add new functions or exports
5. Preserve backward compatibility

Current code uses: then().catch() chains
Target code uses: async/await with try/catch"

KASEKI_CHANGED_FILES_ALLOWLIST="src/api/fetch.ts tests/api/fetch.test.ts"
KASEKI_MAX_DIFF_BYTES=100000
KASEKI_AGENT_TIMEOUT_SECONDS=2400  # Refactoring is time-intensive
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Verify tests still pass (crucial for refactoring)
cat /agents/kaseki-results/kaseki-N/validation-timings.tsv | grep "npm run test"

# Review test changes (should be mostly new tests)
grep "it(" /agents/kaseki-results/kaseki-N/git.diff | wc -l  # New test cases
```

### Expected Result

- Exit code: 0 (success)
- Changed files: 2 (source + tests)
- Validation: ✓ Tests pass (proves no behavior change)
- Quality: ✓ No extra files modified

---

## Example 5: Upgrade Dependencies with Lock-In

**Scenario:** Upgrade a major dependency (React 18 → 19) and update code to use new features.

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="main"
TASK_PROMPT="Upgrade React to v19 in package.json and update codebase:
1. Update package.json: react ^19.0.0
2. Run npm install (new lock file)
3. Update src/index.tsx to use new React JSX transform (remove React import in JSX files)
4. Update src/App.tsx to use new React 19 features (if applicable)
5. Update tests to work with React 19 test utils
6. Verify npm run test passes

IMPORTANT: Only modify files that require React changes. Do NOT add new dependencies."

KASEKI_CHANGED_FILES_ALLOWLIST="package.json package-lock.json src/**/*.tsx src/**/*.ts tests/**/*.test.tsx"
KASEKI_MAX_DIFF_BYTES=200000  # Lock file can be large
KASEKI_AGENT_TIMEOUT_SECONDS=3600  # 60 min for dependency updates
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Check lock file was updated
grep '"react":' /agents/kaseki-results/kaseki-N/git.diff | head -3

# Verify build works
grep "npm run build" /agents/kaseki-results/kaseki-N/validation-timings.tsv
```

### Expected Result

- Exit code: 0 (success)
- Changed files: package.json, lock file, source files
- Diff size: 100-200 KB (lock files are large)
- Validation: ✓ Build passes, tests pass

---

## Example 6: Error Handling & Retry Pattern

**Scenario:** Implement error handling and retry logic around an unreliable operation.

### Setup

```bash
REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="main"
TASK_PROMPT="Add exponential backoff retry logic to src/api/client.ts fetchData() function:
1. Wrap fetchData() with a retry wrapper (max 3 attempts)
2. Implement exponential backoff: wait 1s, 2s, 4s between retries
3. Add jitter to prevent thundering herd: ±25% of wait time
4. Log each retry attempt with attempt number and wait time
5. Update tests in tests/api/client.test.ts to cover: success on first try, success on retry, failure after max retries

Use existing logging setup (logger.debug, logger.error)."

KASEKI_CHANGED_FILES_ALLOWLIST="src/api/client.ts tests/api/client.test.ts"
KASEKI_MAX_DIFF_BYTES=75000
KASEKI_AGENT_TIMEOUT_SECONDS=1800
```

### Run

```bash
kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
```

### Validation

```bash
# Check new test coverage
grep -A 5 "success on retry" /agents/kaseki-results/kaseki-N/git.diff

# Verify no external dependencies added
grep "^+.*import" /agents/kaseki-results/kaseki-N/git.diff
```

### Expected Result

- Exit code: 0 (success)
- Changed files: 2 (source + tests)
- New test cases: 3+ (covering all retry scenarios)
- Validation: ✓ Tests pass

---

## Example 7: Multi-Repo Batch Processing

**Scenario:** Run the same task across 10 repositories and collect results.

### Shell Script

```bash
#!/bin/bash
# Batch process multiple repos with kaseki-agent

REPOS=(
  "myorg/repo1"
  "myorg/repo2"
  "myorg/repo3"
  # ... up to 10 repos
)

TASK_PROMPT="Add MIT license header to all source files in src/. Format:
// Copyright (C) 2026 My Company
// SPDX-License-Identifier: MIT"

RESULTS_DIR="./batch-results"
mkdir -p "$RESULTS_DIR"

for REPO in "${REPOS[@]}"; do
  REPO_URL="https://github.com/$REPO"
  GIT_REF="main"
  
  echo "Processing $REPO..."
  
  # Run kaseki-agent
  kaseki-agent run "$REPO_URL" "$GIT_REF" "$TASK_PROMPT"
  
  # Capture run ID (find latest kaseki-N directory)
  RUN_ID=$(ls -t /agents/kaseki-results/ | head -1)
  
  # Copy results
  cp -r "/agents/kaseki-results/$RUN_ID" "$RESULTS_DIR/$REPO"
  
  # Check status
  EXIT_CODE=$(cat "/agents/kaseki-results/$RUN_ID/exit_code")
  if [ "$EXIT_CODE" = "0" ]; then
    echo "✓ $REPO: Success"
  else
    echo "✗ $REPO: Failed (exit $EXIT_CODE)"
  fi
  
  sleep 10  # Rate limiting (adjust for API quotas)
done

# Generate summary
echo "Batch processing complete. Results in $RESULTS_DIR"
find "$RESULTS_DIR" -name "exit_code" -exec sh -c 'echo "$(dirname {}): $(cat {})"' \;
```

---

## Example 8: Conditional Task Flow (Error Recovery)

**Scenario:** Run a task, check results, and conditionally run follow-up tasks.

### Shell Script

```bash
#!/bin/bash
# Conditional workflow based on kaseki-agent results

REPO_URL="https://github.com/myorg/myrepo"
GIT_REF="feature/new-api"

# Step 1: Implement feature
echo "Step 1: Implementing feature..."
kaseki-agent run "$REPO_URL" "$GIT_REF" "Add user authentication API endpoint"
RUN_1=$(ls -t /agents/kaseki-results/ | head -1)
EXIT_1=$(cat "/agents/kaseki-results/$RUN_1/exit_code")

if [ "$EXIT_1" != "0" ]; then
  echo "✗ Step 1 failed (exit $EXIT_1). Stopping."
  exit 1
fi

# Step 2: If implementation succeeded, add tests
echo "Step 2: Adding tests..."
kaseki-agent run "$REPO_URL" "$GIT_REF" "Add integration tests for authentication API"
RUN_2=$(ls -t /agents/kaseki-results/ | head -1)
EXIT_2=$(cat "/agents/kaseki-results/$RUN_2/exit_code")

if [ "$EXIT_2" != "0" ]; then
  echo "⚠ Step 2 failed (exit $EXIT_2). Proceeding to documentation."
fi

# Step 3: Add documentation
echo "Step 3: Adding documentation..."
kaseki-agent run "$REPO_URL" "$GIT_REF" "Document authentication API usage and examples"
RUN_3=$(ls -t /agents/kaseki-results/ | head -1)
EXIT_3=$(cat "/agents/kaseki-results/$RUN_3/exit_code")

# Summary
echo "Workflow complete:"
echo "  Step 1 (Implementation): $([ "$EXIT_1" = "0" ] && echo '✓' || echo '✗')"
echo "  Step 2 (Tests): $([ "$EXIT_2" = "0" ] && echo '✓' || echo '✗')"
echo "  Step 3 (Docs): $([ "$EXIT_3" = "0" ] && echo '✓' || echo '✗')"
```

---

## Example 9: OpenRouter API Integration with Custom Client

**Scenario:** Use kaseki-agent from TypeScript/JavaScript application with error handling.

### TypeScript Example

```typescript
import { KasekiApiClient } from '@cyanautomation/kaseki-agent/api-client';

async function fixRepositoryBug() {
  const client = new KasekiApiClient({
    apiKey: process.env.KASEKI_API_KEY!,
    apiUrl: 'http://localhost:8080',
    timeout: 30000,
  });

  try {
    // Submit a run
    const run = await client.submitRun({
      repoUrl: 'https://github.com/myorg/myrepo',
      gitRef: 'main',
      taskPrompt: 'Fix the null pointer bug in src/parser.ts line 42.',
      allowlist: ['src/parser.ts', 'tests/parser.test.ts'],
      maxDiffBytes: 50000,
      timeoutSeconds: 1800,
    });

    console.log(`Run submitted: ${run.instanceId}`);

    // Poll for completion (with timeout)
    const result = await client.waitForCompletion(run.instanceId, {
      pollIntervalSeconds: 5,
      maxWaitSeconds: 2000,
    });

    // Check status
    if (result.status === 'completed') {
      if (result.exitCode === 0) {
        console.log('✓ Bug fix succeeded!');
        console.log(`Changed files: ${result.changedFiles.join(', ')}`);
      } else {
        console.log(`✗ Bug fix failed with exit code ${result.exitCode}`);
        console.log(`Reason: ${result.failureReason}`);
      }
    } else if (result.status === 'timeout') {
      console.log('✗ Run timed out. Check logs at:', result.resultsDir);
    }

    // Access artifacts
    if (result.resultsDir) {
      const diff = await client.readArtifact(result.instanceId, 'git.diff');
      const summary = await client.readArtifact(result.instanceId, 'result-summary.md');
      
      console.log('Diff:', diff.slice(0, 500));
      console.log('Summary:', summary);
    }
  } catch (error) {
    console.error('Kaseki API error:', error);
    
    // Retry logic
    if (error.code === 'ECONNREFUSED') {
      console.log('API service not running. Start with: docker-compose up -d');
    } else if (error.message.includes('Unauthorized')) {
      console.log('Invalid API key. Check KASEKI_API_KEY');
    }
  }
}

fixRepositoryBug();
```

---

## Example 10: Webhook Integration with GitHub

**Scenario:** Integrate kaseki-agent with GitHub Actions to auto-fix issues.

### GitHub Actions Workflow

```yaml
name: Auto-Fix with Kaseki Agent

on:
  issues:
    types: [opened, labeled]
  workflow_dispatch:
    inputs:
      issue_number:
        description: 'Issue number to fix'
        required: true

jobs:
  kaseki-fix:
    runs-on: ubuntu-latest
    if: contains(github.event.issue.labels.*.name, 'auto-fix')
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Parse issue
        id: parse
        run: |
          ISSUE_TITLE="${{ github.event.issue.title }}"
          ISSUE_BODY="${{ github.event.issue.body }}"
          
          # Extract fix instruction from issue (e.g., "Fix: null pointer in parser.ts")
          TASK_PROMPT="${ISSUE_TITLE}: ${ISSUE_BODY}"
          
          echo "task_prompt=$TASK_PROMPT" >> $GITHUB_OUTPUT
      
      - name: Submit to Kaseki Agent
        id: kaseki
        run: |
          # Call Kaseki API
          RESPONSE=$(curl -X POST \
            -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
            -H "Content-Type: application/json" \
            -d @- \
            http://kaseki-api:8080/api/runs << 'EOF'
          {
            "repoUrl": "https://github.com/${{ github.repository }}",
            "gitRef": "${{ github.event.repository.default_branch }}",
            "taskPrompt": "${{ steps.parse.outputs.task_prompt }}",
            "allowlist": [],
            "timeoutSeconds": 1800
          }
          EOF
          )
          
          INSTANCE_ID=$(echo "$RESPONSE" | jq -r '.instanceId')
          echo "instance_id=$INSTANCE_ID" >> $GITHUB_OUTPUT
      
      - name: Wait for completion
        run: |
          INSTANCE_ID="${{ steps.kaseki.outputs.instance_id }}"
          timeout=0
          
          while [ $timeout -lt 2000 ]; do
            STATUS=$(curl -s \
              -H "Authorization: Bearer ${{ secrets.KASEKI_API_KEY }}" \
              http://kaseki-api:8080/api/runs/$INSTANCE_ID | jq -r '.status')
            
            if [ "$STATUS" = "completed" ]; then
              echo "Run completed"
              break
            fi
            
            echo "Status: $STATUS (${timeout}s elapsed)"
            sleep 10
            timeout=$((timeout + 10))
          done
      
      - name: Create PR with changes
        if: steps.kaseki.outputs.instance_id != ''
        run: |
          # Get changes from kaseki results
          RESULTS_DIR="/path/to/kaseki-results/${{ steps.kaseki.outputs.instance_id }}"
          
          # Create branch
          git config user.name "kaseki-agent[bot]"
          git config user.email "kaseki-agent@example.com"
          git checkout -b "kaseki-fix-issue-${{ github.event.issue.number }}"
          
          # Apply changes (pseudo-code; actual diff application depends on results)
          git apply "$RESULTS_DIR/git.diff"
          git add -A
          git commit -m "Fix: Issue #${{ github.event.issue.number }} via Kaseki Agent"
          
          # Push and create PR
          git push origin "kaseki-fix-issue-${{ github.event.issue.number }}"
          
          gh pr create \
            --title "Fixes: Issue #${{ github.event.issue.number }}" \
            --body "Automated fix via Kaseki Agent\n\n$(cat $RESULTS_DIR/result-summary.md)" \
            --head "kaseki-fix-issue-${{ github.event.issue.number }}" \
            --base "${{ github.event.repository.default_branch }}"
```

---

## Common Integration Patterns

### Pattern: Scope & Allowlist for Safety

Always combine **task prompt clarity** with **allowlist restriction**:

```bash
# Prompt: Be specific about file scope
TASK_PROMPT="Fix bug in src/parser.ts. Do NOT modify other files."

# Allowlist: Enforce the scope
KASEKI_CHANGED_FILES_ALLOWLIST="src/parser.ts tests/parser.test.ts"
```

### Pattern: Validation-First Development

Always validate after agent changes:

```bash
# Generous timeout for agent to think
KASEKI_AGENT_TIMEOUT_SECONDS=3600

# Then validate with comprehensive tests (note: default is check+test; this adds lint)
KASEKI_VALIDATION_COMMANDS="npm run check;npm run test;npm run lint"
```

### Pattern: Incremental Workflows

Break large tasks into smaller steps:

```bash
# Step 1: Implement
kaseki-agent run ... "Add UserProfile component"

# Step 2: Test
kaseki-agent run ... "Add tests for UserProfile"

# Step 3: Document
kaseki-agent run ... "Document UserProfile API"
```

---

## Debugging Failed Examples

Use [TROUBLESHOOTING.md](TROUBLESHOOTING.md) to diagnose failures:

1. Check `result-summary.md` for exit code and reason
2. Review `validation.log` if exit code is 7 (validation failed)
3. Check `quality.log` for allowlist violations (exit codes 4, 5)
4. Use `kaseki-cli analysis` for post-run summary

---

## See Also

- [TASK_PROMPT_TEMPLATES.md](TASK_PROMPT_TEMPLATES.md) — Writing better prompts
- [QUALITY_GATES.md](QUALITY_GATES.md) — Allowlist configuration
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Debugging failed runs
- [CLI.md](CLI.md) — Monitoring with kaseki-cli
