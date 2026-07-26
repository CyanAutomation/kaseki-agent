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
});
