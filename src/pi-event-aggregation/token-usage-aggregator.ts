/**
 * Token Usage Aggregator
 *
 * Tracks token usage including input, output, cache creation, and cache read tokens.
 * Maintains per-model breakdowns for cost estimation and cache efficiency analysis.
 */

export interface UsageObject {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface TokenUsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tokens: number;
  cache_efficiency_percent: number;
}

export interface ModelTokenStats {
  [modelName: string]: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    total_tokens: number;
  };
}

/**
 * TokenUsageAggregator tracks token usage across Pi event streams.
 *
 * Accumulates:
 * - Input tokens (prompt_tokens)
 * - Output tokens (completion_tokens)
 * - Cache creation tokens (prompt_tokens_details.cache_creation_input_tokens)
 * - Cache read tokens (prompt_tokens_details.cache_read_input_tokens)
 *
 * Also tracks per-model usage for cost estimation and performance analysis.
 */
export class TokenUsageAggregator {
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCacheCreationTokens = 0;
  private totalCacheReadTokens = 0;

  // Per-model tracking
  private modelStats: Map<
    string,
    {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    }
  > = new Map();

  /**
   * Get or initialize model stats.
   */
  private ensureModelStats(
    modelName: string
  ): {
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  } {
    if (!this.modelStats.has(modelName)) {
      this.modelStats.set(modelName, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
      });
    }
    return this.modelStats.get(modelName)!;
  }

  /**
   * Record input tokens for a model.
   */
  recordInputTokens(modelName: string, tokens: number): void {
    this.totalInputTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.input_tokens += tokens;
  }

  /**
   * Record output tokens for a model.
   */
  recordOutputTokens(modelName: string, tokens: number): void {
    this.totalOutputTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.output_tokens += tokens;
  }

  /**
   * Record cache creation tokens for a model.
   */
  recordCacheCreationTokens(modelName: string, tokens: number): void {
    this.totalCacheCreationTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.cache_creation_tokens += tokens;
  }

  /**
   * Record cache read tokens for a model.
   */
  recordCacheReadTokens(modelName: string, tokens: number): void {
    this.totalCacheReadTokens += tokens;
    const stats = this.ensureModelStats(modelName);
    stats.cache_read_tokens += tokens;
  }

  /**
   * Record usage from an OpenRouter-style usage object.
   * @param modelName - Model identifier
   * @param usage - Usage object with prompt_tokens, completion_tokens, etc.
   */
  recordUsage(modelName: string, usage: UsageObject | null | undefined): void {
    if (!usage || typeof usage !== 'object') return;

    if (typeof usage.prompt_tokens === 'number') {
      this.recordInputTokens(modelName, usage.prompt_tokens);
    }

    if (typeof usage.completion_tokens === 'number') {
      this.recordOutputTokens(modelName, usage.completion_tokens);
    }

    if (usage.prompt_tokens_details) {
      const details = usage.prompt_tokens_details;
      if (typeof details.cache_creation_input_tokens === 'number') {
        this.recordCacheCreationTokens(
          modelName,
          details.cache_creation_input_tokens
        );
      }
      if (typeof details.cache_read_input_tokens === 'number') {
        this.recordCacheReadTokens(modelName, details.cache_read_input_tokens);
      }
    }
  }

  /**
   * Get the overall token usage summary.
   */
  getSummary(): TokenUsageSummary {
    const totalTokens =
      this.totalInputTokens +
      this.totalOutputTokens +
      this.totalCacheCreationTokens +
      this.totalCacheReadTokens;

    // Cache efficiency: percentage of tokens from cache reads
    const cacheEfficiency =
      totalTokens === 0
        ? 0
        : Math.round((this.totalCacheReadTokens / totalTokens) * 10000) / 100;

    return {
      total_input_tokens: this.totalInputTokens,
      total_output_tokens: this.totalOutputTokens,
      total_cache_creation_tokens: this.totalCacheCreationTokens,
      total_cache_read_tokens: this.totalCacheReadTokens,
      total_tokens: totalTokens,
      cache_efficiency_percent: cacheEfficiency,
    };
  }

  /**
   * Get per-model token usage statistics.
   */
  getModelStats(): ModelTokenStats {
    const result: ModelTokenStats = {};

    for (const [modelName, stats] of this.modelStats.entries()) {
      const total =
        stats.input_tokens +
        stats.output_tokens +
        stats.cache_creation_tokens +
        stats.cache_read_tokens;

      result[modelName] = {
        ...stats,
        total_tokens: total,
      };
    }

    return result;
  }
}
