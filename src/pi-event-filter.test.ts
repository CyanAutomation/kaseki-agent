import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPiEventFilter } from './pi-event-filter';
import { runFilter, runFilterContract } from '../tests/helpers/pi-event-filter-test-helpers';
import { responseIdFixture } from './pi-event-filter-test-fixtures';

jest.setTimeout(20000);

/**
 * pi-event-filter Tests (382 lines)
 *
 * Integration tests for the Pi event filter that:
 * 1. Removes thinking blocks from assistant output
 * 2. Summarizes event counts, timestamps, and model preferences
 * 3. Handles invalid JSON gracefully
 * 4. Tracks tool reliability and token usage metrics
 *
 * Architecture:
 * - Uses tsx to spawn pi-event-filter.ts as subprocess for correctness
 * - Each test creates temp dir with input JSONL, runs filter, validates output + summary
 * - Heavy process spawning (8 tests × 1 spawn = slow ~2–3s per test suite)
 *
 * Note: Spawning subprocess tests robustness but limits isolation.
 * Consider extracting pure functions for unit testing in future.
 */
// Fast correctness and integration cases remain top-level so each test is analyzed independently.
test('returns an empty filtered event collection when no events are retained', async () => {
  const result = await runFilter([
    JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta' },
    }),
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.lines).toEqual([]);
  expect(result.summary.event_counts).toMatchObject({ message_update: 1 });
});

test('runPiEventFilter public contract redacts thinking content and summarizes selected model/api', async () => {
  const result = await runFilterContract([
    JSON.stringify({
      type: 'tool_execution_start',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { model: 'contract-model', api: 'contract-api' },
      assistantMessageEvent: { type: 'thinking_delta' },
    }),
    JSON.stringify({
      type: 'tool_execution_end',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        model: 'contract-model',
        api: 'contract-api',
        content: [
          { type: 'thinking', text: 'hidden' },
          { type: 'output_text', text: 'visible' },
        ],
      },
      assistantMessageEvent: {
        type: 'output_delta',
        partial: { content: [{ type: 'thinking', text: 'hidden' }, { type: 'output_text', text: 'kept' }] },
      },
    }),
  ]);

  expect(result.kept.message.content).toEqual([{ type: 'output_text', text: 'visible' }]);
  expect(result.kept.assistantMessageEvent.partial.content).toEqual([{ type: 'output_text', text: 'kept' }]);
  expect(result.summary).toMatchObject({
    selected_model: 'contract-model',
    selected_api: 'contract-api',
    tool_start_count: 1,
    tool_end_count: 1,
    artifact_retention: {
      output_budget_exhausted: false,
      dropped_oversized_events: 0,
      dropped_budget_events: 0,
    },
  });
});

