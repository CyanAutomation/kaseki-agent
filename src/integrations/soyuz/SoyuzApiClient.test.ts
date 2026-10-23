import { SoyuzApiClient } from './SoyuzApiClient';
import { MAX_SOYUZ_ARTIFACT_BYTES, loadSoyuzArtifacts } from './soyuz-artifacts';
import type { SoyuzAdapterConfig } from './config';

const config: SoyuzAdapterConfig = {
  enabled: true,
  apiUrl: 'https://soyuz.example.test',
  workerApiToken: 'worker-secret',
  accountId: '0123456789abcdef0123456789abcdef',
  queueId: 'queue-id',
  queueApiToken: 'queue-secret',
  workerId: 'host-1',
  pollIntervalMs: 5_000,
  batchSize: 1,
  visibilityTimeoutMs: 120_000,
  requestTimeoutMs: 10_000,
  cancellationPollIntervalMs: 15_000,
  heartbeatIntervalMs: 60_000,
};

describe('Soyuz artifact upload', () => {
  test('uses the authenticated binary worker endpoint with the required metadata', async () => {
    const fetchImpl = jest.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify({ data: { id: 'artifact-id' } }), { status: 201 }));
    const client = new SoyuzApiClient(config, fetchImpl as typeof fetch);
    const artifact = {
      artifactId: '55555555-5555-5555-8555-555555555555',
      name: 'result-summary.md',
      kind: 'report' as const,
      contentType: 'text/markdown; charset=utf-8',
      body: Buffer.from('# Complete\n'),
    };

    await client.uploadArtifact(
      '11111111-1111-4111-8111-111111111111',
      'host-1',
      '66666666-6666-4666-8666-666666666666',
      artifact,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://soyuz.example.test/v1/worker/runs/11111111-1111-4111-8111-111111111111/artifacts/${artifact.artifactId}`,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          authorization: 'Bearer worker-secret',
          'content-length': String(artifact.body.byteLength),
          'content-type': artifact.contentType,
          'x-artifact-kind': 'report',
          'x-artifact-name': 'result-summary.md',
          'x-soyuz-worker-id': 'host-1',
          'x-soyuz-claim-callback-id': '66666666-6666-4666-8666-666666666666',
        }),
      }),
    );
    const init = fetchImpl.mock.calls[0][1];
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('# Complete\n');
  });

  test('respects the local upload bound and skips artifacts already acknowledged by Soyuz', async () => {
    expect(MAX_SOYUZ_ARTIFACT_BYTES).toBeLessThan(25_000_000);
    const result = await loadSoyuzArtifacts(
      '11111111-1111-4111-8111-111111111111',
      '/missing/results',
      ['result-summary.md', 'failure.json', 'git.diff', 'changed-files.txt', 'run-scorecard.json', 'run-evaluation.json'],
    );
    expect(result.artifacts).toEqual([]);
  });
});
