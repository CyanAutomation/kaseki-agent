export interface CavemanLedgerEntry {
  phase?: unknown;
  input_tokens?: unknown;
  cache_creation_tokens?: unknown;
  cache_read_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
  estimated_cost_usd?: unknown;
  pricing_model?: unknown;
}

export interface CavemanPhaseMetrics {
  contextTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CavemanLedgerSummary {
  responseCount: number;
  contextTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number | null;
  costIsComplete: boolean;
  unpricedResponses: number;
  pricingModels: string[];
  phases: Record<string, CavemanPhaseMetrics>;
}

export interface CavemanImpactRun {
  ledger: CavemanLedgerEntry[];
  exitCode?: number | string | null;
}

export interface CavemanImpactReportInput {
  task: string;
  repository: string;
  ref: string;
  measuredAt?: string;
  verbose: CavemanImpactRun;
  terse: CavemanImpactRun;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function markdownCell(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim();
}

function number(value: number): string {
  return value.toLocaleString('en-US');
}

function percentage(delta: number, baseline: number): string {
  return baseline > 0 ? `${((delta / baseline) * 100).toFixed(1)}%` : 'n/a';
}

function cost(value: number | null): string {
  return value === null ? 'unpriced' : `$${value.toFixed(4)}`;
}

export function summarizeCavemanTokenLedger(entries: CavemanLedgerEntry[]): CavemanLedgerSummary {
  const phases: Record<string, CavemanPhaseMetrics> = {};
  let contextTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let estimatedCostTotal = 0;
  let unpricedResponses = 0;
  const pricingModels = new Set<string>();

  for (const entry of entries) {
    const input = numeric(entry.input_tokens);
    const cacheRead = numeric(entry.cache_read_tokens);
    const cacheWrite = numeric(entry.cache_creation_tokens);
    const output = numeric(entry.output_tokens);
    const context = input + cacheRead + cacheWrite;
    const responseTotal = numeric(entry.total_tokens) || context + output;
    const phaseName = typeof entry.phase === 'string' && entry.phase.trim() ? entry.phase : 'unknown';

    contextTokens += context;
    outputTokens += output;
    cacheReadTokens += cacheRead;
    cacheWriteTokens += cacheWrite;
    phases[phaseName] ??= { contextTokens: 0, outputTokens: 0, totalTokens: 0 };
    phases[phaseName].contextTokens += context;
    phases[phaseName].outputTokens += output;
    phases[phaseName].totalTokens += responseTotal;

    if (typeof entry.estimated_cost_usd === 'number' && Number.isFinite(entry.estimated_cost_usd) && entry.estimated_cost_usd >= 0) {
      estimatedCostTotal += entry.estimated_cost_usd;
    } else {
      unpricedResponses += 1;
    }
    if (typeof entry.pricing_model === 'string' && entry.pricing_model.trim()) pricingModels.add(entry.pricing_model);
  }

  const costIsComplete = entries.length > 0 && unpricedResponses === 0;
  return {
    responseCount: entries.length,
    contextTokens,
    outputTokens,
    totalTokens: contextTokens + outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    estimatedCostUsd: costIsComplete ? estimatedCostTotal : null,
    costIsComplete,
    unpricedResponses,
    pricingModels: [...pricingModels].sort(),
    phases,
  };
}

export function buildCavemanImpactReport(input: CavemanImpactReportInput): string {
  const verbose = summarizeCavemanTokenLedger(input.verbose.ledger);
  const terse = summarizeCavemanTokenLedger(input.terse.ledger);
  const contextDelta = verbose.contextTokens - terse.contextTokens;
  const outputDelta = verbose.outputTokens - terse.outputTokens;
  const totalDelta = verbose.totalTokens - terse.totalTokens;
  const costDelta = verbose.costIsComplete && terse.costIsComplete
    ? verbose.estimatedCostUsd! - terse.estimatedCostUsd!
    : null;
  const phases = [...new Set([...Object.keys(verbose.phases), ...Object.keys(terse.phases)])].sort();
  const lines = [
    '# Caveman Token Usage Impact Report',
    '',
    '## Test Configuration',
    '',
    `- **Task**: ${markdownCell(input.task)}`,
    `- **Repository**: ${markdownCell(input.repository)}`,
    `- **Ref**: ${markdownCell(input.ref)}`,
    `- **Date**: ${input.measuredAt || new Date().toISOString()}`,
    '',
    '## All-Phase Token Usage',
    '',
    'Totals use the all-run `token-ledger.jsonl`, including cache-read and cache-write context. They are not limited to the coding-phase summary.',
    '',
    '| Metric | Verbose | Terse | Delta | Reduction |',
    '|---|---:|---:|---:|---:|',
    `| Context tokens | ${number(verbose.contextTokens)} | ${number(terse.contextTokens)} | ${number(contextDelta)} | ${percentage(contextDelta, verbose.contextTokens)} |`,
    `| Output tokens | ${number(verbose.outputTokens)} | ${number(terse.outputTokens)} | ${number(outputDelta)} | ${percentage(outputDelta, verbose.outputTokens)} |`,
    `| **Total tokens** | **${number(verbose.totalTokens)}** | **${number(terse.totalTokens)}** | **${number(totalDelta)}** | **${percentage(totalDelta, verbose.totalTokens)}** |`,
    `| Estimated cost | ${cost(verbose.estimatedCostUsd)} | ${cost(terse.estimatedCostUsd)} | ${cost(costDelta)} | ${costDelta === null || verbose.estimatedCostUsd === null ? 'n/a' : percentage(costDelta, verbose.estimatedCostUsd)} |`,
    '',
    `Responses: ${verbose.responseCount} verbose / ${terse.responseCount} terse. Pricing models: ${[...new Set([...verbose.pricingModels, ...terse.pricingModels])].join(', ') || 'not recorded'}.`,
    `Unpriced responses: ${verbose.unpricedResponses} verbose / ${terse.unpricedResponses} terse. Cost is shown only when every response has configured pricing.`,
    '',
    '## Per-Phase Tokens',
    '',
    '| Phase | Verbose | Terse | Delta |',
    '|---|---:|---:|---:|',
    ...(phases.length > 0 ? phases.map((phase) => {
      const verbosePhase = verbose.phases[phase]?.totalTokens || 0;
      const tersePhase = terse.phases[phase]?.totalTokens || 0;
      return `| ${markdownCell(phase)} | ${number(verbosePhase)} | ${number(tersePhase)} | ${number(verbosePhase - tersePhase)} |`;
    }) : ['| no ledger data | 0 | 0 | 0 |']),
    '',
    `Both run exit codes: ${input.verbose.exitCode ?? 'unknown'} / ${input.terse.exitCode ?? 'unknown'} (verbose / terse).`,
    '',
    'This comparison reports measured usage; it does not establish that outcomes are equivalent or that Caveman caused the difference. Compare each run’s goal-check, validation, and diff evidence before treating a reduction as quality-preserving.',
    '',
  ];
  return lines.join('\n');
}