// Spec: Pi event filter removes thinking blocks and emits clean JSON
// Critical: Thinking blocks must be stripped from both message.content and assistantMessageEvent.partial
test('should filter out thinking blocks from output and write summary', async () => {
  // Behavioral intent: Input has thinking + output_text; output should only keep output_text
  // Expected outcome: Thinking blocks removed; summary has correct counts for both event types
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

test('should compute summary counts and prefer most-used model/api pair', async () => {
  // Spec: Summary must track event counts, model/api frequency, and timestamp bounds
  // Behavioral intent: Model/api selection uses frequency (model-a appears 2x, model-b 1x → select model-a)
  // Expected outcome: summary.selected_model/api match most frequent pair; all event types counted
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

test('should count invalid JSON lines without crashing', async () => {
  // Spec: Malformed JSON should be counted but not cause filter failure
  // Behavioral intent: Parser skips bad lines, continues processing valid JSON
  // Expected outcome: invalid_json_lines = 1; output has 2 valid lines; exit code 0
  // Regression: GH#3678 — Do not crash on invalid JSON; report count
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

test('should summarize provider model availability errors', async () => {
  const message = '404 This model is unavailable for free. The paid version is available now - use this slug instead: z-ai/glm-4.5-air';
  const fixture = [
    JSON.stringify({
      type: 'message',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'z-ai/glm-4.5-air:free',
        stopReason: 'error',
        errorMessage: message,
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toMatchObject({
    type: 'model_unavailable',
    provider: 'openrouter',
    api: 'responses',
    model: 'z-ai/glm-4.5-air:free',
    stop_reason: 'error',
    message,
  });
  expect(result.summary.provider_errors).toHaveLength(1);
});

test('should summarize empty gateway assistant turns with output token usage', async () => {
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:20.000Z',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 13130,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 13258,
        },
        stopReason: 'stop',
        responseId: 'resp_a1fe7b35ddb4479d83fcf572f25829d9',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toMatchObject({
    type: 'provider_empty_assistant_turn',
    provider: 'gateway',
    api: 'openai-responses',
    model: 'auto',
    stop_reason: 'stop',
    response_id: 'resp_a1fe7b35ddb4479d83fcf572f25829d9',
    input_tokens: 13130,
    output_tokens: 128,
    total_tokens: 13258,
  });
  expect(result.summary.primary_provider_error.message).toContain('output tokens but no assistant text or tool calls');
});

test('should track tool reliability metrics in summary', async () => {
  // Spec: Summary must include tool start/end counts and match counts
  // Behavioral intent: Paired tool_execution_start/end are counted; unmatched starts tracked separately
  // Expected outcome: tool_start_count ≥ tool_end_count; match_count = min(starts, ends)
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

test('should include per-tool statistics in summary', async () => {
  // Spec: Summary must track per-tool success/failure counts and rates
  // Behavioral intent: Each unique tool_name gets separate success rate calculation
  // Expected outcome: tool_stats.read_file.total = 2; success_rate_percent = 50
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

test('should track execution time metrics (API vs tool)', async () => {
  // Spec: Summary must calculate total time, tool-only time, and API time separately
  // Behavioral intent: Timestamps from agent_start/end and tool_execution_start/end are summed
  // Expected outcome: execution_time.total_time_seconds = 5; tool_time_seconds = sum of tool durations
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

test('should track token usage metrics from events', async () => {
  // Spec: Summary must aggregate token counts from message_update events
  // Behavioral intent: Prompt, completion, and cache tokens (if present) are summed
  // Expected outcome: token_usage.total_input_tokens = 200; total_output_tokens = 100; cache tracking
  const fixture = [
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        model: 'gemini-3-flash',
        api: 'google',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_tokens_details: {
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 80,
          },
        },
      },
    }),
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        model: 'gemini-pro',
        api: 'google',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
        },
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.token_usage).toBeDefined();
  expect(result.summary.token_usage?.total_input_tokens).toBe(150);
  expect(result.summary.token_usage?.total_output_tokens).toBe(75);
  expect(result.summary.token_usage?.total_cache_creation_tokens).toBe(10);
  expect(result.summary.token_usage?.total_cache_read_tokens).toBe(80);
  expect(result.summary.token_usage?.total_tokens).toBe(315);
  expect(result.summary.inference_health).toMatchObject({
    stream_success: true,
    tool_call_valid: true,
    agent_turn_success: true,
    prompt_token_budget_exceeded: false,
  });
  expect(result.summary.model_reliability['gemini-3-flash']).toMatchObject({
    input_tokens: 100,
    output_tokens: 50,
    observed_error_count: 0,
    observed_success: true,
  });
});

test('writes gateway summary and recommends compaction when token budget is exceeded', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gateway-summary-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'pi-summary.json');
  const previousThreshold = process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD;
  process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD = '100';
  try {
    fs.writeFileSync(inputPath, JSON.stringify({
      type: 'message_end',
      message: { model: 'coding-model', api: 'gateway', usage: { prompt_tokens: 150, completion_tokens: 25 } },
    }) + '\n');
    await runPiEventFilter(inputPath, outputPath, summaryPath);
    const gatewaySummary = JSON.parse(fs.readFileSync(path.join(tmpDir, 'gateway-summary.json'), 'utf8'));
    expect(gatewaySummary).toMatchObject({
      schema_version: 1,
      logical_agent_turns: 1,
      routing_steps: null,
      input_tokens: 150,
      output_tokens: 25,
      inference_health: {
        largest_context_tokens: 150,
        prompt_token_budget_exceeded: true,
        context_compaction_recommended: true,
      },
    });
  } finally {
    if (previousThreshold === undefined) delete process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD;
    else process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD = previousThreshold;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const TOKEN_LEDGER_ENV_KEYS = [
  'KASEKI_INFERENCE_PHASE',
  'KASEKI_INFERENCE_ATTEMPT',
  'KASEKI_INFERENCE_REQUEST_ID',
  'KASEKI_LLM_INPUT_USD_PER_MTOKEN',
  'KASEKI_LLM_CACHE_READ_USD_PER_MTOKEN',
  'KASEKI_LLM_CACHE_WRITE_USD_PER_MTOKEN',
  'KASEKI_LLM_OUTPUT_USD_PER_MTOKEN',
] as const;

function captureTokenLedgerEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(TOKEN_LEDGER_ENV_KEYS.map(key => [key, process.env[key]]));
}

function configureTokenLedgerEnvironment(): void {
  Object.assign(process.env, {
    KASEKI_INFERENCE_PHASE: 'goal-check',
    KASEKI_INFERENCE_ATTEMPT: 'primary-1',
    KASEKI_INFERENCE_REQUEST_ID: 'req-1',
    KASEKI_LLM_INPUT_USD_PER_MTOKEN: '2',
    KASEKI_LLM_CACHE_READ_USD_PER_MTOKEN: '0.5',
    KASEKI_LLM_CACHE_WRITE_USD_PER_MTOKEN: '3',
    KASEKI_LLM_OUTPUT_USD_PER_MTOKEN: '8',
  });
}

function restoreTokenLedgerEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function writeTokenLedgerFixture(inputPath: string): void {
  fs.writeFileSync(inputPath, [
    { type: 'message_update', message: { response_id: 'resp-1', model: 'routed-model', usage: { prompt_tokens: 100, completion_tokens: 10 } } },
    { type: 'message_end', message: { response_id: 'resp-1', model: 'routed-model', usage: { prompt_tokens: 120, completion_tokens: 20 } } },
  ].map(JSON.stringify).join('\n') + '\n');
}

function readTokenLedger(tmpDir: string): Array<Record<string, unknown>> {
  return fs.readFileSync(path.join(tmpDir, 'token-ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
}

test('writes a deduplicated token ledger with phase/request lineage and configured pricing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-token-ledger-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'pi-summary.json');
  const previous = captureTokenLedgerEnvironment();
  configureTokenLedgerEnvironment();
  try {
    writeTokenLedgerFixture(inputPath);
    await runPiEventFilter(inputPath, outputPath, summaryPath);
    await runPiEventFilter(inputPath, outputPath, summaryPath);
    const ledger = readTokenLedger(tmpDir);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ phase: 'goal-check', attempt_id: 'primary-1', request_id: 'req-1', response_id: 'resp-1', context_tokens: 120, estimated_cost_usd: 0.0004 });
  } finally {
    restoreTokenLedgerEnvironment(previous);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('does not recommend compaction solely from aggregate usage across small turns', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-context-budget-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'pi-summary.json');
  const previousThreshold = process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD;
  process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD = '100';
  try {
    fs.writeFileSync(inputPath, [
      { type: 'message_end', message: { response_id: 'turn-1', model: 'coding-model', api: 'gateway', usage: { prompt_tokens: 75, completion_tokens: 10 } } },
      { type: 'message_end', message: { response_id: 'turn-2', model: 'coding-model', api: 'gateway', usage: { prompt_tokens: 75, completion_tokens: 10 } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await runPiEventFilter(inputPath, outputPath, summaryPath);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    expect(summary.token_usage?.total_input_tokens).toBe(150);
    expect(summary.inference_health).toMatchObject({
      largest_context_tokens: 75,
      prompt_token_budget_exceeded: false,
      context_compaction_recommended: false,
    });
    expect(summary.phase_budget).toMatchObject({
      enforcement: 'soft_target',
      exceeded: false,
    });
  } finally {
    if (previousThreshold === undefined) delete process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD;
    else process.env.KASEKI_PROMPT_TOKEN_WARN_THRESHOLD = previousThreshold;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('uses final per-response usage instead of summing repeated stream events', async () => {
  const fixture = [
    { type: 'message_update', message: { response_id: 'same-response', model: 'coding-model', usage: { prompt_tokens: 100, completion_tokens: 10 } } },
    { type: 'message_end', message: { response_id: 'same-response', model: 'coding-model', usage: { prompt_tokens: 120, completion_tokens: 20 } } },
  ];
  const result = await runFilter(fixture.map(JSON.stringify));

  expect(result.summary.token_usage).toMatchObject({
    total_input_tokens: 120,
    total_output_tokens: 20,
    total_tokens: 140,
  });
  expect(result.summary.completion_usage).toHaveLength(1);
});

test('should provide per-model token statistics', async () => {
  // Spec: Summary must track token usage broken down by model
  // Behavioral intent: Each model gets separate input/output token accounting
  // Expected outcome: model_token_stats indexed by model name with input/output tokens
  const fixture = [
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        model: 'gemini-3-flash',
        api: 'google',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
      },
    }),
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-01-01T00:00:01.000Z',
      message: {
        model: 'gemini-pro',
        api: 'google',
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
        },
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.model_token_stats).toBeDefined();
  expect(result.summary.model_token_stats?.['gemini-3-flash']).toBeDefined();
  expect(result.summary.model_token_stats?.['gemini-3-flash'].input_tokens).toBe(100);
  expect(result.summary.model_token_stats?.['gemini-3-flash'].output_tokens).toBe(50);
  expect(result.summary.model_token_stats?.['gemini-pro'].input_tokens).toBe(50);
  expect(result.summary.model_token_stats?.['gemini-pro'].output_tokens).toBe(25);
});

// ====================================================================
// Provider Error Retryability Classification Tests (Phase 1)
// ====================================================================
test('should classify 404 model_unavailable as non-retryable', async () => {
  // Spec: 404 errors indicate permanent model unavailability
  // Expected: retryable = false (do not retry)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'z-ai/glm-4.5-air:free',
        stopReason: 'error',
        errorMessage: '404 This model is unavailable for free.',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.type).toBe('model_unavailable');
  expect(result.summary.primary_provider_error?.retryable).toBe(false);
  expect(result.summary.primary_provider_error?.message).toContain('404');
});

test('should classify 503 provider_error as retryable', async () => {
  // Spec: 503 Service Unavailable indicates transient provider issue
  // Expected: retryable = true (retry should help)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'openai/gpt-4',
        stopReason: 'error',
        errorMessage: '503 Service Unavailable',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.retryable).toBe(true);
});

test('should classify 429 rate limit as retryable', async () => {
  // Spec: 429 Too Many Requests indicates quota exhaustion (transient)
  // Expected: retryable = true (retry after backoff should help)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'anthropic/claude-opus',
        stopReason: 'error',
        errorMessage: '429 Rate Limited',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.retryable).toBe(true);
});

test('should classify connection errors as retryable', async () => {
  // Spec: Connection errors (ECONNRESET, timeout, etc.) indicate transient network issue
  // Expected: retryable = true (retry should help as connection may recover)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'openai/gpt-4',
        stopReason: 'error',
        errorMessage: 'ECONNRESET',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.retryable).toBe(true);
});

test('should classify model_unavailable text pattern as retryable', async () => {
  // Spec: "model is unavailable" pattern from provider indicates potential transience
  // Expected: retryable = true (model might become available shortly)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'mistral/mistral-medium',
        stopReason: 'error',
        errorMessage: 'The model is unavailable',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.type).toBe('model_unavailable');
  expect(result.summary.primary_provider_error?.retryable).toBe(true);
});

test('should classify deprecated model (404) as non-retryable even with model_unavailable text', async () => {
  // Spec: When 404 appears with "deprecated", it's permanent unavailability
  // Expected: retryable = false (no point in retrying)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'openai/gpt-3.5-turbo',
        stopReason: 'error',
        errorMessage: '404 Model has been deprecated and is unavailable.',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.retryable).toBe(false);
});

test('should classify timeout errors as retryable', async () => {
  // Spec: Timeouts indicate transient issues with provider responsiveness
  // Expected: retryable = true (retry might succeed if provider recovers)
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        provider: 'openrouter',
        api: 'responses',
        model: 'openai/gpt-4',
        stopReason: 'error',
        errorMessage: 'timeout connecting to provider',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error).toBeDefined();
  expect(result.summary.primary_provider_error?.retryable).toBe(true);
});

test('should NOT flag streaming response as empty when content is in fallback sources (message.text)', async () => {
  // Spec: Streaming responses may have deltas accumulated in message.text instead of message.content[]
  // Scenario: openai-responses handler receives SSE deltas but populates message.text instead of building message.content[]
  // Expected: Should NOT detect as provider_empty_assistant_turn since message.text has content
  // Regression: GH#STREAMING-001 — Empty assistant turn incorrectly detected for streaming responses
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:20.000Z',
      message: {
        role: 'assistant',
        content: [],  // Empty content array (delta accumulation incomplete)
        text: '{"response": "streaming response accumulated here"}',  // Fallback: content in text field
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 1000,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1128,
        },
        stopReason: 'stop',
        responseId: 'resp_test123',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  // Should NOT have a provider_empty_assistant_turn error
  expect(result.summary.primary_provider_error?.type).not.toBe('provider_empty_assistant_turn');
});

test('should NOT flag streaming response as empty when content is in fallback sources (message.output_text)', async () => {
  // Spec: Alternative fallback for streaming responses
  // Scenario: message.output_text contains accumulated content instead of message.content[]
  // Expected: Should NOT detect as provider_empty_assistant_turn
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:21.000Z',
      message: {
        role: 'assistant',
        content: [],  // Empty (delta accumulation incomplete)
        output_text: 'Assistant response content accumulated via streaming deltas',  // Fallback source
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 1500,
          output: 256,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1756,
        },
        stopReason: 'stop',
        responseId: 'resp_test456',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  // Should NOT have a provider_empty_assistant_turn error
  expect(result.summary.primary_provider_error?.type).not.toBe('provider_empty_assistant_turn');
});

test('should NOT flag streaming response as empty when prior message_update carries text for same response', async () => {
  const fixture = [
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-06-23T10:32:21.100Z',
      assistantMessageEvent: {
        type: 'text_delta',
        partial: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Visible text from response.output_text.delta' }],
          api: 'openai-responses',
          provider: 'gateway',
          model: 'auto',
          responseId: 'resp_stream_state',
        },
      },
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Visible text from response.output_text.delta' }],
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        responseId: 'resp_stream_state',
      },
    }),
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:22.000Z',
      message: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 2000,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2128,
        },
        stopReason: 'stop',
        responseId: 'resp_stream_state',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error?.type).not.toBe('provider_empty_assistant_turn');
});

test('should still flag streaming response as empty when prior message_update is whitespace only', async () => {
  const fixture = [
    JSON.stringify({
      type: 'message_update',
      timestamp: '2026-06-23T10:32:21.100Z',
      assistantMessageEvent: {
        type: 'text_delta',
        partial: {
          role: 'assistant',
          content: [{ type: 'text', text: '\n\n' }],
          api: 'openai-responses',
          provider: 'gateway',
          model: 'auto',
          responseId: 'resp_whitespace_state',
        },
      },
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '\n\n' }],
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        responseId: 'resp_whitespace_state',
      },
    }),
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:22.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: '\n\n' }],
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 2000,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2128,
        },
        stopReason: 'stop',
        responseId: 'resp_whitespace_state',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  expect(result.summary.primary_provider_error?.type).toBe('provider_empty_assistant_turn');
});

