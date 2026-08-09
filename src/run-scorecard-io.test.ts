import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArtifactSnapshot } from './run-scorecard-io';

describe('readArtifactSnapshot', () => {
  test('prefers the canonical per-response token ledger over phase rollups', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-ledger-'));
    try {
      fs.writeFileSync(path.join(directory, 'all-phase-summaries.json'), JSON.stringify({
        phases: [{ phase: 'coding', request_id: 'rollup', usage: { input: 999 } }],
      }));
      fs.writeFileSync(path.join(directory, 'token-ledger.jsonl'), `${JSON.stringify({
        phase: 'coding', request_id: 'request-1', response_id: 'response-1', turn: 1,
        input_tokens: 12, output_tokens: 3, cache_read_tokens: 100, cache_creation_tokens: 0,
      })}\n`);

      expect(readArtifactSnapshot(directory).summaries).toEqual([expect.objectContaining({
        response_id: 'response-1', input_tokens: 12, cache_read_tokens: 100,
      })]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
