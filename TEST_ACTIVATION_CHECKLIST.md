# Test Activation Checklist — Feature 3 Implementation

## Purpose

Convert TDD placeholder tests (currently `expect(true).toBe(true)`) into real test implementations that validate the Feature 3 infrastructure.

## Status

- **60+ tests written** (4 main test files + 1 integration)
- **Current state**: Placeholder structure with clear expectations documented in comments
- **Next action**: Replace placeholders with real assertions

---

## Test Files & Activation Order

### Priority 1: Core Module Tests

#### 1.1 TreeSitterSummarizer Tests (`tests/summarization/tree-sitter-summarizer.test.ts`)

**Status**: 14 placeholder tests ready  
**Completion Target**: Validates code structure extraction

**Tests to Activate**:

- [ ] `should extract classes with methods` - Verify AuthManager class extracted
- [ ] `should extract function signatures` - Validate function parameter extraction
- [ ] `should extract type definitions` - Check type alias parsing
- [ ] `should extract interfaces` - Verify interface structure
- [ ] `should extract imports and exports` - Check module boundary extraction
- [ ] `should produce markdown output` - Validate formatting with headers
- [ ] `should include line numbers` - Verify location tracking
- [ ] `should handle parse errors gracefully` - Test error resilience
- [ ] `should format as valid markdown` - Validate markdown structure
- [ ] `should preserve method signatures` - Check signature accuracy
- [ ] `should exclude method implementations` - Verify implementation omission
- [ ] `should handle large files` - Test performance with >50KB files
- [ ] `should timeout on complex code` - Verify timeout behavior
- [ ] `should support Go language` - Validate Go grammar integration

#### 1.2 SummaryCache Tests (`tests/summarization/summary-cache.test.ts`)

**Status**: 10 placeholder tests ready  
**Completion Target**: Validates caching correctness

**Tests to Activate**:

- [ ] `should store and retrieve summaries` - Basic CRUD
- [ ] `should detect file changes via hash` - Test cache invalidation
- [ ] `should return null for stale cache` - Verify change detection
- [ ] `should track hit/miss statistics` - Validate metrics
- [ ] `should handle concurrent access` - Thread safety (if applicable)
- [ ] `should implement TTL cleanup` - Verify expiration
- [ ] `should persist to disk` - Test flush() functionality
- [ ] `should reload from disk` - Test load() functionality
- [ ] `should calculate correct size` - Verify memory tracking
- [ ] `should handle large entries` - Test with multi-MB summaries

#### 1.3 Read Strategy Tests (`tests/summarization/read-strategy.test.ts`)

**Status**: 8 placeholder tests ready  
**Completion Target**: Validates thresholding logic

**Tests to Activate**:

- [ ] `should return 'full' for small files` - Test < 2KB rule
- [ ] `should return 'summary' for large TypeScript` - Test > 2KB rule
- [ ] `should return 'full' for unsupported language` - Test language check
- [ ] `should return 'full' for editing phase` - Test isDraft flag
- [ ] `should handle parse error fallback` - Test error handling
- [ ] `should estimate token savings correctly` - Validate compression calculation
- [ ] `should respect file size thresholds` - Test boundary conditions
- [ ] `should provide reason string` - Verify decision explanation

#### 1.4 Read Wrapper Tests (`tests/summarization/read-wrapper.test.ts`)

**Status**: 18 placeholder tests ready  
**Completion Target**: Validates main orchestration

**Tests to Activate**:

- [ ] `should read small file in full` - Test < 2KB behavior
- [ ] `should summarize large file` - Test > 2KB behavior
- [ ] `should return markdown with metadata` - Verify output format
- [ ] `should provide metrics when requested` - Test returnMetrics flag
- [ ] `should cache on first read` - Verify caching
- [ ] `should hit cache on second read` - Test cache reuse
- [ ] `should respect full=true override` - Test Pi override
- [ ] `should handle isDraft=true` - Test editing mode
- [ ] `should fallback on parse error` - Test error handling
- [ ] `should handle missing files` - Test file not found
- [ ] `should handle permission errors` - Test access denied
- [ ] `should support Go files` - Test .go extension
- [ ] `should fallback on unsupported language` - Test .py files
- [ ] `should calculate compression ratio` - Verify metrics
- [ ] `should estimate token count` - Test heuristic
- [ ] `should estimate token savings` - Test delta calculation
- [ ] `should handle very large files` - Test > 1MB behavior
- [ ] `should provide decision path` - Test decisionPath output

### Priority 2: Integration & Real-World Tests

#### 2.1 Integration Tests (`tests/summarization/integration.test.ts`)

**Status**: 10 placeholder tests ready  
**Completion Target**: Validates end-to-end workflows

**Tests to Activate**:

- [ ] `should read small file as full content` - Basic read
- [ ] `should read large file as summary` - Basic summarization
- [ ] `should include metadata in summary` - Output format
- [ ] `should provide metrics when requested` - Metrics collection
- [ ] `should cache summaries within same run` - Same-run cache
- [ ] `should handle Pi override (full=true)` - Override mechanism
- [ ] `should invalidate cache when file changes` - File modification
- [ ] `should handle unsupported languages` - Fallback behavior
- [ ] `should estimate token savings correctly` - Metric accuracy
- [ ] `should handle real-world scenarios` - Multi-file workflow

---

## Activation Strategy

### Phase A: Setup & Infrastructure (if needed)

1. Verify test fixtures exist and have expected content
2. Verify imports resolve correctly
3. Run placeholder tests to confirm structure works

### Phase B: Activate Core Tests (Priority 1)

1. Start with TreeSitterSummarizer (lowest dependency)
2. Then SummaryCache (tested independently)
3. Then Read Strategy (depends on 1-2)
4. Finally Read Wrapper (depends on all)

