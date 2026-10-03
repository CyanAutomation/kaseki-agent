import express from 'express';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createImprovementRoutes } from './improvement-routes';

describe('improvements cursor pagination', () => {
  test('pages stable terminal run summaries across retained history', async () => {
    const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'improvement-cursor-'));
    const jobs = ['kaseki-3', 'kaseki-2', 'kaseki-1'].map((id, index) => ({
      id,
      status: 'completed' as const,
      createdAt: new Date(`2026-08-0${3 - index}T00:00:00.000Z`),
      request: { repoUrl: 'https://github.com/org/repo', ref: 'main' },
    }));
    const scheduler = { listJobs: () => jobs, listAllJobs: async () => jobs };
    const app = express();
    app.use(createImprovementRoutes(scheduler as any, { resultsDir } as any));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as { port: number };
    try {
      const first = await fetch(`http://127.0.0.1:${address.port}/improvements?limit=1`);
      const firstBody = await first.json() as any;
      expect(firstBody.runs.map((run: any) => run.id)).toEqual(['kaseki-3']);
      expect(firstBody.totalRuns).toBe(3);
      expect(firstBody.hasMore).toBe(true);
      const second = await fetch(`http://127.0.0.1:${address.port}/improvements?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`);
      const secondBody = await second.json() as any;
      expect(secondBody.runs.map((run: any) => run.id)).toEqual(['kaseki-2']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(resultsDir, { recursive: true, force: true });
    }
  });
});
