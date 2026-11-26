import { createScriptedFetch, type FetchFaultRule } from './test-support/scripted-fetch';

describe('scripted Soyuz fetch faults', () => {
  test('can replace a response after the handler has committed a mutation', async () => {
    let state = 'queued';
    const handler: typeof fetch = async () => {
      state = 'claimed';
      return new Response('{"data":{}}');
    };
    const fault: FetchFaultRule = {
      method: 'POST', pathSuffix: '/claim', phase: 'after', times: 1,
      effect: { kind: 'response', response: new Response('temporary failure', { status: 503 }) },
    };
    const fetchImpl = createScriptedFetch(handler, [fault]);

    const response = await fetchImpl('https://soyuz.test/v1/worker/runs/run-1/claim', { method: 'POST' });

    expect(state).toBe('claimed');
    expect(response.status).toBe(503);
    await expect(fetchImpl('https://soyuz.test/v1/worker/runs/run-1/claim', { method: 'POST' })).resolves.toMatchObject({ status: 200 });
  });

  test('runs the handler after a before-phase delay completes', async () => {
    const events: string[] = [];
    const fetchImpl = createScriptedFetch(async () => {
      events.push('handler');
      return new Response('ok');
    }, [{
      method: 'GET', pathSuffix: '/runs/run-1', phase: 'before',
      effect: { kind: 'delay', milliseconds: 0 },
    }]);

    const request = fetchImpl('https://soyuz.test/v1/worker/runs/run-1');
    events.push('request-started');
    const response = await request;

    expect(response.status).toBe(200);
    expect(events).toEqual(['request-started', 'handler']);
  });

  test('holds a response until the request timeout aborts it', async () => {
    const fetchImpl = createScriptedFetch(async () => new Response('ok'), [{
      method: 'GET', pathSuffix: '/runs/run-1', phase: 'after',
      effect: { kind: 'delay', milliseconds: 10_000 },
    }]);
    const controller = new AbortController();
    const request = fetchImpl('https://soyuz.test/v1/worker/runs/run-1', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
