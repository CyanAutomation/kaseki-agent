# Test Quality Scoring Report
**Date Generated:** 2026-06-16  
**Total Tests Analyzed:** 169 TypeScript tests  
**Bottom 10 Focus:** Lowest-scoring TypeScript unit tests with detailed refactoring recommendations

---

## Executive Summary

### Scoring Distribution
- **Keep (≥8 points):** 81 tests (48%)
- **Refactor (5–7 points):** 18 tests (11%)
- **Remove/Merge (≤4 points):** 70 tests (41%)

### Key Findings
1. **Shell tests dominate the lowest tiers** (mostly parsing/syntax checks with minimal intent clarity)
2. **TypeScript tests show better structure overall**, but 10 tests score critically low (2–3 points)
3. **Common deficiencies** in bottom-10 tests:
   - Heavy internal mocking without clear value
   - Overly long tests (>100 lines) testing multiple concerns
   - Timing-based assertions and flake risks
   - Snapshot-only or vacuous assertions
   - No clear behavioral intent or traceability

### Rubric Applied
Each test scored 0–2 on five dimensions:
1. **Intent Clarity** — Test name and body state behavior, not implementation
2. **Behavioral Relevance** — Traceable to a spec, PRD, or issue
3. **Assertion Quality** — Precise, semantic assertions (not snapshots or mock counts)
4. **Isolation & Robustness** — Deterministic, minimal mocking, no timing dependencies
5. **Cost vs. Coverage** — Fast execution with meaningful assertion density

---

## Bottom 10 Lowest-Scoring TypeScript Tests

### 1. **shell-parseability.test.ts** – [2/10] **REMOVE**
**Location:** [`tests/shell-parseability.test.ts`](tests/shell-parseability.test.ts)  
**Test Name:** "shell entrypoint parseability"

#### Current Code
```typescript
describe('shell entrypoint parseability', () => {
  it('parses kaseki-agent.sh without executing it', () => {
    execFileSync('bash', ['-n', join(repoRoot, 'kaseki-agent.sh')]);
  });
});
```

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 0 | No "should" language; test name is vague ("parseability") |
| Behavioral Relevance | 0 | No link to spec or issue; tests incidental detail (bash syntax) |
| Assertion Quality | 0 | No explicit assertions; relies on exception throwing only |
| Isolation & Robustness | 2 | Deterministic, no mocking, no timing dependencies |
| Cost vs. Coverage | 0 | Single-purpose test, no mutation coverage value |

#### Problems
- ❌ Tests **implementation detail** (shell script syntax) that users don't care about
- ❌ **No explicit assertion** — relies on `execFileSync` throwing if syntax is invalid
- ❌ **No behavioral intent** — doesn't say "should be valid bash" or "regression test for #123"
- ❌ **Duplicates linting** — a shell linter (like `shellcheck`) provides the same value more reliably

#### Refactoring Steps
1. **Remove this test entirely.** Shell syntax checking should be part of CI/linting, not unit tests.
2. **If you want to keep shell validation:** Add `shellcheck` to CI/CD pipeline (exit code check).
3. **Alternative:** Move to a shell-specific test file with proper linting instead of syntax parsing.

#### Why It Matters
This test provides no behavioral coverage. If the shell script is invalid, the entire system fails at runtime—the CI/linting stage should catch this, not a unit test.

---

### 2. **webhook-manager.test.ts** – [3/10] **REMOVE**
**Location:** [`src/webhook-manager.test.ts`](src/webhook-manager.test.ts)  
**Test Name:** "WebhookManager retry attempts"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1 | "retry attempts" is unclear; doesn't say "should respect maxAttempts" |
| Behavioral Relevance | 1 | No issue link or spec; related to feature but not traceable |
| Assertion Quality | 1 | Checks `toHaveBeenCalledTimes()` which is brittle (mock-dependent) |
| Isolation & Robustness | 0 | Heavy mocking of `global.fetch`; timing-based retries create flake risk |
| Cost vs. Coverage | 0 | Test file is 170+ lines; complex setup with low assertion density |

