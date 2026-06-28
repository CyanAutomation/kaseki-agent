/**
 * Tool Reliability Aggregator
 *
 * Tracks tool execution success/failure rates with pattern-based error detection.
 * Maintains both overall statistics and per-tool breakdowns for granular analysis.
 */

export interface ToolReliabilitySummary {
  total_tool_calls: number;
  successful_tool_calls: number;
  failed_tool_calls: number;
  success_rate_percent: number;
}

export interface ToolStats {
  [toolName: string]: {
    total: number;
    successful: number;
    failed: number;
    success_rate_percent: number;
  };
}

const ERROR_PATTERNS = [
  'error',
  'failed',
  'failure',
  'exception',
  'cannot',
  'unable to',
  'invalid',
  'undefined',
  'null',
  'not found',
  'does not exist',
  'exit code',
  'exited with code',
];

/**
 * ToolReliabilityAggregator tracks the success/failure rate of tool calls.
 *
 * It uses pattern-based error detection to classify tool outcomes:
 * - Success: tool_execution_end with no error patterns in message
 * - Failure: tool_execution_end with one or more error patterns detected
 *
 * Per-tool statistics are tracked separately from overall summary.
 */
export class ToolReliabilityAggregator {
  private totalToolCalls = 0;
  private successfulToolCalls = 0;
  private failedToolCalls = 0;

  // Per-tool tracking: toolName -> { total, successful, failed }
  private toolStats: Map<
    string,
    { total: number; successful: number; failed: number }
  > = new Map();

  private currentToolName: string | null = null;

  /**
   * Detect error patterns in a message string (case-insensitive).
   */
  private detectError(message: string | null | undefined): boolean {
    if (!message || typeof message !== 'string') return false;
    const lowerMessage = message.toLowerCase();
    return ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
  }

  /**
   * Record the start of a tool execution (with optional tool name).
   */
  recordToolStart(toolName: string | null = null): void {
    this.currentToolName = toolName || `tool_${this.totalToolCalls}`;
  }

  /**
   * Record the end of a tool execution with its output message.
   * Analyzes the message for error patterns to determine success/failure.
   */
  recordToolEnd(message: string | null | undefined): void {
    const toolName = this.currentToolName || `tool_${this.totalToolCalls}`;
    const isError = this.detectError(message);

    this.totalToolCalls += 1;

    if (isError) {
      this.failedToolCalls += 1;
    } else {
      this.successfulToolCalls += 1;
    }

    // Track per-tool statistics
    const existing = this.toolStats.get(toolName) || {
      total: 0,
      successful: 0,
      failed: 0,
    };
    existing.total += 1;
    if (isError) {
      existing.failed += 1;
    } else {
      existing.successful += 1;
    }
    this.toolStats.set(toolName, existing);

    this.currentToolName = null;
  }

  /**
   * Get the overall success/failure summary.
   */
  getSummary(): ToolReliabilitySummary {
    const successRate =
      this.totalToolCalls === 0
        ? 0
        : Math.round(
          (this.successfulToolCalls / this.totalToolCalls) * 10000
        ) / 100;

    return {
      total_tool_calls: this.totalToolCalls,
      successful_tool_calls: this.successfulToolCalls,
      failed_tool_calls: this.failedToolCalls,
      success_rate_percent: successRate,
    };
  }

  /**
   * Get per-tool success rates.
   */
  getToolStats(): ToolStats {
    const result: ToolStats = {};

    for (const [toolName, stats] of this.toolStats.entries()) {
      const successRate =
        stats.total === 0
          ? 0
          : Math.round((stats.successful / stats.total) * 10000) / 100;

      result[toolName] = {
        total: stats.total,
        successful: stats.successful,
        failed: stats.failed,
        success_rate_percent: successRate,
      };
    }

    return result;
  }
}
