import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { KasekiApiClient } from './kaseki-api-client';

describe('KasekiApiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preserves the stage reported by the status endpoint', async () => {
    const response = {
      id: 'run-123',
      status: 'running',
      progress: {
        stage: 'reporting back',
        message: 'Publishing results',
        source: 'progress.jsonl',
      },
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new KasekiApiClient('http://localhost:8080', 'api-key');

    await expect(client.getStatus('run-123')).resolves.toMatchObject({
      progress: {
        stage: 'reporting back',
      },
    });
  });

  it('preserves failure diagnosis and validated runner image metadata from status', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'run-123',
      status: 'failed',
      failureClass: 'worker-container-startup',
      error: 'Worker image could not start.',
      diagnosticSummary: { primaryReason: 'Worker image could not start.', recommendedEntryPoint: 'failure.json' },
      runner: { imageReference: 'ghcr.io/cyan/kaseki-runner:1.159.1', imageId: `sha256:${'a'.repeat(64)}` },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const client = new KasekiApiClient('http://localhost:8080', 'api-key');

    await expect(client.getStatus('run-123')).resolves.toMatchObject({
      error: 'Worker image could not start.',
      diagnosticSummary: { primaryReason: 'Worker image could not start.' },
      runner: { imageReference: 'ghcr.io/cyan/kaseki-runner:1.159.1', imageId: `sha256:${'a'.repeat(64)}` },
    });
  });

  it('validates scorecard list summaries', async () => {
    const response = {
      scorecards: [{
        runId: 'run-123', lifecycleStatus: 'completed', overallScore: 'not-a-number', grade: 'A',
        rubricVersion: '1.0.0', completeness: 'complete', confidence: 100,
        startedAt: '2026-08-07T00:00:00.000Z', endedAt: '2026-08-07T00:01:00.000Z',
        scoredAt: '2026-08-07T00:02:00.000Z',
      }],
      pagination: { limit: 25, offset: 0, returned: 1, hasMore: false },
      filters: {},
    };
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    const client = new KasekiApiClient('http://localhost:8080', 'api-key');

    await expect(client.listScorecards()).rejects.toThrow();
  });
});
