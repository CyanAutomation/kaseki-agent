import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const runPerf =
  process.env.RUN_PI_EVENT_FILTER_PERF === '1' ||
  process.env.CI_NIGHTLY === '1' ||
  process.env.PERF_TESTS === '1';
const describePerf = runPerf ? describe : describe.skip;

describePerf('pi-event-filter perf/stress suite', () => {
  test('200k event run completes with environment-tuned memory threshold', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-perf-'));
    const inputPath = path.join(tmpDir, 'in.jsonl');
    const outputPath = path.join(tmpDir, 'out.jsonl');
    const summaryPath = path.join(tmpDir, 'summary.json');

    try {
      const totalEvents = 200_000;
      const filteredEvery = 5;
      const expectedKept = totalEvents - Math.floor(totalEvents / filteredEvery);

      const input = fs.createWriteStream(inputPath, { encoding: 'utf8' });
      for (let i = 0; i < totalEvents; i++) {
        const filtered = i % filteredEvery === 0;
        const event = {
          type: i % 2 === 0 ? 'tool_execution_start' : 'tool_execution_end',
          timestamp: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
          message: { model: 'pi-stress-model', api: 'pi-stress-api' },
          assistantMessageEvent: {
            type: filtered ? 'thinking_delta' : 'output_delta',
            partial: {
              timestamp: `2026-01-01T00:00:${String((i + 1) % 60).padStart(2, '0')}.000Z`,
              content: [
                { type: 'thinking', text: 'internal note' },
                { type: 'output_text', text: `event-${i}` },
              ],
            },
          },
        };
        const canContinue = input.write(`${JSON.stringify(event)}\n`);
        if (!canContinue) {
          await new Promise<void>((resolve) => input.once('drain', resolve));
        }
      }
      await new Promise<void>((resolve) => input.end(resolve));

      const script = [
        path.join(__dirname, '..', 'dist', 'pi-event-filter.js'),
        inputPath,
        outputPath,
        summaryPath,
      ];

      const child = spawn(process.execPath, script, {
        env: { ...process.env, PI_EVENT_FILTER_TRACK_RSS: '1' },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });

      expect(exitCode).toBe(0);

      const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(expectedKept);

      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      expect(summary.tool_start_count + summary.tool_end_count).toBe(totalEvents);
      expect(summary.invalid_json_lines).toBe(0);
      expect(summary.selected_model).toBe('pi-stress-model');
      expect(summary.selected_api).toBe('pi-stress-api');

      const maxRssMatch = stderr.match(/MAX_RSS_BYTES=(\d+)/);
      expect(maxRssMatch).not.toBeNull();
      if (!maxRssMatch) return;

      const memoryMb = Number.parseInt(maxRssMatch[1], 10) / (1024 * 1024);

      // Threshold guidance:
      // - default (developer laptops/unknown CI): loose guardrail for regressions
      // - nightly perf workers: tighter budget to track drift
      const thresholdMb = process.env.CI_NIGHTLY === '1' ? 450 : 800;
      expect(memoryMb).toBeLessThan(thresholdMb);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120000);
});