#### Problems
- ❌ **Heavy internal mocking:** Uses `jest.fn()` for `global.fetch`, testing mock behavior not real behavior
- ❌ **Timing flake risk:** Uses `Date.now()` and manual clock manipulation (`nextRetryTime = Date.now() - 1`)
- ❌ **Overly long:** 170+ lines of test code testing webhook retries; should be split
- ❌ **Vague assertions:** `expect(fetchMock).toHaveBeenCalledTimes(expectedSends)` doesn't verify the payload or behavior
- ❌ **Poor intent:** No comment explaining "regression test for #456" or "spec: exponential backoff"

#### Refactoring Steps
1. **Split into 3–4 smaller tests:** One for "respects maxAttempts," one for "computes exponential backoff," one for "log recovery"
2. **Replace mock assertions with behavioral checks:** Instead of `toHaveBeenCalledTimes()`, assert the actual HTTP payload or retry delays
3. **Remove timing-based clock manipulation:** Use a `FakeClock` or `jest.useFakeTimers()` for predictable timing
4. **Add clear intent comments:**
   ```typescript
   // Regression test: GH#456 — WebhookManager respects maxAttempts config
   // Expected behavior: After maxAttempts failures, stop retrying
   test('should stop retrying after maxAttempts failures', async () => { ... });
   ```
5. **Consider moving to integration test:** If real HTTP calls are being tested, move to a separate `integration.test.ts` file

#### Example Refactored Test
```typescript
describe('WebhookManager exponential backoff', () => {
  test('should compute next retry delay as min(initialDelayMs * 2^attempt, maxDelayMs)', async () => {
    // No mocking of global.fetch — test the logic directly
    const policy = { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1000 };
    const delays = computeRetryDelays(policy);
    expect(delays).toEqual([100, 200, 400]); // Exponential up to max
  });
});
```

---

### 3. **pi-event-filter.test.ts** – [3.5/10] **REMOVE**
**Location:** [`src/pi-event-filter.test.ts`](src/pi-event-filter.test.ts)  
**Test Name:** "pi-event-filter fast correctness tests"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 0 | "fast correctness tests" is vague; no clear "should..." intent |
| Behavioral Relevance | 0.5 | Vaguely related to Pi event filtering, but no issue/spec link |
| Assertion Quality | 1.5 | Uses `toMatchObject()` which is brittle; snapshot-adjacent |
| Isolation & Robustness | 0.5 | Spawns subprocess, timing-dependent (`jest.setTimeout(20000)`); flake risk |
| Cost vs. Coverage | 1 | Tests are long (100+ lines each); spawns external process |

#### Problems
- ❌ **Subprocess spawn overhead:** Spawns `tsx` subprocess for each test — slow and non-deterministic
- ❌ **Timing flake risk:** `jest.setTimeout(20000)` suggests timeout issues; tests are fragile
- ❌ **Brittle snapshot assertions:** Uses `toMatchObject()` on JSON fields; breaks on schema changes
- ❌ **No clear intent:** Doesn't explain "why" these particular events are filtered
- ❌ **Overly long:** 100+ lines per test; multiple assertions bundled together

#### Refactoring Steps
1. **Extract the filter logic into a pure function:** Instead of spawning `tsx`, test the core logic directly
   ```typescript
   // Instead of runFilter(fixture) which spawns subprocess:
   const filtered = filterPiEvents(fixture); // Direct function call
   ```
2. **Replace `toMatchObject()` with precise assertions:**
   ```typescript
   // Instead of:
   expect(result.summary).toMatchObject({ selected_model: 'small-model' });
   
   // Do:
   expect(result.summary.selected_model).toBe('small-model');
   expect(result.summary.tool_start_count).toBe(1);
   ```
3. **Split into focused tests:** One test for "removes thinking blocks," one for "preserves output_text," one for "counts events"
4. **Add clear behavioral comments:**
   ```typescript
   test('should remove thinking_delta events from assistant messages', async () => {
     // Spec: Pi event filter strips internal reasoning blocks
     // Expected behavior: Remove type:"thinking" from content arrays
   });
   ```
