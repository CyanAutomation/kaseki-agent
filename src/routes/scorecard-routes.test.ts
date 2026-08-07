import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createScorecardRoutes } from './scorecard-routes';
import { ResultCache } from '../result-cache';
import { buildScorecard, collectEvidence, normalizeConfig } from '../run-scorecard';

async function get(app: express.Express, url: string): Promise<{status:number;body:any;text:string}> {
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  try { const address=server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const response=await fetch(`http://127.0.0.1:${address.port}${url}`); const text=await response.text();
    let body: any={}; try { body=JSON.parse(text); } catch { /* markdown */ }
    return {status:response.status,body,text};
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
}

function fixture(status: 'running'|'completed' = 'completed') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-route-'));
  const card = buildScorecard(collectEvidence({ json: { 'metadata.json': { instance:'kaseki-1', status, started_at:'2026-08-07T00:00:00.000Z', ended_at: status === 'completed' ? '2026-08-07T00:01:00.000Z' : undefined } }, text:{}, summaries:[] }), normalizeConfig({}), new Date('2026-08-07T00:02:00.000Z'));
  const job = { id:'kaseki-1', status, request:{repoUrl:'https://github.com/acme/repo',ref:'main'}, createdAt:new Date(), resultDir:dir, finalized:status === 'completed' };
  const scheduler = { getJob:(id:string)=>id === job.id ? job : undefined, listJobs:()=>[job] };
  const app=express(); app.use(createScorecardRoutes(scheduler as any,new ResultCache()));
  return { app,dir,card };
}

describe('scorecard routes', () => {
  test('returns canonical JSON and PR-format Markdown', async () => {
    const {app,dir,card}=fixture(); fs.writeFileSync(path.join(dir,'run-scorecard.json'),JSON.stringify(card));
    expect((await get(app,'/runs/kaseki-1/scorecard')).body.run_id).toBe('kaseki-1');
    const markdown=await get(app,'/runs/kaseki-1/scorecard?format=markdown');
    expect(markdown.status).toBe(200); expect(markdown.text).toContain('**Overall:**');
  });
  test('distinguishes unknown, pending, unavailable, and malformed artifacts', async () => {
    const completed=fixture(); expect((await get(completed.app,'/runs/missing/scorecard')).status).toBe(404);
    expect((await get(completed.app,'/runs/kaseki-1/scorecard')).status).toBe(404);
    const running=fixture('running'); expect((await get(running.app,'/runs/kaseki-1/scorecard')).status).toBe(409);
    fs.writeFileSync(path.join(completed.dir,'run-scorecard.json'),'{bad');
    expect((await get(completed.app,'/runs/kaseki-1/scorecard')).status).toBe(422);
  });
  test('lists bounded compact summaries and filters grade', async () => {
    const {app,dir,card}=fixture(); fs.writeFileSync(path.join(dir,'run-scorecard.json'),JSON.stringify(card));
    const response=await get(app,`/scorecards?grade=${card.grade}&limit=500`);
    expect(response.status).toBe(200); expect(response.body.pagination.limit).toBe(100);
    expect(response.body.scorecards[0]).not.toHaveProperty('dimensions');
  });
  test('reports another page only when an additional match exists', async () => {
    const first=fixture(); fs.writeFileSync(path.join(first.dir,'run-scorecard.json'),JSON.stringify(first.card));
    const jobs = [
      { ...first.card, run_id: 'kaseki-1' },
      { ...first.card, run_id: 'kaseki-2' },
      { ...first.card, run_id: 'kaseki-3' },
    ].map(card => {
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scorecard-page-'));
      fs.writeFileSync(path.join(dir,'run-scorecard.json'),JSON.stringify(card));
      return { id:card.run_id,status:'completed',request:{repoUrl:'https://github.com/acme/repo',ref:'main'},
        createdAt:new Date(),resultDir:dir,finalized:true };
    });
    const scheduler={ getJob:()=>undefined,listJobs:()=>jobs };
    const app=express(); app.use(createScorecardRoutes(scheduler as any,new ResultCache()));

    const fullPage=await get(app,'/scorecards?limit=2');
    expect(fullPage.body.pagination).toMatchObject({ returned:2,hasMore:true });
    const lastPage=await get(app,'/scorecards?limit=2&offset=2');
    expect(lastPage.body.pagination).toMatchObject({ returned:1,hasMore:false });
  });
});
