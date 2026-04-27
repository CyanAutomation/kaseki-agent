#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

function readRssKb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (!match) return null;
    return Number.parseInt(match[1], 10);
  } catch {
    return null;
  }
}

test('pi-event-filter stress run completes and keeps memory bounded', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'summary.json');

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
    input.write(`${JSON.stringify(event)}\n`);
  }
  await new Promise((resolve) => input.end(resolve));

  const child = spawn(process.execPath, [path.join(__dirname, 'pi-event-filter.js'), inputPath, outputPath, summaryPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let peakRssKb = 0;
  const sample = setInterval(() => {
    const rssKb = readRssKb(child.pid);
    if (rssKb !== null) peakRssKb = Math.max(peakRssKb, rssKb);
  }, 20);

  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  clearInterval(sample);

  assert.equal(
    exitCode,
    0,
    `pi-event-filter exited with ${exitCode}\nstdout:\n${Buffer.concat(stdout).toString('utf8')}\nstderr:\n${Buffer.concat(stderr).toString('utf8')}`
  );

  const lines = fs.readFileSync(outputPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, expectedKept);

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.tool_start_count + summary.tool_end_count, totalEvents);
  assert.equal(summary.invalid_json_lines, 0);
  assert.equal(summary.selected_model, 'pi-stress-model');
  assert.equal(summary.selected_api, 'pi-stress-api');

  if (peakRssKb > 0) {
    assert.ok(
      peakRssKb < 350 * 1024,
      `Expected peak RSS under 350MB, got ${(peakRssKb / 1024).toFixed(1)}MB`
    );
  }
});
