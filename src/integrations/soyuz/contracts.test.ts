import { decodeQueueMessageBody, parseSoyuzQueuedRun } from './contracts';

const validEnvelope = {
  contractVersion: '1',
  runId: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-09T12:00:00.000Z',
  correlationId: '22222222-2222-4222-8222-222222222222',
  requestId: '33333333-3333-4333-8333-333333333333',
  request: {
    repoUrl: 'https://github.com/example/project',
    ref: 'main',
    taskPrompt: 'Add a focused health endpoint and its documentation.',
    taskMode: 'patch',
    publishMode: 'none',
  },
};

describe('Soyuz v1 Queue contract', () => {
  test('validates the envelope and normalizes the Kaseki request', () => {
    expect(parseSoyuzQueuedRun(validEnvelope)).toMatchObject({
      runId: validEnvelope.runId,
      contractVersion: '1',
      request: {
        repoUrl: validEnvelope.request.repoUrl,
        ref: 'main',
        taskMode: 'patch',
        publishMode: 'none',
      },
    });
  });

  test('rejects unsupported versions, extra envelope fields, invalid requests, and webhook secrets', () => {
    expect(() => parseSoyuzQueuedRun({ ...validEnvelope, contractVersion: '2' })).toThrow();
    expect(() => parseSoyuzQueuedRun({ ...validEnvelope, lease_id: 'never-an-identity' })).toThrow();
    expect(() => parseSoyuzQueuedRun({ ...validEnvelope, request: { ...validEnvelope.request, webhookConfig: { secret: 'do-not-forward' } } })).toThrow();
    expect(() => parseSoyuzQueuedRun({ ...validEnvelope, request: { ...validEnvelope.request, publishMode: 'unknown' } })).toThrow();
    expect(() => parseSoyuzQueuedRun({ ...validEnvelope, request: { ...validEnvelope.request, goalSetting: { enabled: true, unsupportedBehavior: true } } })).toThrow();
  });

  test('decodes direct JSON and Cloudflare base64 JSON bodies', () => {
    const json = JSON.stringify(validEnvelope);
    expect(decodeQueueMessageBody(json)).toEqual(validEnvelope);
    expect(decodeQueueMessageBody(Buffer.from(json).toString('base64'))).toEqual(validEnvelope);
    expect(() => decodeQueueMessageBody('not-json-or-base64')).toThrow();
  });
});