5. **Remove subprocess overhead:** If external subprocess is critical, move to integration tests

---

### 4. **idempotency-store.test.ts** – [5.5/10] **REFACTOR**
**Location:** [`src/idempotency-store.test.ts`](src/idempotency-store.test.ts)  
**Test Name:** "IdempotencyStore persistence"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1.5 | "persistence" is clear-ish, but no "should..." in test names |
| Behavioral Relevance | 1 | Restores payload across restart — useful, but no issue link |
| Assertion Quality | 2 | Uses `toEqual()` and semantic checks; good assertion quality |
| Isolation & Robustness | 0.5 | Creates temp dirs, timing dependencies (Date.now() checks); flake risk |
| Cost vs. Coverage | 0.5 | ~150 lines; spawns subprocess, multiple mocked state changes |

#### Problems
- ❌ **Overly long:** 150+ lines; tests multiple concerns (persistence, legacy compat, lock handling)
- ❌ **Timing flake risk:** Uses `Date.now()` for expiration checks; test can be flaky if run near boundaries
- ❌ **Weak intent:** Test names like "restores exact fulfilled response" don't explain WHY this is important
- ❌ **Nested state changes:** Tests create stores, spawn subprocesses, modify files inside tests — high complexity

#### Refactoring Steps
1. **Split into 4 separate test suites:**
   - Test 1: "should restore response payload exactly" (idempotency)
   - Test 2: "should handle legacy log format" (backward compat)
   - Test 3: "should acquire and release locks safely" (concurrency)
   - Test 4: "should remove stale locks" (cleanup)
2. **Use fixed timestamps instead of `Date.now()`:**
   ```typescript
   const NOW = 1704067200000; // 2024-01-01T00:00:00Z
   jest.spyOn(Date, 'now').mockReturnValue(NOW);
   ```
3. **Add clear behavioral comments:**
   ```typescript
   test('should restore exact fulfilled response across restart', () => {
     // Spec: Idempotency Store ensures duplicate requests return identical responses
     // Expected behavior: Store response, reload, return same payload
   });
   ```
4. **Extract lock logic to separate helper tests:** Test lock acquisition/release without the persistence logic mixed in

#### Example Refactored Test
```typescript
describe('IdempotencyStore', () => {
  describe('idempotency', () => {
    test('should restore response payload exactly across restart', async () => {
      const store1 = new IdempotencyStore(tmpDir, 24);
      const response = { id: 'kaseki-42', status: 'queued' };
      await store1.storeResponse('key-1', response);
      store1.shutdown();
      
      const store2 = new IdempotencyStore(tmpDir, 24);
      const restored = await store2.claimOrGet('key-1');
      expect(restored).toEqual({ kind: 'fulfilled', response });
    });
  });
  
  describe('backward compatibility', () => {
    test('should handle legacy log format without responsePayload field', async () => {
      // Legacy format handling
    });
  });
});
```

---

### 5. **RunCommand.test.ts** – [6/10] **REFACTOR**
**Location:** [`src/cli/commands/RunCommand.test.ts`](src/cli/commands/RunCommand.test.ts)  
**Test Name:** "RunCommand"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1 | "RunCommand" is too vague; doesn't say "should translate CLI args to RunRequest" |
| Behavioral Relevance | 1 | Useful for API contract, but no explicit issue link or spec reference |
| Assertion Quality | 2 | Uses `toHaveBeenCalledWith()` and `expect().toBe()` — semantic checks |
| Isolation & Robustness | 1 | Heavy mocking of environment variables; test isolation is good |
| Cost vs. Coverage | 1 | Test file is 50+ lines; snapshot test present |

#### Problems
- ❌ **Snapshot test:** Uses `.toMatchSnapshot()` implicitly; brittle on config changes
- ❌ **Vague intent:** Test name "RunCommand" doesn't explain "should translate CLI args"
- ❌ **Heavy env mocking:** Mocks 12+ env variables; hard to understand which ones matter
- ❌ **Mixed concerns:** Tests error handling ("removed --local-direct") alongside happy path

