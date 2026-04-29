import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function readRssKb(pid: number): number | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
  } catch {
    return null;
  }
}

describe('pi-event-filter stress test', () => {
  test('stress run completes and keeps memory bounded', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-'));
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

      const child = spawn(process.execPath, [
        path.join(__dirname, '..', 'dist', 'pi-event-filter.js'),
        inputPath,
        outputPath,
        summaryPath,
      ]);

      let peakRssKb = 0;
      const sample = setInterval(() => {
        if (child.exitCode !== null) return;
        const rssKb = readRssKb(child.pid!);
        if (rssKb !== null) peakRssKb = Math.max(peakRssKb, rssKb);
      }, 20);

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      clearInterval(sample);

      expect(exitCode).toBe(0);

      const lines = fs
        .readFileSync(outputPath, 'utf8')
        .trim()
        .split('\n');
      expect(lines).toHaveLength(expectedKept);

      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      expect(summary.tool_start_count + summary.tool_end_count).toBe(
        totalEvents
      );
      expect(summary.invalid_json_lines).toBe(0);
      expect(summary.selected_model).toBe('pi-stress-model');
      expect(summary.selected_api).toBe('pi-stress-api');

      if (peakRssKb > 0) {
        const memoryMb = peakRssKb / 1024;
        expect(memoryMb).toBeLessThan(350);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 120000); // 2 minute timeout for this intensive test
});
