/**
 * token-usage-aggregator.test.ts
 *
 * TDD tests for tracking token usage across Pi event stream.
 * Handles input tokens, output tokens, and cache-related tokens.
 */

import { TokenUsageAggregator } from './token-usage-aggregator';

describe('TokenUsageAggregator', () => {
  let aggregator: TokenUsageAggregator;

  beforeEach(() => {
    aggregator = new TokenUsageAggregator();
  });

  describe('initialization', () => {
    test('starts with zero token counts', () => {
      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(0);
      expect(summary.total_output_tokens).toBe(0);
      expect(summary.total_cache_creation_tokens).toBe(0);
      expect(summary.total_cache_read_tokens).toBe(0);
      expect(summary.total_tokens).toBe(0);
      expect(summary.cache_efficiency_percent).toBe(0);
    });
  });

  describe('recording input tokens', () => {
    test('records single input token event', () => {
      aggregator.recordInputTokens('gemini-3-flash', 100);
      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(100);
      expect(summary.total_tokens).toBe(100);
    });

    test('accumulates input tokens from multiple calls', () => {
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordInputTokens('gemini-3-flash', 50);
      aggregator.recordInputTokens('gemini-pro', 75);

      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(225);
    });

    test('tracks per-model input tokens', () => {
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordInputTokens('gemini-3-flash', 50);
      aggregator.recordInputTokens('gemini-pro', 75);

      const modelStats = aggregator.getModelStats();
      expect(modelStats['gemini-3-flash'].input_tokens).toBe(150);
      expect(modelStats['gemini-pro'].input_tokens).toBe(75);
    });
  });

  describe('recording output tokens', () => {
    test('records single output token event', () => {
      aggregator.recordOutputTokens('gemini-3-flash', 50);
      const summary = aggregator.getSummary();
      expect(summary.total_output_tokens).toBe(50);
      expect(summary.total_tokens).toBe(50);
    });

    test('accumulates output tokens from multiple calls', () => {
      aggregator.recordOutputTokens('gemini-3-flash', 50);
      aggregator.recordOutputTokens('gemini-3-flash', 25);
      aggregator.recordOutputTokens('gemini-pro', 100);

      const summary = aggregator.getSummary();
      expect(summary.total_output_tokens).toBe(175);
    });

    test('tracks per-model output tokens', () => {
      aggregator.recordOutputTokens('gemini-3-flash', 50);
      aggregator.recordOutputTokens('gemini-3-flash', 25);
      aggregator.recordOutputTokens('gemini-pro', 100);

      const modelStats = aggregator.getModelStats();
      expect(modelStats['gemini-3-flash'].output_tokens).toBe(75);
      expect(modelStats['gemini-pro'].output_tokens).toBe(100);
    });
  });

  describe('recording cache tokens', () => {
    test('records cache creation tokens', () => {
      aggregator.recordCacheCreationTokens('gemini-3-flash', 20);
      const summary = aggregator.getSummary();
      expect(summary.total_cache_creation_tokens).toBe(20);
      expect(summary.total_tokens).toBe(20);
    });

    test('records cache read tokens', () => {
      aggregator.recordCacheReadTokens('gemini-3-flash', 80);
      const summary = aggregator.getSummary();
      expect(summary.total_cache_read_tokens).toBe(80);
      expect(summary.total_tokens).toBe(80);
    });

    test('accumulates both cache creation and read tokens', () => {
      aggregator.recordCacheCreationTokens('gemini-3-flash', 20);
      aggregator.recordCacheReadTokens('gemini-3-flash', 80);

      const summary = aggregator.getSummary();
      expect(summary.total_cache_creation_tokens).toBe(20);
      expect(summary.total_cache_read_tokens).toBe(80);
      expect(summary.total_tokens).toBe(100);
    });

    test('tracks per-model cache tokens', () => {
      aggregator.recordCacheCreationTokens('gemini-3-flash', 20);
      aggregator.recordCacheReadTokens('gemini-3-flash', 80);
      aggregator.recordCacheCreationTokens('gemini-pro', 10);

      const modelStats = aggregator.getModelStats();
      expect(modelStats['gemini-3-flash'].cache_creation_tokens).toBe(20);
      expect(modelStats['gemini-3-flash'].cache_read_tokens).toBe(80);
      expect(modelStats['gemini-pro'].cache_creation_tokens).toBe(10);
    });
  });

  describe('cache efficiency calculation', () => {
    test('calculates cache efficiency as percentage of cache reads', () => {
      // 100 cache read tokens out of 200 total tokens = 50%
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordCacheReadTokens('gemini-3-flash', 100);

      const summary = aggregator.getSummary();
      expect(summary.cache_efficiency_percent).toBe(50);
    });

    test('handles zero cache efficiency', () => {
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordOutputTokens('gemini-3-flash', 50);

      const summary = aggregator.getSummary();
      expect(summary.cache_efficiency_percent).toBe(0);
    });

    test('handles 100% cache efficiency', () => {
      aggregator.recordCacheReadTokens('gemini-3-flash', 100);

      const summary = aggregator.getSummary();
      expect(summary.cache_efficiency_percent).toBe(100);
    });

    test('rounds cache efficiency to 2 decimal places', () => {
      // 1/3 = 33.333...%
      aggregator.recordInputTokens('gemini-3-flash', 200);
      aggregator.recordCacheReadTokens('gemini-3-flash', 100);
      aggregator.recordOutputTokens('gemini-3-flash', 0);

      const summary = aggregator.getSummary();
      expect(summary.cache_efficiency_percent).toBe(33.33);
    });
  });

  describe('mixed token types', () => {
    test('aggregates all token types correctly', () => {
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordOutputTokens('gemini-3-flash', 50);
      aggregator.recordCacheCreationTokens('gemini-3-flash', 10);
      aggregator.recordCacheReadTokens('gemini-3-flash', 80);

      const summary = aggregator.getSummary();
      expect(summary).toEqual({
        total_input_tokens: 100,
        total_output_tokens: 50,
        total_cache_creation_tokens: 10,
        total_cache_read_tokens: 80,
        total_tokens: 240,
        cache_efficiency_percent: 33.33,
      });
    });
  });

  describe('multi-model tracking', () => {
    test('tracks separate stats for each model', () => {
      // Model A: 100 input, 25 output, 20 cache_creation, 50 cache_read
      aggregator.recordInputTokens('gemini-3-flash', 100);
      aggregator.recordOutputTokens('gemini-3-flash', 25);
      aggregator.recordCacheCreationTokens('gemini-3-flash', 20);
      aggregator.recordCacheReadTokens('gemini-3-flash', 50);

      // Model B: 50 input, 10 output, 5 cache_creation, 30 cache_read
      aggregator.recordInputTokens('gemini-pro', 50);
      aggregator.recordOutputTokens('gemini-pro', 10);
      aggregator.recordCacheCreationTokens('gemini-pro', 5);
      aggregator.recordCacheReadTokens('gemini-pro', 30);

      const modelStats = aggregator.getModelStats();
      expect(modelStats['gemini-3-flash'].input_tokens).toBe(100);
      expect(modelStats['gemini-3-flash'].output_tokens).toBe(25);
      expect(modelStats['gemini-3-flash'].cache_creation_tokens).toBe(20);
      expect(modelStats['gemini-3-flash'].cache_read_tokens).toBe(50);
      expect(modelStats['gemini-3-flash'].total_tokens).toBe(195);

      expect(modelStats['gemini-pro'].input_tokens).toBe(50);
      expect(modelStats['gemini-pro'].output_tokens).toBe(10);
      expect(modelStats['gemini-pro'].cache_creation_tokens).toBe(5);
      expect(modelStats['gemini-pro'].cache_read_tokens).toBe(30);
      expect(modelStats['gemini-pro'].total_tokens).toBe(95);

      // Total should be sum of both
      const summary = aggregator.getSummary();
      expect(summary.total_tokens).toBe(290);
    });
  });

  describe('edge cases', () => {
    test('handles zero tokens', () => {
      aggregator.recordInputTokens('test', 0);
      aggregator.recordOutputTokens('test', 0);

      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(0);
      expect(summary.total_output_tokens).toBe(0);
      expect(summary.total_tokens).toBe(0);
    });

    test('handles very large token counts', () => {
      aggregator.recordInputTokens('test', 1000000);
      aggregator.recordOutputTokens('test', 500000);

      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(1000000);
      expect(summary.total_output_tokens).toBe(500000);
      expect(summary.total_tokens).toBe(1500000);
    });

    test('handles unknown model name', () => {
      aggregator.recordInputTokens('unknown-model', 50);
      aggregator.recordOutputTokens('another-unknown', 25);

      const modelStats = aggregator.getModelStats();
      expect(modelStats['unknown-model']).toBeDefined();
      expect(modelStats['another-unknown']).toBeDefined();
    });
  });

  describe('recording from usage objects', () => {
    test('records from OpenRouter-style usage object', () => {
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: {
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 80,
        },
      };

      aggregator.recordUsage('gemini-3-flash', usage);

      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(100);
      expect(summary.total_output_tokens).toBe(50);
      expect(summary.total_cache_creation_tokens).toBe(10);
      expect(summary.total_cache_read_tokens).toBe(80);
    });

    test('handles partial usage objects', () => {
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
      };

      aggregator.recordUsage('gemini-3-flash', usage);

      const summary = aggregator.getSummary();
      expect(summary.total_input_tokens).toBe(100);
      expect(summary.total_output_tokens).toBe(50);
      expect(summary.total_cache_creation_tokens).toBe(0);
      expect(summary.total_cache_read_tokens).toBe(0);
    });

    test('ignores null or undefined usage', () => {
      aggregator.recordUsage('gemini-3-flash', null as any);
      aggregator.recordUsage('gemini-pro', undefined as any);

      const summary = aggregator.getSummary();
      expect(summary.total_tokens).toBe(0);
    });
  });
});
