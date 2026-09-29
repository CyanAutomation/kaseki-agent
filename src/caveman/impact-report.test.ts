import { buildCavemanImpactReport, summarizeCavemanTokenLedger } from './impact-report';

describe('Caveman impact report', () => {
  it('aggregates per-response input, cache, output, phase, and configured cost from all-run ledger', () => {
    const summary = summarizeCavemanTokenLedger([
      { phase: 'scouting', input_tokens: 800, cache_creation_tokens: 100, cache_read_tokens: 0, output_tokens: 100, total_tokens: 1000, estimated_cost_usd: 0.001, pricing_model: 'model-a' },
      { phase: 'coding', input_tokens: 900, cache_creation_tokens: 0, cache_read_tokens: 300, output_tokens: 200, total_tokens: 1400, estimated_cost_usd: 0.002, pricing_model: 'model-b' },
    ]);

    expect(summary).toMatchObject({
      responseCount: 2,
      contextTokens: 2100,
      outputTokens: 300,
      totalTokens: 2400,
      cacheReadTokens: 300,
      cacheWriteTokens: 100,
      estimatedCostUsd: 0.003,
      costIsComplete: true,
      phases: {
        scouting: { totalTokens: 1000 },
        coding: { totalTokens: 1400 },
      },
    });
  });

  it('does not invent cost when any ledger response is unpriced', () => {
    const summary = summarizeCavemanTokenLedger([
      { phase: 'coding', input_tokens: 100, output_tokens: 20, total_tokens: 120, estimated_cost_usd: null },
    ]);

    expect(summary).toMatchObject({ estimatedCostUsd: null, costIsComplete: false, unpricedResponses: 1 });
  });

  it('writes a comparison report with actual ledger cost and a quality-equivalence caveat', () => {
    const report = buildCavemanImpactReport({
      task: 'Fix parser',
      repository: 'owner/repo',
      ref: 'main',
      measuredAt: '2026-09-29T10:00:00.000Z',
      verbose: {
        ledger: [{ phase: 'coding', input_tokens: 1000, output_tokens: 100, total_tokens: 1100, estimated_cost_usd: 0.01 }],
        exitCode: 0,
      },
      terse: {
        ledger: [{ phase: 'coding', input_tokens: 700, output_tokens: 80, total_tokens: 780, estimated_cost_usd: 0.007 }],
        exitCode: 0,
      },
    });

    expect(report).toContain('Fix parser');
    expect(report).toContain('0.0030');
    expect(report).toContain('Both run exit codes: 0 / 0');
    expect(report).toMatch(/does not establish that outcomes are equivalent/i);
    expect(report).not.toContain('$0.50/1M');
  });
});
