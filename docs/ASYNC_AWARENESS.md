# Async Awareness: Smart Async-Aware Code Changes

Kaseki's **async awareness** feature detects when code changes involve asynchronous patterns (async/await, Promises, callbacks) and automatically:

1. **Updates goal-setting criteria** with mock file and test file requirements
2. **Embeds scouting discoveries** into the agent's TASK_PROMPT
3. **Guides the agent** on what mock and test files need updates

This prevents the common problem: an agent modifies async code but forgets to update the dependent mocks and test assertions.

## The Problem

### Scenario: Converting Callbacks to Async/Await

**Task:** Refactor HTTP client to use async/await instead of callbacks.

**What agent might do (without async awareness):**

```typescript
// ✅ Fixed: api.ts
export async function fetchUser(id: string) {
  return fetch(`/api/users/${id}`).then(r => r.json());
}

// ❌ Forgotten: __mocks__/api.ts (still using callbacks)
export function fetchUser(id, callback) {
  callback(null, { id: '123', name: 'John' });
}

// ❌ Forgotten: api.test.ts (still using callback assertions)
it('should fetch user', (done) => {
  fetchUser('1', (err, user) => {
    expect(user.name).toBe('John');
    done();
  });
});
```

Result: Tests fail because mock and tests still expect callback-based API.

### Solution: Async Awareness

Kaseki detects:

- **Async keywords** in task prompt: "async", "await", "promise", "callback"
- **Mock files** that need updates: `src/__mocks__/api.ts`
- **Test files** affected: `src/api.test.ts`
- **Consumer files** using the changed interfaces

Then it:

1. **Enhances the goal** with explicit criteria for mocks and tests
2. **Embeds context in TASK_PROMPT** showing which mocks/tests to update
3. **Guides the agent** with examples of what needs to change

## How It Works

### Async Keywords Detected

```
async, await, promise, callback, promisify, 
async/await, promise.*based, callback-to-promise
```

### File Patterns Detected

| Category | Patterns | Purpose |
|----------|----------|---------|
| Mock files | `**/__mocks__/**/*.ts`, `**/*.mock.ts`, `**/mocks/**/*.ts` | Fake implementations for testing |
| Test files | `**/*.test.ts`, `**/*.spec.ts`, `**/tests/**/*.ts` | Test suites |
| Interface files | `**/types/**/*.ts`, `**/*.types.ts`, `**/*.interface.ts` | Type/interface definitions |
| Consumer files | Files importing from modified module | Downstream code using the API |

### Scouting Discoveries

When async keywords are found in TASK_PROMPT, scouting runs:

```
Scouting discovers:
├─ hasAsyncChanges: true
├─ asyncKeywords: ['async', 'await', 'promise']
├─ mockFiles:
│  ├─ src/__mocks__/api.ts
│  ├─ src/mocks/http-client.mock.ts
│  └─ tests/fixtures/responses.mock.ts (3 total)
├─ testFiles:
│  ├─ src/api.test.ts
│  ├─ src/http-client.test.ts
│  └─ src/handlers/api-handler.test.ts (5 total)
├─ interfaceFiles:
│  ├─ src/types/api.types.ts
│  └─ src/services/http-service.interface.ts (2 total)
└─ consumerFiles: 14 files import these modules
```

### Goal Enhancement

The goal is automatically enhanced with:

```json
{
  "criteria": [
    {
      "criterion": "All 3 affected mock files remain type-compatible with updated async API",
      "measurement": "Mock exports have correct async/Promise signatures matching updated interfaces",
      "smart_score": "high",
      "category": "compatibility"
    },
    {
      "criterion": "All 5 affected test files properly use async/await assertions",
      "measurement": "Test assertions use 'await' where needed, async test functions use proper syntax",
      "smart_score": "high",
      "category": "test-validity"
    }
  ]
}
```

### TASK_PROMPT Enhancement

The agent receives embedded context:

```markdown
---
## Validation Context (from Scouting)

🔧 **Build System**: typescript (command: `npm run build`)
Your changes will be validated by running: `npm run build`
Ensure compilation succeeds with no errors or type mismatches.

⚠️ **Async Changes Detected**: async, await, promise

- **Mock Files to Update** (3 total):
  - `src/__mocks__/api.ts` — Fake HTTP client responses
  - `src/mocks/http-client.mock.ts` — Mock HTTP headers and methods
  - `tests/fixtures/responses.mock.ts` — Fixture responses for testing

  When updating these mocks:
  - Use the same async/Promise signatures as the updated module
  - Return promises that resolve to the expected type
  - Update any callback-based functions to async functions

- **Test Files to Update** (5 total):
  - `src/api.test.ts` — Main API tests
  - `src/http-client.test.ts` — HTTP client tests
  - `src/handlers/api-handler.test.ts` — Handler tests
  
  When updating tests:
  - Use 'await' for async function calls
  - Update assertions to handle Promise resolutions
  - Use async test functions where needed

- **Interface Files** (2 total):
  - `src/types/api.types.ts`
  - `src/services/http-service.interface.ts`

- **Consumer Files** (14 total):
  Files importing from updated modules that may need adjustments

---
```

