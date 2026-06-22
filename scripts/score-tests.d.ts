/**
 * Test Quality Scoring Script
 *
 * Analyzes all 102 test files and scores them on the following rubric (0-2 per dimension):
 * 1. Intent clarity — Test name + body state behavior (not implementation)
 * 2. Behavioral relevance — Maps to spec/issue with traceable ID
 * 3. Assertion quality — Precise, semantic assertions (not snapshots)
 * 4. Isolation & robustness — Deterministic, minimal mocking, no flakes
 * 5. Cost vs. coverage — Fast execution + meaningful mutation coverage
 *
 * Outputs JSON report with all scores and identifies bottom 10 tests.
 */
export {};
//# sourceMappingURL=score-tests.d.ts.map