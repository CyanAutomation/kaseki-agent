#!/usr/bin/env node
/**
 * Resolve Actual Model Attribution
 *
 * Attempts to determine the actual model used by a kaseki run via a 3-tier fallback chain:
 * 1. Event stream (pi-events.jsonl) - look for first model event
 * 2. Summary counters - if exactly 1 model used, extract from counters
 * 3. Summary metadata - if selected_model or model field exists
 *
 * Returns 'unknown' if all tiers fail.
 *
 * CLI Usage: npx ts-node scripts/resolve-actual-model.ts <summaryPath> <eventsPath>
 */
/**
 * Resolve the actual model used in a kaseki run
 * Uses 3-tier fallback: event stream → summary → 'unknown'
 *
 * @param summaryPath - Path to pi-summary.json
 * @param eventsPath - Path to pi-events.jsonl
 * @returns Model string or 'unknown'
 */
export declare function resolveActualModel({ summaryPath, eventsPath }?: {
    summaryPath?: string;
    eventsPath?: string;
}): string;
//# sourceMappingURL=resolve-actual-model.d.ts.map