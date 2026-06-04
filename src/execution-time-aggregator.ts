/**
 * execution-time-aggregator.ts
 *
 * Tracks API time vs tool execution time to identify performance bottlenecks.
 * Useful for understanding whether kaseki runs are bottlenecked by LLM API calls
 * or external tool execution (git, npm, validation commands).
 */

export interface ExecutionTimeSummary {
  api_time_seconds: number;
  tool_time_seconds: number;
  total_time_seconds: number;
  api_percent: number;
  tool_percent: number;
}

export interface ExecutionStats {
  [identifier: string]: {
    calls: number;
    total_seconds: number;
  };
}

/**
 * ExecutionTimeAggregator tracks wall time spent in two categories:
 * 1. API calls (Pi agent invocations, scouting, goal-check, etc.)
 * 2. Tool execution (npm, git, bash, validation commands)
 *
 * This breakdown helps identify if the bottleneck is API latency or tool execution.
 */
export class ExecutionTimeAggregator {
  private apiTimeSeconds = 0;
  private toolTimeSeconds = 0;

  // Per-API tracking: apiName -> { calls, total_seconds }
  private apiStats: Map<string, { calls: number; total_seconds: number }> =
    new Map();

  // Per-tool tracking: toolName -> { calls, total_seconds }
  private toolStats: Map<string, { calls: number; total_seconds: number }> =
    new Map();

  /**
   * Record an API call duration.
   * @param apiName - Identifier for the API call (e.g., 'pi-agent', 'pi-scouting')
   * @param durationSeconds - Duration in seconds
   */
  recordApiCall(apiName: string, durationSeconds: number): void {
    this.apiTimeSeconds += durationSeconds;

    const existing = this.apiStats.get(apiName) || {
      calls: 0,
      total_seconds: 0,
    };
    existing.calls += 1;
    existing.total_seconds += durationSeconds;
    this.apiStats.set(apiName, existing);
  }

  /**
   * Record a tool execution duration.
   * @param toolName - Identifier for the tool (e.g., 'npm test', 'git clone')
   * @param durationSeconds - Duration in seconds
   */
  recordToolExecution(toolName: string, durationSeconds: number): void {
    this.toolTimeSeconds += durationSeconds;

    const existing = this.toolStats.get(toolName) || {
      calls: 0,
      total_seconds: 0,
    };
    existing.calls += 1;
    existing.total_seconds += durationSeconds;
    this.toolStats.set(toolName, existing);
  }

  /**
   * Get the overall execution time summary.
   */
  getSummary(): ExecutionTimeSummary {
    const totalSeconds = this.apiTimeSeconds + this.toolTimeSeconds;
    const apiPercent =
      totalSeconds === 0
        ? 0
        : Math.round((this.apiTimeSeconds / totalSeconds) * 10000) / 100;
    const toolPercent =
      totalSeconds === 0
        ? 0
        : Math.round((this.toolTimeSeconds / totalSeconds) * 10000) / 100;

    return {
      api_time_seconds: this.apiTimeSeconds,
      tool_time_seconds: this.toolTimeSeconds,
      total_time_seconds: totalSeconds,
      api_percent: apiPercent,
      tool_percent: toolPercent,
    };
  }

  /**
   * Get per-API statistics.
   */
  getApiStats(): ExecutionStats {
    const result: ExecutionStats = {};

    for (const [apiName, stats] of this.apiStats.entries()) {
      result[apiName] = { ...stats };
    }

    return result;
  }

  /**
   * Get per-tool statistics.
   */
  getToolStats(): ExecutionStats {
    const result: ExecutionStats = {};

    for (const [toolName, stats] of this.toolStats.entries()) {
      result[toolName] = { ...stats };
    }

    return result;
  }
}
