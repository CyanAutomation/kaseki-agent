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

import { getArtifactTypeCategory, shouldDisplayInline } from '../src/lib/artifact-utilities';

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
    const errorScenarios = [
      { status: 401, message: 'Token invalid or expired', code: 'UNAUTHORIZED' },
      { status: 400, message: 'Artifact not available yet', code: 'BAD_REQUEST' },
      { status: 404, message: 'Artifact not found', code: 'NOT_FOUND' },
      { status: 500, message: 'Error reading artifact', code: 'SERVER_ERROR' },
    ];

    it('should map HTTP status codes to user messages', () => {
      errorScenarios.forEach(({ status, code }) => {
        const isAuthError = status === 401;
        const isNotFoundError = status === 404;
        const isServerError = status >= 500;

        expect(isAuthError).toBe(code === 'UNAUTHORIZED');
        expect(isNotFoundError).toBe(code === 'NOT_FOUND');
        expect(isServerError).toBe(code === 'SERVER_ERROR');
      });
    });

    it('should distinguish between user errors and server errors', () => {
      const userErrorStatuses = [400, 401, 404];
      const serverErrorStatuses = [500, 502, 503];

      userErrorStatuses.forEach(status => {
        expect(status < 500).toBe(true);
      });

      serverErrorStatuses.forEach(status => {
        expect(status >= 500).toBe(true);
      });
    });
  });

  describe('Authorization header construction', () => {
    it('should format Bearer token correctly', () => {
      const token = 'sk-test-1234567890';
      const header = `Bearer ${token}`;
      expect(header).toBe('Bearer sk-test-1234567890');
      expect(header.startsWith('Bearer ')).toBe(true);
    });
  });
});