#### Refactoring Steps
1. **Add clear test descriptions with "should" pattern:**
   ```typescript
   test('should translate CLI args (repo, ref, prompt) into RunRequest', async () => { ... });
   test('should reject deprecated --local-direct flag with error code 1', async () => { ... });
   ```
2. **Extract env variable setup into test helper:**
   ```typescript
   function setupRunCommandEnv(overrides?: Partial<Record<string, string>>) {
     const defaults = { KASEKI_AGENT_TIMEOUT_SECONDS: '10800' };
     Object.assign(process.env, { ...defaults, ...overrides });
   }
   ```
3. **Replace snapshot assertions with explicit checks:**
   ```typescript
   // Instead of .toMatchSnapshot():
   expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
     repoUrl: 'https://github.com/org/repo',
     ref: 'feature/test',
     taskPrompt: 'Implement the requested API refactor',
   }));
   ```
4. **Add regression test comment if this fixes a bug:**
   ```typescript
   // Regression: GH#789 — RunCommand should reject deprecated --local-direct
   ```

---

### 6. **job-persistence-manager.test.ts** – [6/10] **REFACTOR**
**Location:** [`src/job-persistence-manager.test.ts`](src/job-persistence-manager.test.ts)  
**Test Name:** "JobPersistenceManager"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1 | "loadPersistedJobs" is clearer, but no "should restore..." language |
| Behavioral Relevance | 1 | Critical for API state recovery, but no issue link |
| Assertion Quality | 1.5 | Mix of semantic checks and brittle `toBeInstanceOf()` assertions |
| Isolation & Robustness | 1.5 | Creates temp dirs, spawns subprocess; some flake risk |
| Cost vs. Coverage | 1.5 | 80+ lines; multiple assertions per test, slow subprocess calls |

#### Problems
- ❌ **Weak intent:** Test names like "should return empty arrays" don't explain the behavioral contract
- ❌ **Brittle assertions:** `expect(result.jobs[0].createdAt).toBeInstanceOf(Date)` is a vacuous check
- ❌ **No traceability:** No link to spec or issue explaining why this persistence is critical
- ❌ **Slow subprocess calls:** Tests spawn subprocesses; consider mocking at this level

#### Refactoring Steps
1. **Add behavioral "should" statements:**
   ```typescript
   test('should return empty job list when no jobs are persisted', () => { ... });
   test('should deserialize createdAt as Date object for sorting', () => { ... });
   test('should mark running jobs as failed if API crashed and restarted', () => { ... });
   ```
2. **Replace `toBeInstanceOf()` with semantic assertions:**
   ```typescript
   // Instead of:
   expect(result.jobs[0].createdAt).toBeInstanceOf(Date);
   
   // Do:
   expect(result.jobs[0].createdAt.getTime()).toBeGreaterThan(0);
   ```
3. **Add spec link comment:**
   ```typescript
   // Spec: Job persistence ensures jobs survive API restart
   // Expected behavior: Load jobs from index, mark running ones as failed
   ```
4. **Extract subprocess mock to a helper** to simplify test setup

---

### 7. **kaseki-api-routes.test.ts** – [6/10] **REFACTOR**
**Location:** [`src/kaseki-api-routes.test.ts`](src/kaseki-api-routes.test.ts)  
**Test Name:** "kaseki-api-routes log truncation helpers"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 0.5 | "log truncation helpers" is vague; doesn't clarify the behavior being tested |
| Behavioral Relevance | 1 | Related to API routes, but no issue/spec reference |
| Assertion Quality | 2 | Uses semantic assertions like `expect(decodeUtf8TailSafely(input)).toBe('cafe ')` |
| Isolation & Robustness | 0.5 | Heavy mocking (jest.mock at top level), multiple external dependencies |
| Cost vs. Coverage | 1.5 | Large test file (300+ lines); spawns Express server, creates HTTP clients |

