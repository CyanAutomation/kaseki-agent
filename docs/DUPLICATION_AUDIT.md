# Code Duplication Audit

**Generated**: May 2026  
**Purpose**: Identify and track high-value duplication elimination opportunities  
**Status**: Discovery phase — Ready for Phase 3 implementation

---

## Executive Summary

Fallow report identified **80 clone groups** across the codebase. This audit focuses on the **top 3 high-ROI duplication targets** that drive complexity and testing burden.

| Clone Group | Files | Pattern | Est. LOC Saving | Priority |
|---|---|---|---|---|
| **Timestamp Extraction** | 3 | Extract logic into shared utility | 200–300 | 1 (High) |
| **Process Spawning** | 3 | Consolidate subprocess handling | 150–200 | 1 (High) |
| **Mock Setup** | 5+ | Factory consolidation | 100–150 | 2 (Medium) |

**Recommendation**: Implement Groups 1–2 in Phase 3 (dedicate ~3–4 days). Group 3 opportunistic during refactoring.

---

## Clone Group #1: Timestamp Extraction Logic

### Files Affected
- [src/pi-event-filter.ts](../src/pi-event-filter.ts#L150) (extracting `timestamp` from multiple paths)
- [src/kaseki-report.ts](../src/kaseki-report.ts#L200) (normalizing timestamps for report headers)
- [src/progress-stream-utils.ts](../src/progress-stream-utils.ts#L45) (parsing timestamp formats)

### Pattern
Each file independently extracts or normalizes timestamps using similar logic:
```typescript
// pi-event-filter.ts
const timestamp = event.timestamp ?? event.message?.timestamp ?? event.assistantMessageEvent?.partial?.timestamp;

// kaseki-report.ts
const ts = event.createdAt || event.timestamp || new Date().toISOString();

// progress-stream-utils.ts
const normalized = timestamp ? new Date(timestamp).toISOString() : undefined;
```

### Problem
- **Duplication**: ~80–100 LOC across 3 files with different extraction strategies
- **Inconsistency**: No shared contract for timestamp formats or extraction order
- **Fragility**: Changes to event schemas require updates in 3+ places
- **Testing**: Each file tests timestamp extraction independently

### Solution
**Extract `src/lib/timestamp-utils.ts`** (new utility module):

```typescript
/**
 * Unified timestamp extraction and normalization utilities.
 * Consolidates timestamp handling across pi-event-filter, kaseki-report, progress-stream.
 */

/**
 * Extract timestamp from various event structures with fallback chain.
 * Tries in order: direct timestamp, message.timestamp, assistantMessageEvent path, fallback to current time.
 */
export function extractEventTimestamp(event: Record<string, unknown>): Date;

/**
 * Normalize timestamp to ISO 8601 string.
 */
export function normalizeTimestamp(ts: string | Date | undefined): string | undefined;

/**
 * Safe ISO string extraction with format validation.
 */
export function getTimestampISO(event: Record<string, unknown>): string;
```

### Migration Path
1. **Create utility** ([src/lib/timestamp-utils.ts](../src/lib/timestamp-utils.ts)) with 3 exported functions
2. **Refactor [pi-event-filter.ts](../src/pi-event-filter.ts)**: Replace inline extraction with `extractEventTimestamp()`
3. **Refactor [kaseki-report.ts](../src/kaseki-report.ts)**: Use `getTimestampISO()` for report headers
4. **Refactor [progress-stream-utils.ts](../src/progress-stream-utils.ts)**: Use `normalizeTimestamp()` for normalization
5. **Add tests**: [src/lib/timestamp-utils.test.ts](../src/lib/timestamp-utils.test.ts) with 15+ test cases
   - Null/undefined handling
   - Multiple event structure variants
   - Format validation
   - Fallback chain verification

### Verification
```bash
# After refactoring:
npm run test -- src/lib/timestamp-utils.test.ts
npm run test -- src/pi-event-filter.test.ts src/kaseki-report.test.ts src/progress-stream-utils.test.ts
npm run lint:unused  # Should have 0 unused imports in refactored files
```

### Estimated Effort
- Create utility: 1–2 hours
- Refactor 3 files: 2–3 hours
- Test coverage: 1–2 hours
- **Total**: ~1 day

---

## Clone Group #2: Process Spawning / Subprocess Orchestration

### Files Affected
- [src/job-scheduler.ts](../src/job-scheduler.ts#L300) (spins up kaseki-agent.sh, manages lifecycle)
- [src/kaseki-api-routes.ts](../src/kaseki-api-routes.ts#L180) (Docker image fingerprinting via shell exec)
- [src/file-helpers.ts](../src/file-helpers.ts#L120) (spawning git, validation commands)

### Pattern
Each file independently handles subprocess creation, output capture, and error handling:

```typescript
// job-scheduler.ts
const proc = spawn('bash', ['-c', command], { stdio: ['pipe', 'pipe', 'pipe'] });
proc.on('exit', (code) => { /* cleanup */ });
proc.on('error', (err) => { /* error handling */ });

// kaseki-api-routes.ts
execSync(`docker image inspect ${imageName} --format='{{.Id}}'`, { encoding: 'utf-8' });

// file-helpers.ts
const result = await new Promise<string>((resolve, reject) => {
  const proc = spawn('git', ['show', `HEAD:${file}`]);
  // custom output handling
});
```

### Problem
- **Duplication**: ~150–200 LOC with different error handling patterns
- **Inconsistency**: No shared timeout strategy, no unified logging/tracing
- **Fragility**: Signal handling, zombie process cleanup inconsistent
- **Testing**: Hard to mock; each file re-invents test fixtures

### Solution
**Extract `src/lib/process-executor.ts`** (new executor abstraction):

```typescript
/**
 * Unified subprocess execution with timeout, logging, and error handling.
 * Consolidates process spawning across job-scheduler, api-routes, file-helpers.
 */

interface ProcessOptions {
  timeout?: number;           // ms
  maxOutput?: number;         // bytes
  stdio?: StdioOptions;
  encoding?: 'utf-8' | 'buffer';
  signal?: AbortSignal;
  onOutput?: (chunk: Buffer) => void;  // live progress
}

interface ProcessResult {
  code: number;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
  duration: number;  // ms
  timedOut: boolean;
}

/**
 * Execute command with standardized timeout, output capture, and error handling.
 */
export function executeProcess(
  command: string[],
  options?: ProcessOptions
): Promise<ProcessResult>;

/**
 * Execute shell command (convenience wrapper).
 */
export function executeShell(
  command: string,
  options?: ProcessOptions
): Promise<ProcessResult>;
```

### Migration Path
1. **Create executor**: [src/lib/process-executor.ts](../src/lib/process-executor.ts) with shared patterns
2. **Refactor [job-scheduler.ts](../src/job-scheduler.ts)**: Use `executeProcess()` for kaseki-agent.sh invocation
3. **Refactor [kaseki-api-routes.ts](../src/kaseki-api-routes.ts)**: Use `executeShell()` for Docker queries
4. **Refactor [file-helpers.ts](../src/file-helpers.ts)**: Use `executeProcess()` for git/validation commands
5. **Add tests**: [src/lib/process-executor.test.ts](../src/lib/process-executor.test.ts)
   - Timeout handling
   - Signal propagation
   - Output capture
   - Error conditions

### Verification
```bash
# After refactoring:
npm run test -- src/lib/process-executor.test.ts
npm run test -- src/job-scheduler.test.ts src/kaseki-api-routes.test.ts
npm run lint:unused
```

### Estimated Effort
- Create executor: 2–3 hours
- Refactor 3 files: 3–4 hours
- Test coverage: 2–3 hours
- **Total**: ~2 days

---

## Clone Group #3: Mock Setup / Test Factories

### Files Affected
- [src/kaseki-api-routes.test.ts](../src/kaseki-api-routes.test.ts#L10) (createMockScheduler, createMockConfig)
- [src/job-scheduler.test.ts](../src/job-scheduler.test.ts#L15) (similar fixtures)
- [src/kaseki-api-service.test.ts](../src/kaseki-api-service.test.ts#L8) (config/scheduler mocks)
- [src/*.test.ts](../src/) (individual test files)

### Pattern
Each test file independently builds mocks:

```typescript
// kaseki-api-routes.test.ts
function createMockScheduler(): JobScheduler {
  return {
    enqueue: jest.fn(),
    getStatus: jest.fn(),
    listRuns: jest.fn(),
    // ... 10+ methods
  };
}

// job-scheduler.test.ts — same pattern
function createSchedulerMock(): JobScheduler {
  return { /* identical implementation */ };
}
```

### Problem
- **Duplication**: ~100–150 LOC of factory/mock functions across 5+ test files
- **Inconsistency**: Mock implementations diverge (different default values, behaviors)
- **Fragility**: Changing scheduler interface requires updates in multiple test files
- **Maintenance**: Hard to keep test doubles in sync with evolving interfaces

### Solution
**Consolidate into [src/test-utils.ts](../src/test-utils.ts)** (expand existing module):

```typescript
/**
 * Centralized test utilities, factories, and mock builders.
 * Prevents duplication across test files and ensures mock consistency.
 */

export function createMockScheduler(overrides?: Partial<JobScheduler>): JobScheduler;
export function createMockConfig(overrides?: Partial<KasekiConfig>): KasekiConfig;
export function createMockRequest(overrides?: Partial<RunRequest>): RunRequest;
export function createTestExpress(): Express.Application;
export function createMockIdempotencyStore(): IdempotencyStore;
```

### Migration Path
1. **Expand [src/test-utils.ts](../src/test-utils.ts)** with consolidated factories
2. **Refactor [kaseki-api-routes.test.ts](../src/kaseki-api-routes.test.ts)**: Import and use `createMockScheduler()`, remove local factory
3. **Refactor [job-scheduler.test.ts](../src/job-scheduler.test.ts)**: Same as above
4. **Refactor other test files**: Replace inline mocks with imported factories
5. **Document patterns**: Add JSDoc to test-utils explaining mock philosophy

### Verification
```bash
# After refactoring:
npm run test  # All tests should pass with new factories
npm run lint:unused  # Local mock factories should be unused (can remove)
```

### Estimated Effort
- Audit and consolidate: 2–3 hours
- Refactor test files: 3–4 hours
- Update docs: 1 hour
- **Total**: ~1.5 days

---

## Implementation Timeline

### Phase 3, Week 1: Timestamp Extraction
- **Day 1**: Create [src/lib/timestamp-utils.ts](../src/lib/timestamp-utils.ts) + tests
- **Day 1–2**: Refactor 3 source files
- **Verification**: All tests pass, 0 unused imports

### Phase 3, Week 2: Process Execution
- **Day 3–4**: Create [src/lib/process-executor.ts](../src/lib/process-executor.ts) + tests
- **Day 4–5**: Refactor 3 source files
- **Verification**: All tests pass, stress test timeout handling

### Phase 3, Week 3: Mock Consolidation (Opportunistic)
- **Day 6–7**: Audit and consolidate test-utils
- **Refactoring**: Stagger across regular test fixes
- **Verification**: No regression in test coverage

---

## Monitoring & Future Work

### Metrics to Track
- **Clone Group Count**: Target ≤65 (currently 80) by end of Phase 3
- **Unused Exports**: Target 0 violations in `npm run lint:unused`
- **Test Stability**: Ensure no flaky tests post-consolidation

### Future Opportunities
1. **CLI validation duplication** ([kaseki-cli.ts](../src/kaseki-cli.ts), [kaseki-cli-lib.ts](../src/kaseki-cli-lib.ts)) — ~50–80 LOC saving
2. **Error response builders** ([status-response-builder.ts](../src/utils/status-response-builder.ts), artifact routes) — ~40–60 LOC saving
3. **Config schema duplication** (Zod validators) — Phase 4 candidate

---

## References

- [Fallow Report](../README.md) — Complete health metrics (maintained in CI)
- [Phase 2 Completion](./PHASE1_COMPLETION.md) — Refactoring progress tracking
- [ESLint Configuration](../.eslintrc.json) — unused-imports plugin settings
