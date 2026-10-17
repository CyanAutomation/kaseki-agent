import { ReadableStream } from 'node:stream/web';
import type { SoyuzAdapterConfig } from './config';
import { SoyuzSubmissionClient } from './SoyuzSubmissionClient';

function makeClient(fetchImpl: typeof fetch): SoyuzSubmissionClient {
  const config: SoyuzAdapterConfig = {
    enabled: false,
    submissionEnabled: true,
    submissionApiToken: 'soyuz-submission-token-123456',
    apiUrl: 'https://soyuz.example.test',
    workerApiToken: 'soyuz-worker-token-123456',
    accountId: '',
    queueId: '',
    queueApiToken: '',
    workerId: '',
    pollIntervalMs: 5_000,
    batchSize: 1,
    visibilityTimeoutMs: 120_000,
    requestTimeoutMs: 20_000,
    cancellationPollIntervalMs: 15_000,
    heartbeatIntervalMs: 60_000,
  };
  return new SoyuzSubmissionClient(config, fetchImpl);
}

describe('SoyuzSubmissionClient', () => {
  test('cancels an oversized streamed response at the byte limit', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(128 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    }));
    const fetchImpl = jest.fn(async () => response) as unknown as typeof fetch;
    const client = makeClient(fetchImpl);

    await expect(client.getWorkerRun('11111111-1111-4111-8111-111111111111'))
      .rejects.toThrow('Soyuz response exceeded the 128 KB client limit');
    expect(cancelled).toBe(true);
  });
});