test('should STILL flag empty response when ALL sources are empty (true empty turn)', async () => {
  // Spec: Verify that legitimate empty responses are still caught
  // Scenario: message.content empty AND message.text empty AND message.output_text missing → true empty
  // Expected: SHOULD detect as provider_empty_assistant_turn (all fallbacks exhausted)
  // Regression: Ensure defensive fix doesn't mask real empty responses
  const fixture = [
    JSON.stringify({
      type: 'message_end',
      timestamp: '2026-06-23T10:32:22.000Z',
      message: {
        role: 'assistant',
        content: [],  // Empty
        text: '',      // Empty
        // output_text is missing entirely
        api: 'openai-responses',
        provider: 'gateway',
        model: 'auto',
        usage: {
          input: 2000,
          output: 128,  // Tokens produced but no content
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2128,
        },
        stopReason: 'stop',
        responseId: 'resp_empty123',
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.exitCode).toBe(0);
  // SHOULD have provider_empty_assistant_turn error (legitimate empty response)
  expect(result.summary.primary_provider_error?.type).toBe('provider_empty_assistant_turn');
});

test('records one provider usage ledger entry per response and tool-output pressure', async () => {
  const fixture = [
    JSON.stringify({
      type: 'tool_execution_end',
      tool_name: 'read',
      result: 'x'.repeat(40),
      message: { model: 'gateway-model', api: 'openai-completions' },
    }),
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant', model: 'gateway-model', responseId: 'resp-usage',
        usage: { input: 120, output: 30, cacheRead: 40, cacheWrite: 10 },
      },
    }),
    // Streaming implementations can repeat cumulative usage on a final event.
    JSON.stringify({
      type: 'message_end',
      message: {
        role: 'assistant', model: 'gateway-model', responseId: 'resp-usage',
        usage: { input: 120, output: 30, cacheRead: 40, cacheWrite: 10 },
      },
    }),
  ];

  const result = await runFilter(fixture);
  expect(result.summary.completion_usage).toEqual([expect.objectContaining({
    response_id: 'resp-usage', input_tokens: 120, output_tokens: 30,
    cache_read_tokens: 40, cache_creation_tokens: 10, total_tokens: 200,
  })]);
  expect(result.summary.tool_output_usage).toEqual(expect.objectContaining({
    total_results: 1, total_bytes: 40, estimated_tokens: 10,
    by_tool: { read: { results: 1, bytes: 40, estimated_tokens: 10 } },
  }));
});

test('accepts camelCase and snake_case response IDs, preferring the first string value', async () => {
  const result = await runFilter(responseIdFixture());
  expect(result.summary.completion_usage.map((usage: { response_id: string }) => usage.response_id)).toEqual([
    'camel-id',
    'snake-only-id',
    'snake-fallback-id',
  ]);
});
