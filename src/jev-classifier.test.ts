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
      answers: { safe: { type: 'noul', answer: true, confidence: 0.93 } },
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
    expect(result.answers.safe.answer).toBe(true);
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
    await expect(classifyWithJev('state', {}, { fetchImpl: malformed })).rejects.toBeInstanceOf(JevClassificationError);

    const failed = jest.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    await expect(classifyWithJev('state', {}, { fetchImpl: failed })).rejects.toMatchObject({ code: 'http', status: 503 });
  });

  it('exposes conservative answer helpers', () => {
    expect(answerConfidence({ confidence: 0.8 })).toBe(0.8);
    expect(answerConfidence({})).toBe(0);
    expect(answerIsTrue({ answer: true })).toBe(true);
    expect(answerIsTrue({ answer: 'yes' })).toBe(true);
    expect(answerIsTrue({ answer: 'maybe' })).toBe(false);
  });
});