## Example Usage

### Example 1: Converting Callbacks to Async/Await

```bash
export OPENROUTER_API_KEY="sk-or-..."
export TASK_PROMPT="Convert the HTTP client from callback-based to async/await.
Currently: fetchUser(id, (err, user) => { ... })
Target:   const user = await fetchUser(id); fetchUser(id) // throws on error"

export KASEKI_CHANGED_FILES_ALLOWLIST="src/api.ts src/__mocks__/api.ts src/api.test.ts"

./run-kaseki.sh
```

**What the agent receives:**

```
Your changes to src/api.ts will need corresponding updates to:
- Mock: src/__mocks__/api.ts (mock must have async signature)
- Tests: src/api.test.ts (tests must use await)
```

**Result:**
✅ Agent updates all three files consistently
✅ Compilation succeeds (types match)
✅ Tests pass (mock and test assertions aligned)

### Example 2: Adding Promise-Based Error Handling

```bash
export TASK_PROMPT="Add Promise-based error handling to the database layer.
Convert db.query(sql, callback) to db.query(sql): Promise<Result>"

export KASEKI_CHANGED_FILES_ALLOWLIST="src/db.ts src/__mocks__/db.ts tests/db.test.ts"

./run-kaseki.sh
```

**What happens:**

1. Scouting detects: async, promise keywords → async changes likely
2. Finds mock: `src/__mocks__/db.ts`
3. Finds tests: `tests/db.test.ts`
4. Enhances goal: "Mock file must return Promises", "Tests must use await"
5. TASK_PROMPT includes: Which files to update and why
6. Agent updates all three files with consistent Promise signatures
7. Validation passes: Types check out, tests pass

### Example 3: Large Async Refactor

```bash
export TASK_PROMPT="Migrate all fetch() calls to use async/await instead of .then() chains.
Update all call sites to use await in async functions."

export KASEKI_CHANGED_FILES_ALLOWLIST="src/services/** src/__mocks__/services/** tests/services/**"

./run-kaseki.sh
```

**Scouting discovers:**

- 8 mock files to update
- 12 test files affected
- 24 consumer files using these services
- Multiple async keywords: async, await, promise

**Goal includes:**

- All mocks must have async/await signatures
- All tests must properly await async calls
- No callback chains remain

**Agent gets detailed context** on which files need updates and what patterns to use.

## Anti-Patterns (What to Avoid)

### ❌ Mixing Callback and Async APIs

**Bad — inconsistent interfaces:**

```typescript
// src/api.ts - now async/await
export async function fetchUser(id: string): Promise<User> { ... }

// src/__mocks__/api.ts - still callbacks
export function fetchUser(id, callback) { ... }
```

**Why it fails:** Mocks don't match real API; tests fail when run against mocks.

**Good — consistent signatures:**

```typescript
// src/api.ts - async/await
export async function fetchUser(id: string): Promise<User> { ... }

// src/__mocks__/api.ts - also async/await
export async function fetchUser(id: string): Promise<User> { 
  return Promise.resolve(mockUser);
}
```

### ❌ Forgetting to Update Test Assertions

**Bad — test uses callback style but API is async:**

```typescript
it('should fetch user', (done) => {
  fetchUser('1', (err, user) => {  // ← API no longer takes callback!
    expect(user.name).toBe('John');
    done();
  });
});
```

**Good — test uses async/await:**

```typescript
it('should fetch user', async () => {
  const user = await fetchUser('1');  // ← Matches async API
  expect(user.name).toBe('John');
});
```

### ❌ Inconsistent Promise Handling

**Bad — sometimes Promise, sometimes not:**

```typescript
export function getData() {
  if (cached) return data;           // Sync return
  return fetch('/api').then(r => r.json());  // Promise return
}
```

**Good — always returns Promise:**

```typescript
export async function getData() {
  if (cached) return data;           // Still a Promise (via async)
  return fetch('/api').then(r => r.json());  // Also a Promise
}
```

## Configuration

### Fine-Tune Async Detection

```bash
# Control async sensitivity
export KASEKI_ASYNC_DETECTION_MODE="strict"    # Only very clear async keywords
export KASEKI_ASYNC_DETECTION_MODE="standard"  # Default: common patterns
export KASEKI_ASYNC_DETECTION_MODE="lenient"   # Include uncertain patterns

# Override: Say this change IS async even if keywords don't match
export KASEKI_FORCE_ASYNC_AWARENESS=true

# Override: Disable async awareness completely
export KASEKI_ASYNC_AWARENESS_ENABLED=false

./run-kaseki.sh
```

