import { classifyWithJev, answerConfidence, answerIsTrue, DEFAULT_JEV_MODEL, JEV_DECISIONS_URL, JevClassificationError } from './jev-classifier';

describe('JEV classifier client', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'sk-test-key';
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it('posts a typed decision request and preserves answers and usage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      model: DEFAULT_JEV_MODEL,
      answers: { safe: { type: 'noul', noul: 0.93 } },
      usage: { input_tokens: 12, output_tokens: 4 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await classifyWithJev('task state', {
      safe: { type: 'noul', instructions: 'Is this safe?' },
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(JEV_DECISIONS_URL, expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({
      model: DEFAULT_JEV_MODEL,
      state: 'task state',
    });
    expect(result.answers.safe).toEqual({ type: 'noul', noul: 0.93 });
    expect(result.usage.output_tokens).toBe(4);
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('reports missing credentials without making a request', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchImpl = jest.fn();
    await expect(classifyWithJev('state', {}, { fetchImpl })).rejects.toMatchObject({ code: 'credentials' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed responses and HTTP failures', async () => {
    const malformed = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(classifyWithJev('state', { safe: { type: 'noul', instructions: 'Is this safe?' } }, { fetchImpl: malformed })).rejects.toBeInstanceOf(JevClassificationError);

    const failed = jest.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    await expect(classifyWithJev('state', { safe: { type: 'noul', instructions: 'Is this safe?' } }, { fetchImpl: failed, maxRetries: 0 })).rejects.toMatchObject({ code: 'http', status: 503 });
  });

  it('retries transient overload responses before returning a complete typed response', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 529 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: DEFAULT_JEV_MODEL,
        answers: { safe: { type: 'noul', noul: 0.91 } },
        usage: {},
      }), { status: 200 }));

    await expect(classifyWithJev('state', { safe: { type: 'noul', instructions: 'Is this safe?' } }, { fetchImpl, maxRetries: 1 })).resolves.toMatchObject({ answers: { safe: { noul: 0.91 } } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a classifier timeout before failing', async () => {
    const fetchImpl = jest.fn()
      .mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
        const signal = options.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: DEFAULT_JEV_MODEL,
        answers: { safe: { type: 'noul', noul: 0.95 } },
        usage: {},
      }), { status: 200 }));

    await expect(classifyWithJev('state', { safe: { type: 'noul', instructions: 'Is this safe?' } }, {
      fetchImpl,
      timeoutMs: 5,
      maxRetries: 1,
    })).resolves.toMatchObject({ answers: { safe: { noul: 0.95 } } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty answer map rather than silently approving it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {}, usage: {} }), { status: 200 }));
    await expect(classifyWithJev('state', { safe: { type: 'noul', instructions: 'Is this safe?' } }, { fetchImpl })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a same-sized answer map that omits a requested question', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      answers: { unexpected: { type: 'noul', noul: 0.93 } },
      usage: {},
    }), { status: 200 }));

    await expect(classifyWithJev('state', {
      safe: { type: 'noul', instructions: 'Is this safe?' },
    }, { fetchImpl })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('exposes conservative answer helpers', () => {
    expect(answerConfidence({ type: 'choice', choice: 'yes', probabilities: { yes: 0.8, no: 0.2 }, confidence: 0.8 })).toBe(0.8);
    expect(answerConfidence({ type: 'noul', noul: 0.9 })).toBe(0);
    expect(answerIsTrue({ type: 'noul', noul: 0.9 })).toBe(true);
    expect(answerIsTrue({ type: 'noul', noul: 0.5 })).toBe(false);
  });
});
