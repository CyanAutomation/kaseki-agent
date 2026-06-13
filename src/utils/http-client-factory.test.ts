import { HttpClientFactory, RetryConfig } from './http-client-factory';

describe('http-client-factory', () => {
  describe('HttpClientFactory', () => {
    it('should handle successful JSON requests with proper parsing', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 1 });
      const originalFetch = global.fetch;
      const jsonPayload = { id: 'run-123', nested: { status: 'ok' } };

      const successJson = jest.fn().mockResolvedValue(jsonPayload);
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: successJson,
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        const result = await factory.request(
          'https://api.example.test/json',
          { method: 'GET' },
          (data) => {
            expect(data).toEqual(jsonPayload);
            return { runId: (data as typeof jsonPayload).id, status: (data as typeof jsonPayload).nested.status };
          },
          'JSON request'
        );

        expect(result).toEqual({ runId: 'run-123', status: 'ok' });
        expect(successJson).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/json', { method: 'GET' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return error message when JSON response has error detail field', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 1 });
      const originalFetch = global.fetch;
      const jsonErrorPayload = { detail: 'invalid run id' };

      const errorJson = jest.fn().mockResolvedValue(jsonErrorPayload);
      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: errorJson,
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        await expect(
          factory.request(
            'https://api.example.test/json-error',
            { method: 'POST', body: '{"id":"missing"}' },
            (data) => data,
            'JSON request'
          )
        ).rejects.toThrow('JSON request failed: invalid run id');
        expect(errorJson).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return text payloads exactly', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 3 });
      const originalFetch = global.fetch;
      const textPayload = 'plain text response\nwith exact whitespace and symbols: π ✓';
      const successText = jest.fn().mockResolvedValue(textPayload);

      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          text: successText,
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        const result = await factory.requestText('https://api.example.test/text', { method: 'POST', body: 'raw-body' }, 'Text request');
        expect(result).toBe(textPayload);
        expect(successText).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/text', {
          method: 'POST',
          body: 'raw-body',
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return text error when status is not ok', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 3 });
      const originalFetch = global.fetch;
      const errorText = jest.fn().mockResolvedValue('not found body should not be read');

      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: errorText,
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        await expect(
          factory.requestText('https://api.example.test/missing-text', { method: 'GET' }, 'Missing text request')
        ).rejects.toThrow('Missing text request failed: 404');
        expect(errorText).toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/missing-text', { method: 'GET' });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should return blob payloads from requestBlob', async () => {
      const factory = new HttpClientFactory({ maxAttempts: 1 });
      const originalFetch = global.fetch;
      const blobText = 'known blob payload';
      const blobPayload = new Blob([blobText], { type: 'text/plain' });
      const blobResponse = jest.fn().mockResolvedValue(blobPayload);

      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        blob: blobResponse,
      } as unknown as Response);
      global.fetch = fetchMock;

      try {
        const result = await factory.requestBlob(
          'https://api.example.test/blob',
          { method: 'GET', headers: { Accept: 'text/plain' } },
          'Blob request'
        );

        expect(result.type).toBe('text/plain');
        expect(result.size).toBe(blobPayload.size);
        await expect(result.text()).resolves.toBe(blobText);
        expect(blobResponse).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/blob', {
          method: 'GET',
          headers: { Accept: 'text/plain' },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should accept custom retry config initialization', async () => {
      const maxAttempts = 5;
      const customConfig: Partial<RetryConfig> = {
        maxAttempts,
      };
      const factory = new HttpClientFactory(customConfig);
      const originalFetch = global.fetch;

      const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: jest.fn().mockResolvedValue({ status: 'ok' }),
        } as unknown as Response);
      global.fetch = fetchMock;

      try {
        await factory.request(
          'https://api.example.test/config-test',
          { method: 'GET' },
          (data) => data,
          'Custom config request'
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