### Specify Files to Update

If scouting misses files, tell it explicitly:

```bash
export KASEKI_MOCK_FILES="src/__mocks__/api.ts src/__mocks__/db.ts"
export KASEKI_TEST_FILES="tests/**/*.test.ts"

./run-kaseki.sh
```

## Result Artifacts

All async-awareness information saved to `/agents/kaseki-results/kaseki-N/`:

### Logs

- `metadata.json` → "async-analysis": {hasAsyncChanges, keywordsDetected, mockFilesCount, testFilesCount}
- `progress.jsonl` → Scouting stage includes async discovery details
- `result-summary.md` → "Async Awareness: Detected 5 test files to update"

### Reports

- `restoration-report.md` → Shows which mock/test files were preserved/restored
- `pi-events.jsonl` → Agent's reasoning about async/mock/test updates (in thinking blocks)

### Structured Data

```json
{
  "asyncAnalysis": {
    "hasAsyncChanges": true,
    "asyncKeywords": ["async", "await", "promise"],
    "mockFilesDetected": 3,
    "mockFiles": [
      "src/__mocks__/api.ts",
      "src/mocks/http-client.mock.ts",
      "tests/fixtures/responses.mock.ts"
    ],
    "testFilesDetected": 5,
    "testFiles": [
      "src/api.test.ts",
      "src/http-client.test.ts",
      "src/handlers/api-handler.test.ts"
    ],
    "interfaceFilesDetected": 2,
    "consumerFilesDetected": 14
  }
}
```

## Troubleshooting

### Issue: Async Awareness Not Triggered

**Symptom:** Task prompt mentions "async" but scouting doesn't detect it.

**Cause:** TASK_PROMPT keyword matching is case-sensitive and phrase-based.

**Solution:**

```bash
# Verify keywords are present
echo "$TASK_PROMPT" | grep -i "async\|await\|promise"

# If not, add them explicitly to TASK_PROMPT
export TASK_PROMPT="$TASK_PROMPT. Use async/await pattern."

# Or force it on
export KASEKI_FORCE_ASYNC_AWARENESS=true
./run-kaseki.sh
```

### Issue: Mock Files Not Detected

**Symptom:** Agent doesn't update `src/__mocks__/api.ts`.

**Cause:** Your mock files don't match standard patterns.

**Solution:**

```bash
export KASEKI_MOCK_FILES="src/__mocks__/api.ts src/test-fixtures/mocks.ts"
./run-kaseki.sh
```

Or check what was detected:

```bash
cat /agents/kaseki-results/kaseki-N/result-summary.md | grep "Mock Files"
```

### Issue: Too Many Files Flagged as Async-Related

**Symptom:** Many unrelated files show up as "consumer files".

**Cause:** Scouting is generous to catch all potential files. Some may be false positives.

**Solution:**

1. Use allowlist to restrict which files agent can modify:

   ```bash
   export KASEKI_CHANGED_FILES_ALLOWLIST="src/api.ts src/__mocks__/api.ts tests/**"
   ```

2. Or disable async awareness for this run:

   ```bash
   export KASEKI_ASYNC_AWARENESS_ENABLED=false
   ```

## Best Practices

### 1. Always Include Mocks and Tests in Allowlist

When making async changes:

```bash
# Good: Includes mocks and tests
export KASEKI_CHANGED_FILES_ALLOWLIST="src/api.ts src/__mocks__/api.ts tests/api.test.ts"

# Avoid: Only source file
export KASEKI_CHANGED_FILES_ALLOWLIST="src/api.ts"
```

### 2. Be Explicit in Task Prompt

Make it clear you're doing async-related work:

```bash
# Good: Explicit about async
export TASK_PROMPT="Convert the data service from callbacks to async/await.
Update: src/data-service.ts, __mocks__/data-service.ts, tests/data-service.test.ts"

# Less clear
export TASK_PROMPT="Update the data service"
```

### 3. Review Discovered Files

Check what scouting found:

```bash
cat /agents/kaseki-results/kaseki-N/metadata.json | jq '.asyncAnalysis'
```

If files are missing, add them explicitly before the next run.

### 4. Test Locally First

Verify your async patterns work:

```bash
npm test  # Ensure tests pass with current mocks
npm run build  # Ensure types check out

# Then run kaseki
./run-kaseki.sh
```

## See Also

- [COMPILATION_VALIDATION.md](COMPILATION_VALIDATION.md) — Build validation for typed languages
- [GOAL_SETTING_IMPROVEMENTS.md](GOAL_SETTING_IMPROVEMENTS.md) — Smart goal criteria
- [QUALITY_GATES.md](QUALITY_GATES.md) — Quality gate system