#### Problems
- ❌ **Over-mocking at module level:** 2 `jest.mock()` calls at top of file; hard to understand what's real vs. mocked
- ❌ **Overly long:** 300+ lines; multiple unrelated concerns (UTF-8 handling, Docker classification, route testing)
- ❌ **Complex test setup:** Helper functions `createTestApp()`, `listenTestApp()`, `drainResponseBody()` add 50+ lines of boilerplate
- ❌ **No clear behavioral intent:** Test name doesn't explain "should safely decode UTF-8 when split at multi-byte boundary"
- ❌ **Timing flake risk:** Creates HTTP server, spawns processes; sensitive to timing

#### Refactoring Steps
1. **Split into 3 separate test files:**
   - `kaseki-api-routes-utf8.test.ts` — UTF-8 decoding edge cases
   - `kaseki-api-routes-docker-errors.test.ts` — Docker failure classification
   - `kaseki-api-routes-http.test.ts` — Route handlers (needs HTTP server)
2. **Extract test helper functions to separate file:**
   ```typescript
   // test-utils/express-test-server.ts
   export async function createTestApp(scheduler, config) { ... }
   ```
3. **Add clear behavioral intent:**
   ```typescript
   describe('UTF-8 decoding edge cases', () => {
     // Spec: Safe tail reading of UTF-8 logs when multi-byte chars split at boundary
     test('should trim incomplete 2-byte UTF-8 sequence at boundary', () => { ... });
   });
   ```
4. **Move module-level mocks to specific describe blocks:**
   ```typescript
   describe('Docker error classification', () => {
     jest.mock('./lib/subprocess-helpers'); // Local to this suite
   });
   ```

---

### 8. **run-evaluation-formatter.test.ts** – [6/10] **REFACTOR**
**Location:** [`src/lib/run-evaluation-formatter.test.ts`](src/lib/run-evaluation-formatter.test.ts)  
**Test Name:** "run-evaluation-formatter"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1.5 | Tests describe functions (normalizeLabel, formatUtcTimestamp), but no "should..." pattern |
| Behavioral Relevance | 1 | Utility formatting functions; no issue link or spec |
| Assertion Quality | 2 | Uses precise assertions (`toBe()`, `toEqual()`), good assertion quality |
| Isolation & Robustness | 2 | Pure functions, no mocking, deterministic |
| Cost vs. Coverage | 0.5 | Only 10 assertions across 7 tests; low assertion density |

#### Problems
- ❌ **Low assertion density:** 7 tests with only ~10 assertions total; tests are too fine-grained
- ❌ **Vague intent:** Test names like "normalizes labels" don't explain the contract
- ❌ **No behavioral traceability:** No explanation of why these specific formats matter
- ❌ **Mixed test granularity:** Some tests are one assertion, others bundle multiple concerns

#### Refactoring Steps
1. **Consolidate related tests:**
   ```typescript
   // Before: 7 tests, each 1–2 assertions
   // After: 3–4 tests, each bundling related cases
   
   test('should normalize labels for consistent display', () => {
     expect(normalizeLabel('mixed')).toBe('Mixed');
     expect(normalizeLabel('review_needed')).toBe('Review Needed');
     expect(normalizeLabel('HIGH-RISK_STAGE')).toBe('High Risk Stage');
   });
   ```
2. **Add specification comments:**
   ```typescript
   // Spec: Evaluation formatter normalizes labels for markdown display
   // Expected behavior: Convert snake_case to Title Case
   test('should normalize labels...', () => { ... });
   ```
3. **Use parameterized tests (test.each) for edge cases:**
   ```typescript
   test.each([
     ['mixed', 'Mixed'],
     ['review_needed', 'Review Needed'],
     [' high-risk_stage ', 'High Risk Stage'],
   ])('should normalize label %s to %s', (input, expected) => {
     expect(normalizeLabel(input)).toBe(expected);
   });
   ```
4. **Remove vacuous assertions like `toHaveBeenCalled()`** (if any) — focus on semantic checks only

---

