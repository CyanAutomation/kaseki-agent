/**
 * pi-event-filter-metrics-integration.test.ts
 *
 * Integration test demonstrating all new metrics:
 * - Tool reliability (success/failure rates)
 * - Execution time breakdown (API vs tool)
 * - Per-tool and per-API statistics
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

jest.setTimeout(30000);

interface MetricsReport {
  tool_reliability: {
    total_tool_calls: number;
    successful_tool_calls: number;
    failed_tool_calls: number;
    success_rate_percent: number;
  };
  tool_stats: Record<
    string,
    {
      total: number;
      successful: number;
      failed: number;
      success_rate_percent: number;
    }
  >;
  execution_time: {
    api_time_seconds: number;
    tool_time_seconds: number;
    total_time_seconds: number;
    api_percent: number;
    tool_percent: number;
  };
  execution_api_stats: Record<
    string,
    {
      calls: number;
      total_seconds: number;
    }
  >;
  token_usage: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_creation_tokens: number;
    total_cache_read_tokens: number;
    total_tokens: number;
    cache_efficiency_percent: number;
  };
  model_token_stats: Record<
    string,
    {
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      total_tokens: number;
    }
  >;
}

async function runPiEventFilter(
  inputLines: string[]
): Promise<{ metrics: MetricsReport; exitCode: number | null }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-metrics-test-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'summary.json');

  try {
    fs.writeFileSync(inputPath, `${inputLines.join('\n')}\n`, 'utf8');

    const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    const child = spawn(tsxBin, [
      path.join(__dirname, 'pi-event-filter.ts'),
      inputPath,
      outputPath,
      summaryPath,
    ]);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(1));
      child.once('close', resolve);
    });

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    return {
      metrics: summary,
      exitCode,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('Pi Event Filter Metrics Integration', () => {
  test('tracks tool reliability and execution time together', async () => {
    const fixture = [
      // Agent start (API invocation begins)
      JSON.stringify({
        type: 'agent_start',
        timestamp: 1000,
      }),

      // First tool call (read_file) - SUCCESS
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1001,
        message: { model: 'gemini-pro', api: 'google' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1002,
        message: {
          model: 'gemini-pro',
          api: 'google',
          content: [
            { type: 'output_text', text: 'Successfully read configuration file' },
          ],
        },
      }),

      // Second tool call (execute_bash) - FAILED
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1003,
        message: { model: 'gemini-pro', api: 'google' },
        tool_name: 'execute_bash',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1004,
        message: {
          model: 'gemini-pro',
          api: 'google',
          content: [
            {
              type: 'output_text',
              text: 'Error: command not found npm',
            },
          ],
        },
      }),

      // Third tool call (read_file) - SUCCESS
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1005,
        message: { model: 'gemini-pro', api: 'google' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1006,
        message: {
          model: 'gemini-pro',
          api: 'google',
          content: [
            { type: 'output_text', text: 'Successfully read package.json' },
          ],
        },
      }),

      // Agent end (10 seconds of API time total)
      JSON.stringify({
        type: 'agent_end',
        timestamp: 1010,
      }),
    ];

    const result = await runPiEventFilter(fixture);
    expect(result.exitCode).toBe(0);

    const metrics = result.metrics as unknown as MetricsReport;

    // Verify tool reliability metrics
    expect(metrics.tool_reliability).toMatchObject({
      total_tool_calls: 3,
      successful_tool_calls: 2,
      failed_tool_calls: 1,
      success_rate_percent: 66.67,
    });

    // Verify per-tool statistics
    expect(metrics.tool_stats).toHaveProperty('read_file');
    expect(metrics.tool_stats.read_file).toMatchObject({
      total: 2,
      successful: 2,
      failed: 0,
      success_rate_percent: 100,
    });

    expect(metrics.tool_stats).toHaveProperty('execute_bash');
    expect(metrics.tool_stats.execute_bash).toMatchObject({
      total: 1,
      successful: 0,
      failed: 1,
      success_rate_percent: 0,
    });

    // Verify execution time metrics
    expect(metrics.execution_time).toMatchObject({
      api_time_seconds: 10,
      total_time_seconds: 10,
    });
  });

  test('comprehensive scenario with multiple phases', async () => {
    const fixture = [
      // Scouting phase
      JSON.stringify({
        type: 'agent_start',
        timestamp: 100,
        context: 'pi-scouting',
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 101,
        message: { model: 'gemini-1.5-flash', api: 'google' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 102,
        message: {
          model: 'gemini-1.5-flash',
          api: 'google',
          content: [{ type: 'output_text', text: 'Read 200 lines' }],
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: 105,
      }),

      // Main agent phase
      JSON.stringify({
        type: 'agent_start',
        timestamp: 200,
        context: 'pi-main',
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 201,
        message: { model: 'gemini-2-pro-exp', api: 'google' },
        tool_name: 'edit_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 202,
        message: {
          model: 'gemini-2-pro-exp',
          api: 'google',
          content: [{ type: 'output_text', text: 'Modified 5 lines in src/index.ts' }],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 202.5,
        message: { model: 'gemini-2-pro-exp', api: 'google' },
        tool_name: 'execute_bash',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 203,
        message: {
          model: 'gemini-2-pro-exp',
          api: 'google',
          content: [
            {
              type: 'output_text',
              text: 'Failed: unable to compile TypeScript',
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: 220,
      }),
    ];

    const result = await runPiEventFilter(fixture);
    expect(result.exitCode).toBe(0);

    const metrics = result.metrics as unknown as MetricsReport;

    // Overall stats
    expect(metrics.tool_reliability.total_tool_calls).toBe(3);
    expect(metrics.tool_reliability.successful_tool_calls).toBe(2);
    expect(metrics.tool_reliability.failed_tool_calls).toBe(1);
    expect(metrics.tool_reliability.success_rate_percent).toBeCloseTo(66.67);

    // Per-tool breakdown
    expect(metrics.tool_stats.read_file.success_rate_percent).toBe(100);
    expect(metrics.tool_stats.edit_file.success_rate_percent).toBe(100);
    expect(metrics.tool_stats.execute_bash.failed).toBe(1);

    // Time metrics (5 seconds scouting + 20 seconds main = 25 total)
    expect(metrics.execution_time.api_time_seconds).toBe(25);
    expect(metrics.execution_time.total_time_seconds).toBe(25);

    // API-specific timing
    expect(metrics.execution_api_stats['pi-scouting']).toMatchObject({
      calls: 1,
      total_seconds: 5,
    });
    expect(metrics.execution_api_stats['pi-main']).toMatchObject({
      calls: 1,
      total_seconds: 20,
    });
  });

  test('handles edge case: all tools fail', async () => {
    const fixture = [
      JSON.stringify({
        type: 'agent_start',
        timestamp: 1000,
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1001,
        message: { model: 'test', api: 'test' },
        tool_name: 'delete_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1002,
        message: {
          model: 'test',
          api: 'test',
          content: [
            { type: 'output_text', text: 'Error: permission denied' },
          ],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1003,
        message: { model: 'test', api: 'test' },
        tool_name: 'git_push',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1004,
        message: {
          model: 'test',
          api: 'test',
          content: [
            { type: 'output_text', text: 'Exception: connection failed' },
          ],
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: 1005,
      }),
    ];

    const result = await runPiEventFilter(fixture);
    expect(result.exitCode).toBe(0);

    const metrics = result.metrics as unknown as MetricsReport;
    expect(metrics.tool_reliability.success_rate_percent).toBe(0);
    expect(metrics.tool_reliability.failed_tool_calls).toBe(2);
  });

  test('tracks all metrics together: tool reliability + execution time + tokens', async () => {
    const fixture = [
      // Agent with token usage
      JSON.stringify({
        type: 'agent_start',
        timestamp: 100,
        context: 'pi-main',
      }),
      JSON.stringify({
        type: 'message_update',
        timestamp: 101,
        message: {
          model: 'gemini-3-flash',
          api: 'google',
          usage: {
            prompt_tokens: 500,
            completion_tokens: 200,
            prompt_tokens_details: {
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 400,
            },
          },
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 105,
        message: { model: 'gemini-3-flash', api: 'google' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 106,
        message: {
          model: 'gemini-3-flash',
          api: 'google',
          content: [{ type: 'output_text', text: 'Read 100 lines successfully' }],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 107,
        message: { model: 'gemini-3-flash', api: 'google' },
        tool_name: 'execute_bash',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 108,
        message: {
          model: 'gemini-3-flash',
          api: 'google',
          content: [{ type: 'output_text', text: 'Error: command failed' }],
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: 120, // 20 seconds
      }),
    ];

    const result = await runPiEventFilter(fixture);
    expect(result.exitCode).toBe(0);

    const metrics = result.metrics as unknown as MetricsReport;

    // Verify tool reliability
    expect(metrics.tool_reliability.total_tool_calls).toBe(2);
    expect(metrics.tool_reliability.successful_tool_calls).toBe(1);
    expect(metrics.tool_reliability.failed_tool_calls).toBe(1);
    expect(metrics.tool_reliability.success_rate_percent).toBe(50);

    // Verify token usage
    expect(metrics.token_usage.total_input_tokens).toBe(500);
    expect(metrics.token_usage.total_output_tokens).toBe(200);
    expect(metrics.token_usage.total_cache_creation_tokens).toBe(50);
    expect(metrics.token_usage.total_cache_read_tokens).toBe(400);
    expect(metrics.token_usage.total_tokens).toBe(1150);
    expect(metrics.token_usage.cache_efficiency_percent).toBeCloseTo(400 / 1150 * 100, 1);

    // Verify execution time
    expect(metrics.execution_time.api_time_seconds).toBe(20);

    // Verify per-model stats
    expect(metrics.model_token_stats['gemini-3-flash']).toBeDefined();
    expect(metrics.model_token_stats['gemini-3-flash'].total_tokens).toBe(1150);
  });
});
