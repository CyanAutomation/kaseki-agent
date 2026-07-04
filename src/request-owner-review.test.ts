import { requestOwnerReview, createMockFetch } from './request-owner-review';

describe('requestOwnerReview', () => {
  // Use fake timers for retry tests
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
  // Test fixtures
  const createPRPayload = (overrides = {}) => ({
    number: 42,
    base: {
      repo: {
        name: 'test-repo',
        owner: {
          login: 'testuser',
          type: 'User' as const,
          id: 12345,
        },
      },
    },
    ...overrides,
  });

  const createOrgPRPayload = (overrides = {}) => ({
    number: 15,
    base: {
      repo: {
        name: 'org-repo',
        owner: {
          login: 'myorg',
          type: 'Organization' as const,
          id: 67890,
        },
      },
    },
    ...overrides,
  });

  describe('Organization repository handling', () => {
    it('should skip review request for organization repos', async () => {
      const mockFetch = createMockFetch([{ status: 404 }]);
      const pr = createOrgPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toContain('organization');
    });

    it('should not make API call for organization repos', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        return new Response('', { status: 500 });
      };
      const pr = createOrgPRPayload();

      await requestOwnerReview(pr, 'token123', mockFetch);

      expect(callCount).toBe(0);
    });
  });

  describe('Personal repository - successful cases', () => {
    it('should request review successfully (HTTP 201)', async () => {
      const mockFetch = createMockFetch([{ status: 201 }]);
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.status).toBe(201);
      expect(result.message).toContain('testuser');
      expect(result.message).toContain('#42');
    });

    it('should handle already requested (HTTP 422)', async () => {
      const mockFetch = createMockFetch([{ status: 422 }]);
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.status).toBe(422);
      expect(result.message).toContain('already has review request');
    });
  });

  describe('Personal repository - error cases', () => {
    it('should handle permission denied (HTTP 403)', async () => {
      const mockFetch = createMockFetch([{ status: 403 }]);
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.status).toBe(403);
      expect(result.message).toContain('permission');
    });

    it('should handle not found (HTTP 404)', async () => {
      const mockFetch = createMockFetch([{ status: 404 }]);
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.status).toBe(404);
      expect(result.message).toContain('not accessible');
    });

    it('should handle unexpected HTTP status', async () => {
      const mockFetch = createMockFetch([{ status: 418 }]); // I'm a teapot
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.status).toBe(418);
      expect(result.message).toContain('Unexpected');
    });
  });

  describe('Retry logic', () => {
    it('should retry on HTTP 429 (rate limit)', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        if (callCount < 2) {
          return new Response('', { status: 429 });
        }
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      expect(finalResult.success).toBe(true);
      expect(finalResult.status).toBe(201);
      expect(callCount).toBe(2); // Retried once
    });

    it('should retry on HTTP 500 (server error)', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        if (callCount < 2) {
          return new Response('', { status: 500 });
        }
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      expect(finalResult.success).toBe(true);
      expect(finalResult.status).toBe(201);
      expect(callCount).toBe(2);
    });

    it('should retry on HTTP 502, 503, 504', async () => {
      const errorCodes = [502, 503, 504];

      for (const code of errorCodes) {
        let callCount = 0;
        const mockFetch = async () => {
          callCount++;
          if (callCount < 2) {
            return new Response('', { status: code });
          }
          return new Response('{}', { status: 201 });
        };
        const pr = createPRPayload();

        const result = requestOwnerReview(pr, 'token123', mockFetch);
        await jest.runAllTimersAsync();
        const finalResult = await result;

        expect(finalResult.success).toBe(true);
        expect(finalResult.status).toBe(201);
        expect(callCount).toBeGreaterThanOrEqual(2);
      }
    });

    it('should fail after max retries exhausted', async () => {
      const mockFetch = createMockFetch([
        { status: 500 },
        { status: 500 },
        { status: 500 },
      ]);
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      expect(finalResult.success).toBe(false);
      expect(finalResult.message).toContain('after');
      expect(finalResult.message).toContain('retries');
    });

    it('should not retry on HTTP 400, 401, 403, 404, 422', async () => {
      const nonRetryableCodes = [400, 401, 403, 404, 422];

      for (const code of nonRetryableCodes) {
        let callCount = 0;
        const mockFetch = async () => {
          callCount++;
          return new Response('', { status: code });
        };
        const pr = createPRPayload();

        const result = await requestOwnerReview(pr, 'token123', mockFetch);

        expect(callCount).toBe(1); // Only called once, no retries
        expect(result.success).toBe(false);
        expect(result.status).toBe(code);
      }
    });
  });

  describe('Network errors', () => {
    it('should retry on network error', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Network error');
        }
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      expect(finalResult.success).toBe(true);
      expect(finalResult.status).toBe(201);
      expect(callCount).toBe(2);
    });

    it('should fail after max retries on persistent network error', async () => {
      const mockFetch = async () => {
        throw new Error('Network connection refused');
      };
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      expect(finalResult.success).toBe(false);
      expect(finalResult.message).toContain('Network error');
    });
  });

  describe('Input validation', () => {
    it('should handle missing PR payload', async () => {
      const mockFetch = createMockFetch([{ status: 201 }]);

      const result = await requestOwnerReview(null as any, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid');
    });

    it('should handle missing token', async () => {
      const mockFetch = createMockFetch([{ status: 201 }]);
      const pr = createPRPayload();

      const result = await requestOwnerReview(pr, '', mockFetch);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid');
    });

    it('should handle missing base.repo structure', async () => {
      const mockFetch = createMockFetch([{ status: 201 }]);
      const pr = { number: 42 } as any;

      const result = await requestOwnerReview(pr, 'token123', mockFetch);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid');
    });
  });

  describe('API request details', () => {
    it('should use correct endpoint URL', async () => {
      let capturedUrl = '';
      const mockFetch = async (url: string) => {
        capturedUrl = url;
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      await requestOwnerReview(pr, 'token123', mockFetch);

      expect(capturedUrl).toBe(
        'https://api.github.com/repos/testuser/test-repo/pulls/42/requested_reviewers',
      );
    });

    it('should use correct headers', async () => {
      let capturedOptions: any;
      const mockFetch = async (_url: string, options: any) => {
        capturedOptions = options;
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      await requestOwnerReview(pr, 'token123', mockFetch);

      expect(capturedOptions.method).toBe('POST');
      expect(capturedOptions.headers.Authorization).toBe('token token123');
      expect(capturedOptions.headers['Content-Type']).toBe('application/json');
    });

    it('should send correct payload with reviewer list', async () => {
      let capturedBody = '';
      const mockFetch = async (_url: string, options: any) => {
        capturedBody = options.body;
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      await requestOwnerReview(pr, 'token123', mockFetch);

      const body = JSON.parse(capturedBody);
      expect(body.reviewers).toEqual(['testuser']);
    });
  });

  describe('Backoff timing', () => {
    it('should attempt retries (backoff happens internally)', async () => {
      let callCount = 0;
      const mockFetch = async () => {
        callCount++;
        if (callCount < 2) {
          return new Response('', { status: 500 });
        }
        return new Response('{}', { status: 201 });
      };
      const pr = createPRPayload();

      const result = requestOwnerReview(pr, 'token123', mockFetch);
      await jest.runAllTimersAsync();
      const finalResult = await result;

      // Verify retry happened
      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(finalResult.success).toBe(true);
    });
  });
});