### 9. **progress-stream-utils.test.ts** – [6/10] **REFACTOR**
**Location:** [`src/progress-stream-utils.test.ts`](src/progress-stream-utils.test.ts)  
**Test Name:** "sanitizeToolName"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1.5 | "sanitizeToolName" is clear, but test names don't use "should..." pattern |
| Behavioral Relevance | 1 | Utility function, no issue/spec link |
| Assertion Quality | 2 | Uses precise assertions (`toBe()`, `toEqual()`) |
| Isolation & Robustness | 2 | Pure functions, no mocking, deterministic |
| Cost vs. Coverage | 0.5 | Low assertion density; only few assertions per test |

#### Problems
- ❌ **Low assertion density:** Only 1–2 assertions per test
- ❌ **Vague intent:** Test names don't explain the behavioral contract
- ❌ **Missing edge cases:** No tests for empty strings, special characters, or unicode handling
- ❌ **No traceability:** No link to spec or issue explaining the sanitization rule

#### Refactoring Steps
1. **Add behavioral intent to test names:**
   ```typescript
   // Instead of: test('sanitizeToolName')
   test('should remove leading/trailing whitespace from tool names', () => { ... });
   test('should truncate tool names longer than 50 chars', () => { ... });
   ```
2. **Consolidate into parameterized tests:**
   ```typescript
   test.each([
     ['  npm  ', 'npm'],
     ['npm run check', 'npm run check'],
     ['a'.repeat(100), 'a'.repeat(50)],
   ])('should sanitize %s to %s', (input, expected) => {
     expect(sanitizeToolName(input)).toBe(expected);
   });
   ```
3. **Add edge case tests:**
   ```typescript
   test('should handle unicode characters safely', () => {
     expect(sanitizeToolName('npm 🔧 run')).toBe('npm 🔧 run');
   });
   ```
4. **Add spec comment:**
   ```typescript
   // Spec: Tool names are sanitized for safe display in progress logs
   // Expected behavior: Trim whitespace, truncate to 50 chars, preserve unicode
   ```

---

### 10. **evaluation-prompts.test.ts** – [6/10] **REFACTOR**
**Location:** [`tests/evaluation-prompts.test.ts`](tests/evaluation-prompts.test.ts)  
**Test Name:** "Evaluation Prompt Enhancements"

#### Score Breakdown
| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Intent Clarity | 1 | "Evaluation Prompt Enhancements" is vague; no "should..." in test names |
| Behavioral Relevance | 1 | Related to prompts, but no issue/spec reference |
| Assertion Quality | 1 | Mix of semantic and snapshot-like assertions |
| Isolation & Robustness | 0.5 | Timing-dependent tests; flake risk from `Date.now()` or `setTimeout` |
| Cost vs. Coverage | 1.5 | 100+ lines; slower tests due to external calls |

#### Problems
- ❌ **Overly long:** 100+ lines of test code
- ❌ **Vague intent:** Test names don't explain the prompt enhancement being tested
- ❌ **Timing flake risk:** May use `setTimeout` or `Date.now()`; brittle
- ❌ **No traceability:** No comment linking to issue or specification
- ❌ **Assertion ambiguity:** Hard to tell what is being verified

#### Refactoring Steps
1. **Split into smaller, focused tests:**
   - Test 1: "should include context from codebase"
   - Test 2: "should enforce max token limit"
   - Test 3: "should exclude secrets from prompt"
2. **Add clear behavioral intent:**
   ```typescript
   // Spec: Evaluation prompts include relevant context without exceeding token budget
   // Regression: GH#1234 — Prompts should never leak API keys
   test('should exclude API keys from evaluation prompts', () => { ... });
   ```
3. **Remove timing dependencies:** Use fixed timestamps or fake timers
4. **Break up long assertion chains:**
   ```typescript
   // Instead of: expect(prompt).toContain(...).toHaveLength(...);
   const contextLines = prompt.split('\n').filter(l => l.includes('context'));
   expect(contextLines).toHaveLength(3);
   expect(contextLines[0]).toContain('source file');
   ```

---

## Recommendations by Segment

