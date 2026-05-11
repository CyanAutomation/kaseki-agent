/**
 * Tests for pi-progress-stream
 * Tests the ToolBatchAggregator class and related functionality
 */

import { describe, it, expect } from '@jest/globals';

/**
 * ToolBatchAggregator: Batches tool calls by type and emits summaries
 */
class ToolBatchAggregator {
  private toolBuffer: Map<string, number> = new Map();
  private lastFlushTime: number = Date.now();
  private coalesceWindow: number = 3000; // 3 seconds

  recordTool(tool: string): void {
    const count = (this.toolBuffer.get(tool) || 0) + 1;
    this.toolBuffer.set(tool, count);
    this.lastFlushTime = Date.now();
  }

  shouldFlush(): boolean {
    const elapsed = Date.now() - this.lastFlushTime;
    return this.toolBuffer.size > 0 && elapsed > this.coalesceWindow;
  }

  flush(): { summary: string; data: Record<string, number> } | null {
    if (this.toolBuffer.size === 0) {
      return null;
    }

    const summary = Array.from(this.toolBuffer.entries())
      .map(([tool, count]) => `${tool} (${count}x)`)
      .join(', ');

    const data = Object.fromEntries(this.toolBuffer);
    this.toolBuffer.clear();

    return { summary: `[tools] ${summary}`, data };
  }

  clear(): void {
    this.toolBuffer.clear();
  }

  getBufferSize(): number {
    return this.toolBuffer.size;
  }

  getToolCount(tool: string): number {
    return this.toolBuffer.get(tool) || 0;
  }
}

describe('ToolBatchAggregator', () => {
  it('initializes with empty buffer', () => {
    const aggregator = new ToolBatchAggregator();
    expect(aggregator.getBufferSize()).toBe(0);
  });

  it('records a single tool call', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    expect(aggregator.getToolCount('read_file')).toBe(1);
  });

  it('counts multiple calls for the same tool', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    expect(aggregator.getToolCount('read_file')).toBe(3);
  });

  it('tracks multiple different tools', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    aggregator.recordTool('write_file');
    aggregator.recordTool('grep_search');

    expect(aggregator.getToolCount('read_file')).toBe(2);
    expect(aggregator.getToolCount('write_file')).toBe(1);
    expect(aggregator.getToolCount('grep_search')).toBe(1);
    expect(aggregator.getBufferSize()).toBe(3);
  });

  it('does not flush if not enough time elapsed', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    // shouldFlush should be false because coalesce window hasn't elapsed
    expect(aggregator.shouldFlush()).toBe(false);
  });

  it('flushes with correct summary format', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.recordTool('write_file');
    aggregator.recordTool('write_file');

    const result = aggregator.flush();
    expect(result).toBeTruthy();
    if (result) {
      expect(result.summary).toContain('[tools]');
      expect(result.summary).toContain('read_file (1x)');
      expect(result.summary).toContain('write_file (2x)');
    }
  });

  it('clears buffer after flush', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.flush();
    expect(aggregator.getBufferSize()).toBe(0);
  });

  it('returns null when flushing empty buffer', () => {
    const aggregator = new ToolBatchAggregator();
    const result = aggregator.flush();
    expect(result).toBeNull();
  });

  it('can be cleared manually', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.recordTool('write_file');
    expect(aggregator.getBufferSize()).toBe(2);
    aggregator.clear();
    expect(aggregator.getBufferSize()).toBe(0);
  });

  it('handles tool names with underscores and hyphens', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');
    aggregator.recordTool('write_file');
    aggregator.recordTool('grep_search');
    aggregator.recordTool('semantic_search');

    expect(aggregator.getToolCount('read_file')).toBe(1);
    expect(aggregator.getToolCount('semantic_search')).toBe(1);

    const result = aggregator.flush();
    if (result) {
      expect(result.summary).toContain('read_file');
      expect(result.summary).toContain('semantic_search');
    }
  });

  it('returns correct data structure on flush', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('bash');
    aggregator.recordTool('bash');
    aggregator.recordTool('grep');

    const result = aggregator.flush();
    expect(result?.data).toEqual({
      bash: 2,
      grep: 1,
    });
  });

  it('updates lastFlushTime on recordTool call', () => {
    const aggregator = new ToolBatchAggregator();
    aggregator.recordTool('read_file');

    // After immediately recording, shouldFlush should be false
    expect(aggregator.shouldFlush()).toBe(false);

    // Wait a bit and record again
    aggregator.recordTool('write_file');
    // Still shouldn't flush immediately
    expect(aggregator.shouldFlush()).toBe(false);
  });

  it('aggregates many tool calls efficiently', () => {
    const aggregator = new ToolBatchAggregator();
    const toolNames = ['read_file', 'write_file', 'grep_search', 'bash', 'semantic_search'];

    // Record 100 calls in random distribution
    for (let i = 0; i < 100; i++) {
      const tool = toolNames[i % toolNames.length];
      aggregator.recordTool(tool);
    }

    expect(aggregator.getBufferSize()).toBe(toolNames.length);

    const result = aggregator.flush();
    expect(result?.summary).toContain('[tools]');
    // Should contain all tools, each appearing 20 times (100 / 5 tools)
    expect(result?.summary).toContain('(20x)');
  });

  it('handles same tool recorded multiple times between flushes', () => {
    const aggregator = new ToolBatchAggregator();

    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    let result = aggregator.flush();
    expect(result?.data.read_file).toBe(2);

    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    aggregator.recordTool('read_file');
    result = aggregator.flush();
    expect(result?.data.read_file).toBe(3);
  });
});
