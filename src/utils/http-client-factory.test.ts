import { HttpClientFactory, RetryConfig } from './http-client-factory';

describe('http-client-factory', () => {
  describe('HttpClientFactory', () => {
    it('should retry transient fetch failures with the default retry config', async () => {
      jest.useFakeTimers();
      const originalFetch = global.fetch;
      const jsonPayload = { id: 'run-123', status: 'ok' };
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockRejectedValueOnce(new Error('temporary network error'))
        .mockRejectedValueOnce(new Error('upstream connection reset'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue(jsonPayload),
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        const requestPromise = new HttpClientFactory().request(
          'https://api.example.test/json',
          { method: 'GET' },
          (data) => ({ runId: (data as typeof jsonPayload).id }),
          'JSON request'
        );

        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(2000);
        await expect(requestPromise).resolves.toEqual({ runId: 'run-123' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.test/json', { method: 'GET' });
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/json', { method: 'GET' });
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.example.test/json', { method: 'GET' });
      } finally {
        global.fetch = originalFetch;
        jest.useRealTimers();
      }
    });

    it('should initialize with custom retry config', async () => {
      jest.useFakeTimers();
      const originalFetch = global.fetch;
      const maxAttempts = 7;
      const retryDelayMs = 25;
      const customConfig: Partial<RetryConfig> = {
        maxAttempts,
        initialDelayMs: retryDelayMs,
        maxDelayMs: retryDelayMs,
      };
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        fetchMock.mockRejectedValueOnce(new Error(`retryable outage ${attempt}`));
      }
      global.fetch = fetchMock;

      try {
        const requestPromise = new HttpClientFactory(customConfig).request(
          'https://api.example.test/custom-retry',
          { method: 'GET' },
          (data) => data,
          'Custom retry request'
        );
        const rejectionExpectation = expect(requestPromise).rejects.toThrow('retryable outage 7');

        await Promise.resolve();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        for (let expectedCalls = 2; expectedCalls <= maxAttempts; expectedCalls++) {
          await jest.advanceTimersByTimeAsync(retryDelayMs);
          expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
        }

        await rejectionExpectation;
        expect(fetchMock).toHaveBeenCalledTimes(maxAttempts);
        expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.test/custom-retry', { method: 'GET' });
      } finally {
        global.fetch = originalFetch;
        jest.useRealTimers();
      }
    });

    it('should return text payloads exactly and surface status-based requestText errors', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 3 });
      const originalFetch = global.fetch;
      const textPayload = 'plain text response\nwith exact whitespace and symbols: π ✓';
      const successText = jest.fn().mockResolvedValue(textPayload);
      const errorText = jest.fn().mockResolvedValue('not found body should not be read');
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: successText,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: errorText,
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        await expect(
          factory.requestText('https://api.example.test/text', { method: 'POST', body: 'raw-body' }, 'Text request')
        ).resolves.toBe(textPayload);
        expect(successText).toHaveBeenCalledTimes(1);

        await expect(
          factory.requestText('https://api.example.test/missing-text', { method: 'GET' }, 'Missing text request')
        ).rejects.toThrow('Missing text request failed: 404');
        expect(errorText).not.toHaveBeenCalled();

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.test/text', {
          method: 'POST',
          body: 'raw-body',
        });
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/missing-text', { method: 'GET' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should have requestBlob method', () => {
      const factory = new HttpClientFactory();
      expect(factory.requestBlob).toBeDefined();
      expect(typeof factory.requestBlob).toBe('function');
    });

    it('should handle successful requests with proper parsing and JSON request error semantics', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 1 });
      const originalFetch = global.fetch;
      const jsonPayload = { id: 'run-123', nested: { status: 'ok' } };
      const jsonErrorPayload = { detail: 'invalid run id' };
      const textPayload = 'plain text response';
      const blobPayload = new Blob(['binary response'], { type: 'application/octet-stream' });
      const successJson = jest.fn().mockResolvedValue(jsonPayload);
      const errorJson = jest.fn().mockResolvedValue(jsonErrorPayload);
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: successJson,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: errorJson,
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: jest.fn().mockResolvedValue(textPayload),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          blob: jest.fn().mockResolvedValue(blobPayload),
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        await expect(
          factory.request(
            'https://api.example.test/json',
            { method: 'GET' },
            (data) => {
              expect(data).toEqual(jsonPayload);
              return { runId: (data as typeof jsonPayload).id, status: (data as typeof jsonPayload).nested.status };
            },
            'JSON request'
          )
        ).resolves.toEqual({ runId: 'run-123', status: 'ok' });
        expect(successJson).toHaveBeenCalledTimes(1);

        await expect(
          factory.request(
            'https://api.example.test/json-error',
            { method: 'POST', body: '{"id":"missing"}' },
            (data) => data,
            'JSON request'
          )
        ).rejects.toThrow('JSON request failed: invalid run id');
        expect(errorJson).toHaveBeenCalledTimes(1);

        await expect(
          factory.requestText('https://api.example.test/text', { method: 'POST', body: '{}' }, 'Text request')
        ).resolves.toBe(textPayload);
        await expect(
          factory.requestBlob('https://api.example.test/blob', { method: 'DELETE' }, 'Blob request')
        ).resolves.toBe(blobPayload);

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.test/json', { method: 'GET' });
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/json-error', {
          method: 'POST',
          body: '{"id":"missing"}',
        });
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.example.test/text', { method: 'POST', body: '{}' });
        expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://api.example.test/blob', { method: 'DELETE' });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
