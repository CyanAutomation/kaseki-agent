import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

jest.setTimeout(20000);

interface RunResult {
  exitCode: number | null;
  lines: string[];
  summary: any;
}

async function runFilter(inputLines: string[]): Promise<RunResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-fast-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'summary.json');

  try {
    fs.writeFileSync(inputPath, `${inputLines.join('\n')}\n`, 'utf8');

    let stderrOutput = '';
    const tsxBin = path.join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    const child = spawn(tsxBin, [
      path.join(__dirname, 'pi-event-filter.ts'),
      inputPath,
      outputPath,
      summaryPath,
    ]);

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });
    }

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    if (exitCode !== 0 && stderrOutput) {
      console.error(`pi-event-filter stderr (exit ${exitCode}):`, stderrOutput);
    }

    const output = fs.existsSync(outputPath)
      ? fs.readFileSync(outputPath, 'utf8').trim()
      : '';
    const lines = output ? output.split('\n') : [];
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

    return { exitCode, lines, summary };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('pi-event-filter fast correctness tests', () => {
  test('filters a tiny JSONL fixture and writes representative summary', async () => {
    const fixture = [
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { model: 'small-model', api: 'small-api' },
        assistantMessageEvent: {
          type: 'thinking_delta',
          partial: { content: [{ type: 'thinking', text: 'hidden' }] },
        },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          model: 'small-model',
          api: 'small-api',
          content: [
            { type: 'thinking', text: 'remove-me' },
            { type: 'output_text', text: 'keep-me' },
          ],
        },
        assistantMessageEvent: {
          type: 'output_delta',
          partial: {
            content: [
              { type: 'thinking', text: 'remove-me-too' },
              { type: 'output_text', text: 'visible' },
            ],
          },
        },
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);

    const kept = JSON.parse(result.lines[0]);
    expect(kept.message.content).toEqual([{ type: 'output_text', text: 'keep-me' }]);
    expect(kept.assistantMessageEvent.partial.content).toEqual([
      { type: 'output_text', text: 'visible' },
    ]);
    expect(result.summary).toMatchObject({
      selected_model: 'small-model',
      selected_api: 'small-api',
      invalid_json_lines: 0,
      tool_start_count: 1,
      tool_end_count: 1,
      first_event_at: '2026-01-01T00:00:00.000Z',
      last_event_at: '2026-01-01T00:00:01.000Z',
      event_counts: {
        tool_execution_start: 1,
        tool_execution_end: 1,
      },
      assistant_event_counts: {
        thinking_delta: 1,
        output_delta: 1,
      },
    });
  });

  test('computes summary counts and preferred model/api from medium fixture', async () => {
    const fixture = [
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { model: 'model-a', api: 'api-a' },
        assistantMessageEvent: { type: 'output_delta', partial: { model: 'model-a', api: 'api-a' } },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { model: 'model-b', api: 'api-b' },
        assistantMessageEvent: { type: 'output_delta', partial: { model: 'model-b', api: 'api-b' } },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { model: 'model-a', api: 'api-a' },
        assistantMessageEvent: { type: 'thinking_delta', partial: { model: 'model-a', api: 'api-a' } },
      }),
      JSON.stringify({
        type: 'other_event',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { model: 'model-c', api: 'api-c' },
        assistantMessageEvent: { type: 'output_delta', partial: { model: 'model-c', api: 'api-c' } },
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(3);
    expect(result.summary.tool_start_count).toBe(2);
    expect(result.summary.tool_end_count).toBe(1);
    expect(result.summary.event_counts.tool_execution_start).toBe(2);
    expect(result.summary.event_counts.tool_execution_end).toBe(1);
    expect(result.summary.event_counts.other_event).toBe(1);
    expect(result.summary.assistant_event_counts.output_delta).toBe(3);
    expect(result.summary.assistant_event_counts.thinking_delta).toBe(1);
    expect(result.summary.selected_model).toBe('model-a');
    expect(result.summary.selected_api).toBe('api-a');
    expect(result.summary.first_event_at).toBe('2026-01-01T00:00:01.000Z');
    expect(result.summary.last_event_at).toBe('2026-01-01T00:00:04.000Z');
  });

  test('counts and skips invalid JSON lines', async () => {
    const fixture = [
      '{"type":"tool_execution_start","timestamp":"2026-01-01T00:00:01.000Z","message":{"model":"x","api":"y"}}',
      '{this-is-invalid-json}',
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { model: 'x', api: 'y' },
        assistantMessageEvent: { type: 'output_delta' },
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(2);
    expect(result.summary.invalid_json_lines).toBe(1);
  });

  test('tracks tool reliability metrics in summary', async () => {
    const fixture = [
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { model: 'test-model', api: 'test-api' },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          model: 'test-model',
          api: 'test-api',
          content: [{ type: 'output_text', text: 'Successfully completed' }],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:01.500Z',
        message: { model: 'test-model', api: 'test-api' },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          model: 'test-model',
          api: 'test-api',
          content: [{ type: 'output_text', text: 'Error: operation failed' }],
        },
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.summary.tool_reliability).toBeDefined();
    expect(result.summary.tool_reliability?.total_tool_calls).toBe(2);
    expect(result.summary.tool_reliability?.successful_tool_calls).toBe(1);
    expect(result.summary.tool_reliability?.failed_tool_calls).toBe(1);
    expect(result.summary.tool_reliability?.success_rate_percent).toBe(50);
  });

  test('includes per-tool statistics in summary', async () => {
    const fixture = [
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { model: 'test-model', api: 'test-api' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          model: 'test-model',
          api: 'test-api',
          content: [{ type: 'output_text', text: 'Success' }],
        },
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: '2026-01-01T00:00:01.500Z',
        message: { model: 'test-model', api: 'test-api' },
        tool_name: 'read_file',
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          model: 'test-model',
          api: 'test-api',
          content: [{ type: 'output_text', text: 'Error: timeout' }],
        },
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.summary.tool_stats).toBeDefined();
    expect(result.summary.tool_stats?.read_file).toBeDefined();
    expect(result.summary.tool_stats?.read_file.total).toBe(2);
    expect(result.summary.tool_stats?.read_file.successful).toBe(1);
    expect(result.summary.tool_stats?.read_file.failed).toBe(1);
    expect(result.summary.tool_stats?.read_file.success_rate_percent).toBe(50);
  });

  test('tracks execution time metrics (API vs tool)', async () => {
    const fixture = [
      JSON.stringify({
        type: 'agent_start',
        timestamp: 1000, // Unix epoch in seconds
      }),
      JSON.stringify({
        type: 'tool_execution_start',
        timestamp: 1000.5,
        message: { model: 'test-model', api: 'test-api' },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        timestamp: 1001,
        message: {
          model: 'test-model',
          api: 'test-api',
          content: [{ type: 'output_text', text: 'Success' }],
        },
      }),
      JSON.stringify({
        type: 'agent_end',
        timestamp: 1005, // 5 seconds after start
      }),
    ];

    const result = await runFilter(fixture);
    expect(result.exitCode).toBe(0);
    expect(result.summary.execution_time).toBeDefined();
    expect(result.summary.execution_time?.api_time_seconds).toBe(5);
    expect(result.summary.execution_time?.tool_time_seconds).toBe(0);
    expect(result.summary.execution_time?.total_time_seconds).toBe(5);
  });
});
