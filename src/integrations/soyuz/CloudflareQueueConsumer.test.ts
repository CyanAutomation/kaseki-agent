import { CloudflareQueueConsumer } from './CloudflareQueueConsumer';
import type { SoyuzAdapterConfig } from './config';

const config: SoyuzAdapterConfig = {
  enabled: true,
  apiUrl: 'https://soyuz.example.test',
  workerApiToken: 'soyuz-worker-secret',
  accountId: '0123456789abcdef0123456789abcdef',
  queueId: 'queue-id',
  queueApiToken: 'cloudflare-queue-secret',
  workerId: 'host-a',
  pollIntervalMs: 5_000,
  batchSize: 2,
  visibilityTimeoutMs: 120_000,
  requestTimeoutMs: 20_000,
  cancellationPollIntervalMs: 15_000,
  heartbeatIntervalMs: 60_000,
};

describe('Cloudflare HTTP pull consumer', () => {
  test('uses the documented pull fields and lease response shape', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      success: true,
      result: { messages: [{ body: '{"runId":"external"}', id: 'ephemeral', timestamp_ms: 123, attempts: 1, lease_id: 'lease' }] },
    }), { headers: { 'content-type': 'application/json' } }));
    const queue = new CloudflareQueueConsumer(config, fetchImpl as typeof fetch);

    await expect(queue.pull(1)).resolves.toEqual([{
      body: '{"runId":"external"}',
      id: 'ephemeral',
      timestamp_ms: 123,
      attempts: 1,
      lease_id: 'lease',
    }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/messages/pull');
    expect(JSON.parse(String(init.body))).toEqual({ visibility_timeout_ms: 120_000, batch_size: 1 });
    expect(init.headers).toMatchObject({ authorization: 'Bearer cloudflare-queue-secret' });
  });

  test('acks and retries transient leases with the documented payload', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ success: true, result: {} })));
    const queue = new CloudflareQueueConsumer(config, fetchImpl as typeof fetch);

    await queue.acknowledge('lease-1');
    await queue.retry('lease-2', 30);

    const acknowledgement = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    const retry = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
    expect(acknowledgement).toEqual({ acks: [{ lease_id: 'lease-1' }], retries: [] });
    expect(retry).toEqual({ acks: [], retries: [{ lease_id: 'lease-2', delay_seconds: 30 }] });
  });

  test('preserves Cloudflare Retry-After for the adapter backoff', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      success: false,
      errors: [{ message: 'rate limited' }],
    }), { status: 429, headers: { 'retry-after': '17' } }));
    const queue = new CloudflareQueueConsumer(config, fetchImpl as typeof fetch);

    await expect(queue.pull(1)).rejects.toMatchObject({ status: 429, retryAfterSeconds: 17 });
  });
});
