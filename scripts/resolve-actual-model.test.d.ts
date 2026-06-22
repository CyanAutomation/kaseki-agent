/**
 * Tests for scripts/resolve-actual-model.ts
 *
 * Coverage targets:
 * - Model extraction from event stream (JSONL)
 * - Model extraction from summary.json (selected_model, model, counters)
 * - Fallback chain: events → summary.selected_model → summary.model → counters → "unknown"
 * - Robustness: malformed JSON, missing files, empty files
 */
export {};
//# sourceMappingURL=resolve-actual-model.test.d.ts.map