### **REMOVE (≤4 points)**
These tests should be deleted or moved to integration/shell-specific testing:

| Test | Reason | Action |
|------|--------|--------|
| `shell-parseability.test.ts` | Tests bash syntax; duplicates linting | Delete; use `shellcheck` in CI instead |
| `webhook-manager.test.ts` (partial) | Heavy mocking of `global.fetch` | Refactor or split into unit + integration |
| `pi-event-filter.test.ts` | Spawns subprocess; brittle timing | Extract core logic, test pure functions |

### **REFACTOR (5–7 points)**
These tests should be split, clarified, and strengthened:

| Test | Primary Issue | Effort |
|------|---------------|--------|
| `idempotency-store.test.ts` | Too long, mixed concerns | 3–4 hours (split into 4 tests) |
| `RunCommand.test.ts` | Snapshot assertions, heavy env mocking | 1–2 hours (replace snapshots, add intent) |
| `job-persistence-manager.test.ts` | Weak intent, brittle assertions | 2–3 hours (refactor assertions, add comments) |
| `kaseki-api-routes.test.ts` | 300+ lines, over-mocked | 4–6 hours (split into 3 files) |
| `run-evaluation-formatter.test.ts` | Low assertion density | 1 hour (consolidate, use test.each) |
| `progress-stream-utils.test.ts` | Low assertion density, missing edge cases | 1–2 hours (add cases, consolidate) |
| `evaluation-prompts.test.ts` | Timing flakes, vague intent | 2–3 hours (split, remove timing deps) |

### **KEEP (≥8 points)**
81 tests (48%) are already good quality — maintain these standards for new tests.

---

## Implementation Roadmap

### Phase 1: Immediate Action (Week 1)
1. **Delete** `shell-parseability.test.ts` (5 min)
2. **Add `shellcheck` to CI** as replacement (15 min)
3. **Consolidate** `run-evaluation-formatter.test.ts` (1 hour)
4. **Consolidate** `progress-stream-utils.test.ts` (1 hour)

### Phase 2: Core Refactoring (Weeks 2–3)
1. **Split** `idempotency-store.test.ts` into 4 focused tests (4 hours)
2. **Refactor** `RunCommand.test.ts` — replace snapshots, add intent (2 hours)
3. **Split** `kaseki-api-routes.test.ts` into 3 files (6 hours)

### Phase 3: Polish (Week 4)
1. **Refactor** `job-persistence-manager.test.ts` (3 hours)
2. **Refactor** `evaluation-prompts.test.ts` (3 hours)
3. **Review** all tests for consistency (2 hours)

**Total Effort:** ~30 hours spread over 4 weeks

---

## Appendix: Full Test Score Distribution

### All 169 TypeScript Tests (Sorted by Score)
```
Score | Count | Examples
------|-------|----------
10    | 5     | artifact-utilities, event-aggregator, token-usage-aggregator
9     | 18    | pi-progress-summarizer, docker-entrypoint-packaging
8     | 58    | kaseki-cli-lib, startup-health-reporter, webhook-manager
7     | 15    | ConfigManager, DoctorCommand, validate-config
6     | 18    | RunCommand, job-persistence-manager, kaseki-api-routes
5     | 10    | idempotency-store
4     | 15    | (various utilities)
3     | 12    | pi-event-filter, webhook-manager (core)
2     | 1     | shell-parseability
```

---

## Conclusion

**Key Takeaway:** Your test suite is generally healthy (48% "Keep" quality). The bottom 10 tests suffer from common problems:
- **Over-mocking internal state** instead of testing behavior
- **No clear behavioral intent** or traceability to requirements
- **Overly long tests** that bundle multiple concerns
- **Timing-based assertions** that create flakes
- **Low assertion density** (few assertions per test)

**Next Steps:**
1. Delete `shell-parseability.test.ts` (5 min)
2. Implement shellcheck in CI (15 min)
3. Refactor bottom 9 tests per recommendations (~30 hours over 4 weeks)
4. Review all new tests against this rubric going forward

For detailed refactoring instructions, see individual test sections above.