**Estimated Time**: 4-6 hours

### Phase C: Activate Integration Tests (Priority 2)

1. Convert real-world scenario tests
2. Add performance benchmarks
3. Test edge cases

**Estimated Time**: 2-3 hours

### Phase D: Continuous Validation

1. Run full test suite after each batch
2. Check code coverage (target: >85% for summarization)
3. Monitor for flaky tests

---

## Test Activation Template

Each test follows this pattern:

```typescript
// BEFORE (Placeholder):
it('should extract classes with methods', async () => {
  const file = path.join(fixturesDir, 'large-file.ts');
  
  // const result = await TreeSitterSummarizer.summarize(fs.readFileSync(file, 'utf-8'));
  // expect(result?.classes).toBeDefined();
  // expect(result?.classes?.length).toBeGreaterThan(0);
  // expect(result?.classes[0]?.name).toEqual('UserManager');
  
  expect(true).toBe(true); // Placeholder
});

// AFTER (Activated):
it('should extract classes with methods', async () => {
  const file = path.join(fixturesDir, 'large-file.ts');
  const content = fs.readFileSync(file, 'utf-8');
  
  const result = await TreeSitterSummarizer.summarize(content);
  
  expect(result).toBeDefined();
  expect(result?.classes).toBeDefined();
  expect(result?.classes?.length).toBeGreaterThan(0);
  expect(result?.classes[0]?.name).toEqual('UserManager');
  expect(result?.classes[0]?.methods).toHaveLength(8);
});
```

---

## Key Testing Principles

1. **Fixture-Based**: All tests use files in `tests/fixtures/summarization/`
2. **Isolation**: Each test is independent (no shared state)
3. **Async-Aware**: All async operations properly awaited
4. **Error-Focused**: Include tests for error paths, not just happy paths
5. **Metrics-Driven**: Validate both output AND metrics
6. **Performance**: Check timing expectations (cache hits < 10ms)

---

## Success Criteria

| Item | Target | Notes |
|------|--------|-------|
| Tests written | 60+ ✅ | Already created |
| Tests activated | 60+ | In progress |
| Pass rate | 100% | All tests passing |
| Code coverage | >85% | Focus on summarization modules |
| Performance | < 200ms per file | Including worst-case (large file, first read) |
| Cache hits | < 10ms | Within-run hits |

---

## Dependencies to Verify Before Activation

- [ ] Jest configuration includes .ts test files
- [ ] ts-jest transpiler configured
- [ ] tree-sitter and grammars installed (`npm list tree-sitter`)
- [ ] Test fixtures exist and are readable
- [ ] Import paths resolve correctly
- [ ] No circular dependencies in test setup

**Check**: `npm run test:unit -- --listTests | grep summarization`

---

## Running Tests During Activation

```bash
# Run single test file
npm run test:unit -- tests/summarization/tree-sitter-summarizer.test.ts

# Run with verbose output
npm run test:unit -- tests/summarization/ --verbose

# Run with coverage
npm run test:unit -- tests/summarization/ --coverage

# Run specific test
npm run test:unit -- tests/summarization/ -t "should extract classes"

# Watch mode for active development
npm run test:unit -- tests/summarization/ --watch
```

---

## Notes for Implementation

### TreeSitterSummarizer Activation

- Import TreeSitterSummarizer from actual module (not mock)
- Test with real fixture files (small.ts, large.ts, handler.go)
- Verify markdown output includes expected headers
- Check that implementations are NOT included in summary

### SummaryCache Activation

- Test with temporary files (clean up in afterEach)
- Verify hash changes on file modification
- Check TTL cleanup doesn't affect recent entries
- Test concurrent read scenarios

### ReadStrategy Activation

- Use actual file sizes from fixtures
- Verify decision reasons are meaningful strings
- Check token estimates are within reasonable bounds
- Test all 6 decision rules exhaustively

### ReadWrapper Activation

- Mock filesystem where needed for error scenarios
- Verify metrics structure matches TypeScript interface
- Check that `full=true` override bypasses strategy
- Validate cache entry lifecycle

### Integration Tests Activation

- Use real fixture files (don't mock)
- Verify end-to-end workflows with actual data
- Check performance (cache hits should be instant)
- Validate metrics aggregation across multiple reads

---

## Questions & Clarifications

**Q: Should I mock tree-sitter or use real parsing?**  
A: Use real parsing. tree-sitter is the implementation we're testing. Mock only filesystem for error scenarios.

**Q: How do I test parse timeouts?**  
A: Create pathologically complex AST (deeply nested classes) or mock the timeout condition. See test comments.

**Q: Should cache tests use temporary files or memory?**  
A: Both. Use temp files for realistic I/O behavior, separate test for in-memory operations.

**Q: What's the expected compression ratio for different file sizes?**  
A: 60-70% typical for large files. Small files might not compress (summary > full). Capture both scenarios.

---

## Completion Checklist

- [ ] All 60+ tests activated (commented expectations uncommented)
- [ ] All tests passing (`npm run test:unit -- tests/summarization/`)
- [ ] Code coverage > 85% for summarization modules
- [ ] No console errors or warnings during test runs
- [ ] Performance meets expectations (documented in test comments)
- [ ] Metrics validation working correctly
- [ ] Cache behavior verified (hits, misses, invalidation)
- [ ] Error fallback paths tested
- [ ] Real-world workflows validated

---

## Next Steps After Activation

1. Implement LLM fallback handler (separate module)
2. Integrate with kaseki-agent.sh read tool
3. Update TASK_PROMPT with guidance for Pi
4. Create metrics export to artifact files
5. Deploy and validate in production
