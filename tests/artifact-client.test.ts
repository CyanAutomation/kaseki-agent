/**
 * Artifact Client - Test Suite
 *
 * Tests for client-side artifact fetching and display logic.
 * Validates:
 * - API request construction with authentication
 * - Response handling and validation
 * - Content type detection for display
 * - Error handling and user feedback
 */

import { LocalKasekiApiClient } from '../src/cli/api/LocalKasekiApiClient';
import { getArtifactTypeCategory, normalizeArtifactFetchError, shouldDisplayInline } from '../src/lib/artifact-utilities';

describe('Artifact Client Utilities', () => {
  describe('getArtifactTypeCategory', () => {
    it('should categorize JSON artifacts correctly', () => {
      expect(getArtifactTypeCategory('application/json')).toBe('json');
      expect(getArtifactTypeCategory('APPLICATION/JSON')).toBe('json');
    });

    it('should categorize JSONL artifacts correctly', () => {
      expect(getArtifactTypeCategory('application/x-jsonl')).toBe('jsonl');
    });

    it('should categorize markdown artifacts correctly', () => {
      expect(getArtifactTypeCategory('text/markdown')).toBe('markdown');
    });

    it('should categorize plain text artifacts correctly', () => {
      expect(getArtifactTypeCategory('text/plain')).toBe('text');
      expect(getArtifactTypeCategory('text/tab-separated-values')).toBe('text');
    });

    it('should categorize binary artifacts correctly', () => {
      expect(getArtifactTypeCategory('application/zip')).toBe('binary');
      expect(getArtifactTypeCategory('application/gzip')).toBe('binary');
      expect(getArtifactTypeCategory('application/octet-stream')).toBe('binary');
    });

    it('should be case-insensitive', () => {
      expect(getArtifactTypeCategory('TEXT/MARKDOWN')).toBe('markdown');
      expect(getArtifactTypeCategory('Text/Plain')).toBe('text');
    });
  });

  describe('shouldDisplayInline', () => {
    it('should allow inline display for JSON', () => {
      expect(shouldDisplayInline('application/json')).toBe(true);
    });

    it('should allow inline display for JSONL', () => {
      expect(shouldDisplayInline('application/x-jsonl')).toBe(true);
    });

    it('should allow inline display for text files', () => {
      expect(shouldDisplayInline('text/plain')).toBe(true);
      expect(shouldDisplayInline('text/markdown')).toBe(true);
      expect(shouldDisplayInline('text/tab-separated-values')).toBe(true);
    });

    it('should reject inline display for binary files', () => {
      expect(shouldDisplayInline('application/zip')).toBe(false);
      expect(shouldDisplayInline('application/gzip')).toBe(false);
      expect(shouldDisplayInline('application/x-tar')).toBe(false);
    });
  });

  describe('Content type display strategy', () => {
    const displayStrategies = [
      { contentType: 'application/json', strategy: 'formatted-json', displayInline: true },
      { contentType: 'application/x-jsonl', strategy: 'formatted-jsonl', displayInline: true },
      { contentType: 'text/markdown', strategy: 'rendered-markdown', displayInline: true },
      { contentType: 'text/plain', strategy: 'code-block', displayInline: true },
      { contentType: 'text/tab-separated-values', strategy: 'table', displayInline: true },
      { contentType: 'application/zip', strategy: 'download-only', displayInline: false },
      { contentType: 'application/gzip', strategy: 'download-only', displayInline: false },
    ];

    it('should match inline display decision with content type category', () => {
      displayStrategies.forEach(({ contentType, displayInline }) => {
        const category = getArtifactTypeCategory(contentType);
        const expectedInline = category !== 'binary';
        expect(shouldDisplayInline(contentType)).toBe(expectedInline);
        expect(expectedInline).toBe(displayInline);
      });
    });
  });

  describe('Artifact response handling', () => {
    it('should parse artifact response with required fields', () => {
      const response = {
        file: 'metadata.json',
        contentType: 'application/json',
        size: 1024,
        content: JSON.stringify({ key: 'value' }),
      };

      expect(response.file).toBe('metadata.json');
      expect(response.contentType).toBe('application/json');
      expect(typeof response.size).toBe('number');
      expect(typeof response.content).toBe('string');
    });

    it('should handle different content types in response', () => {
      const textResponse = {
        file: 'stdout.log',
        contentType: 'text/plain',
        size: 5000,
        content: 'log content here',
      };

      const jsonResponse = {
        file: 'metadata.json',
        contentType: 'application/json',
        size: 1500,
        content: '{"key": "value"}',
      };

      expect(getArtifactTypeCategory(textResponse.contentType)).toBe('text');
      expect(getArtifactTypeCategory(jsonResponse.contentType)).toBe('json');
    });
  });

  describe('Error handling', () => {
    const clientVisibleErrorScenarios = [
      {
        status: 401,
        category: 'auth',
        message: 'Authentication failed: Invalid or expired token. Please re-enter your API key.',
      },
      {
        status: 400,
        category: 'bad-request',
        message: 'Invalid artifact request.',
      },
      {
        status: 404,
        category: 'not-found',
        message: 'Artifact not found.',
      },
      {
        status: 500,
        category: 'server',
        message: 'Server error: Could not read artifact (500).',
      },
    ];

    it('should map HTTP status codes to user messages', () => {
      clientVisibleErrorScenarios.forEach(({ status, category, message }) => {
        const normalizedError = normalizeArtifactFetchError(status);

        expect(normalizedError).toEqual(expect.objectContaining({
          category,
          message,
        }));
      });
    });

    it('should normalize representative artifact fetch errors', () => {
      expect(normalizeArtifactFetchError(400)).toEqual({
        category: 'bad-request',
        message: 'Invalid artifact request.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(401)).toEqual({
        category: 'auth',
        message: 'Authentication failed: Invalid or expired token. Please re-enter your API key.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(403)).toEqual({
        category: 'forbidden',
        message: 'Access denied: You do not have permission to view this artifact.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(404)).toEqual({
        category: 'not-found',
        message: 'Artifact not found.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(409)).toEqual({
        category: 'conflict',
        message: 'Artifact request conflicted with the current run state. Please refresh and try again.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(422)).toEqual({
        category: 'validation',
        message: 'Artifact request could not be processed. Please check the requested artifact path.',
        retryable: false,
      });
      expect(normalizeArtifactFetchError(429)).toEqual({
        category: 'rate-limit',
        message: 'Rate limit exceeded. Please retry later.',
        retryable: true,
      });
      expect(normalizeArtifactFetchError(503)).toEqual({
        category: 'server',
        message: 'Server error: Could not read artifact (503).',
        retryable: true,
      });
    });

    it('should leave unhandled 4xx statuses non-retryable', () => {
      expect(normalizeArtifactFetchError(418)).toEqual({
        category: 'unknown',
        message: 'Error loading artifact',
        retryable: false,
      });
    });
  });

  describe('Artifact request authentication', () => {
    const successfulArtifactsResponse = {
      id: 'kaseki-run-20260607-abc123',
      runStatus: 'completed' as const,
      artifacts: [
        {
          name: 'metadata.json',
          size: 1024,
          contentType: 'application/json',
          available: true,
        },
      ],
      recommended: ['metadata.json'],
      artifactCount: 1,
      downloadBaseUrl: '/api/results/kaseki-run-20260607-abc123/',
    };

    function mockArtifactFetch() {
      return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn().mockResolvedValue(successfulArtifactsResponse),
      } as unknown as Response);
    }

    it('should send the configured API key as a Bearer token on artifact list requests', async () => {
      const originalFetch = global.fetch;
      const fetchMock = mockArtifactFetch();
      global.fetch = fetchMock;

      try {
        const token = 'sk-test-1234567890';
        const client = new LocalKasekiApiClient({
          baseUrl: 'http://127.0.0.1:8080/api',
          apiKey: token,
        });

        await expect(client.getRunArtifacts('kaseki-run-20260607-abc123')).resolves.toEqual(successfulArtifactsResponse);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:8080/api/runs/kaseki-run-20260607-abc123/artifacts',
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should omit the Authorization header when no API key is configured', async () => {
      const originalFetch = global.fetch;
      const fetchMock = mockArtifactFetch();
      global.fetch = fetchMock;

      try {
        const client = new LocalKasekiApiClient({
          baseUrl: 'http://127.0.0.1:8080/api',
        });

        await expect(client.getRunArtifacts('kaseki-run-20260607-abc123')).resolves.toEqual(successfulArtifactsResponse);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:8080/api/runs/kaseki-run-20260607-abc123/artifacts',
          { headers: {} }
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
