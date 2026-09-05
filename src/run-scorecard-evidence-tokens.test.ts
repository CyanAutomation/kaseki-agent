import { aggregateTokenUsage, providerRetryCounts, countRetries } from './run-scorecard-evidence-tokens';

describe('run-scorecard-evidence-tokens unit tests', () => {
  test('deduplicates usage and counts unknown requests', () => {
    const summaries = [
      { phase: 'coding', request_id: 'one', usage: { input: 100, output: 20, cacheRead: 5 } },
      { phase: 'coding', request_id: 'one', usage: { input: 100, output: 20, cacheRead: 5 } },
      { phase: 'goal-check', request_id: 'two' },
    ];
    const agg = aggregateTokenUsage(summaries as unknown as any[]);
    expect(agg.tokens).toBe(125);
    expect(agg.unknownTokenRequests).toBe(1);
    expect(agg.tokenUsage.completeness).toBe('provisional');
    expect(agg.phaseTokens['coding'].input_tokens).toBeGreaterThanOrEqual(100);
  });

  test('counts provider retry attempts and ignores malformed lines', () => {
    const snapshot = {
      json: {},
      text: { 'provider-attempts.jsonl': [
        '{malformed',
        'null',
        '[]',
        '{"phase":"coding","attempt":"primary-1"}',
        '{"phase":"coding","attempt":"primary-2"}',
      ].join('\n') },
    } as unknown as any;

    expect(providerRetryCounts(snapshot)).toEqual({ coding: 1 });
    expect(countRetries(snapshot)).toBe(1);
  });
});
