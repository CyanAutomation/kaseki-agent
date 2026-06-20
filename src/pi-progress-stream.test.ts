/**
 * Tests for the pi-progress-stream executable behavior that callers depend on.
 */

import { describe, it, expect } from '@jest/globals';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface ProgressEvent {
  stage: string;
  message: string;
  type?: string;
  counts?: Record<string, number>;
  toolStartCount?: number;
  toolEndCount?: number;
  messageUpdateCount?: number;
  toolBatchSummary?: Record<string, number>;
}

const repoRoot = process.cwd();
const streamScript = path.join(repoRoot, 'src', 'pi-progress-stream.ts');

function readJsonl(filePath: string): ProgressEvent[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProgressEvent);
}

async function runProgressStream(inputLines: string[], env: NodeJS.ProcessEnv = {}): Promise<{
  events: ProgressEvent[];
  log: string;
  stdout: string;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-progress-stream-'));
  const progressJsonlPath = path.join(tmpDir, 'progress.jsonl');
  const progressLogPath = path.join(tmpDir, 'progress.log');
  let stdout = '';

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', streamScript, progressJsonlPath, progressLogPath],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            KASEKI_STREAM_PROGRESS: '0',
            ...env,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`pi-progress-stream exited with ${code}: ${stderr}`));
        }
      });

      for (const line of inputLines) {
        child.stdin.write(`${line}\n`);
      }
      child.stdin.end();
    });

    return {
      events: readJsonl(progressJsonlPath),
      log: fs.existsSync(progressLogPath) ? fs.readFileSync(progressLogPath, 'utf8') : '',
      stdout,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('pi-progress-stream executable', () => {
  it('writes start and final events when the input stream closes', async () => {
    const { events, log } = await runProgressStream([]);

    expect(events[0]).toMatchObject({
      stage: 'pi agent',
      message: 'started',
    });
    expect(events.at(-1)).toMatchObject({
      stage: 'pi agent',
      counts: {},
      toolStartCount: 0,
      toolEndCount: 0,
      messageUpdateCount: 0,
    });
    expect(events.at(-1)?.message).toContain('event stream ended');
    expect(log).toContain('[progress] pi agent: started');
  });

  it('summarizes repeated tool activity through the progress stream output', async () => {
    const thinkingEvents = Array.from({ length: 15 }, (_, index) =>
      JSON.stringify({
        type: 'message_update',
        message: {
          content: `Investigating authentication middleware and route validation step ${index + 1}`,
        },
      })
    );

    const { events, stdout, log } = await runProgressStream(
      [
        JSON.stringify({ type: 'agent_start' }),
        JSON.stringify({
          type: 'tool_execution_start',
          tool_name: 'read_file',
          input: { path: 'src/auth/session.ts' },
        }),
        JSON.stringify({
          type: 'tool_execution_start',
          tool_name: 'read_file',
          input: { path: 'src/auth/routes.ts' },
        }),
        JSON.stringify({
          type: 'toolcall_start',
          call: { name: 'bash' },
          arguments: { command: 'npm test -- --runInBand src/auth/session.test.ts' },
        }),
        JSON.stringify({ type: 'tool_execution_end', tool_name: 'read_file' }),
        JSON.stringify({
          type: 'tool_execution_start',
          toolName: 'read_file',
          input: { path: 'src/auth/session.test.ts' },
        }),
        JSON.stringify({
          type: 'toolcall_start',
          tool: { name: 'bash' },
          arguments: { command: 'npm run type-check' },
        }),
        ...thinkingEvents,
        JSON.stringify({ type: 'auto_retry_start' }),
        JSON.stringify({ type: 'auto_retry_end' }),
        JSON.stringify({ type: 'agent_end' }),
      ],
      { KASEKI_STREAM_PROGRESS: '1' }
    );

    const batchEvents = events.filter((event) => event.stage === 'pi tool batch');
    expect(batchEvents).toHaveLength(1);
    expect(batchEvents[0]?.message).toEqual(
      expect.stringMatching(/^\[tools\] read_file \(3x\), bash \(2x\) \(\d+s\)$/)
    );
    expect(batchEvents[0]?.toolBatchSummary).toEqual({
      read_file: 3,
      bash: 2,
    });
    expect(stdout).toContain('[progress] pi tool batch: [tools] read_file (3x), bash (2x)');
    expect(log).toContain('[progress] pi agent: agent finished');

    const messageSummary = events.find(
      (event) => event.stage === 'pi agent' && event.type === 'message_update'
    );
    expect(messageSummary?.message).toContain('Validation step 15');

    const finalEvent = events.at(-1);
    expect(finalEvent?.message).toContain('event stream ended');
    expect(finalEvent).toMatchObject({
      counts: {
        agent_start: 1,
        tool_execution_start: 3,
        toolcall_start: 2,
        tool_execution_end: 1,
        message_update: 15,
        auto_retry_start: 1,
        auto_retry_end: 1,
        agent_end: 1,
      },
      toolStartCount: 5,
      toolEndCount: 1,
      messageUpdateCount: 15,
    });
  });

  it('suppresses tool batch summaries when progress summarization is disabled', async () => {
    const { events } = await runProgressStream(
      [
        JSON.stringify({ type: 'tool_execution_start', tool_name: 'bash' }),
        JSON.stringify({ type: 'agent_end' }),
      ],
      { KASEKI_PROGRESS_SUMMARIZATION: '0' }
    );

    expect(events.some((event) => event.stage === 'pi tool batch')).toBe(false);
    expect(events.at(-1)).toMatchObject({
      counts: {
        tool_execution_start: 1,
        agent_end: 1,
      },
      toolStartCount: 1,
    });
  });

  it('counts invalid JSON and continues processing subsequent events', async () => {
    const { events } = await runProgressStream([
      '{not json',
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'message_update', message: { content: 'short' } }),
    ]);

    expect(events).toContainEqual(
      expect.objectContaining({
        stage: 'pi agent',
        message: 'agent started',
        type: 'agent_start',
      })
    );
    expect(events.at(-1)).toMatchObject({
      counts: {
        invalid_json: 1,
        agent_start: 1,
        message_update: 1,
      },
      messageUpdateCount: 1,
    });
  });
});
