import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface RunResult {
  exitCode: number | null;
  lines: string[];
  summary: any;
}

export async function runFilter(inputLines: string[]): Promise<RunResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-event-filter-fast-'));
  const inputPath = path.join(tmpDir, 'in.jsonl');
  const outputPath = path.join(tmpDir, 'out.jsonl');
  const summaryPath = path.join(tmpDir, 'summary.json');

  try {
    fs.writeFileSync(inputPath, `${inputLines.join('\n')}\n`, 'utf8');

    let stderrOutput = '';
    const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const child = spawn(tsxBin, [
      path.join(process.cwd(), 'src', 'pi-event-filter.ts'),
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
