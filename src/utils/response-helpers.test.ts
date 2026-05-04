import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sendErrorResponse, buildStatusResponse, detectContentType, isNonEmptyFile } from './response-helpers';

describe('response-helpers', () => {
  describe('sendErrorResponse', () => {
    it('should send a properly formatted error response', () => {
      const mockResponse = {
        body: null as any,
        statusValue: 200,
        status: function(code: number) {
          this.statusValue = code;
          return this;
        },
        json: function(data: any) {
          this.body = data;
        },
      };

      sendErrorResponse(mockResponse as any, 404, 'Not Found', 'Run not found: abc123');

      expect(mockResponse.statusValue).toBe(404);
      expect(mockResponse.body).toEqual({
        type: 'https://api.kaseki.local/errors#not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Run not found: abc123',
      });
    });

    it('should convert title to kebab-case type URL', () => {
      const mockResponse = {
        body: null as any,
        statusValue: 200,
        status: function(code: number) {
          this.statusValue = code;
          return this;
        },
        json: function(data: any) {
          this.body = data;
        },
      };

      sendErrorResponse(mockResponse as any, 400, 'Bad Request', 'Invalid input');

      expect(mockResponse.body.type).toBe('https://api.kaseki.local/errors#bad-request');
    });
  });

  describe('buildStatusResponse', () => {
    it('should build a complete status response', () => {
      const response = buildStatusResponse({
        id: 'run-123',
        status: 'running',
        exitCode: 0,
        failureClass: 'test-failure',
        correlationId: 'corr-456',
        requestId: 'req-789',
        error: 'test error',
        resultDir: '/results/run-123',
      });

      expect(response).toEqual({
        id: 'run-123',
        status: 'running',
        exitCode: 0,
        failureClass: 'test-failure',
        correlationId: 'corr-456',
        requestId: 'req-789',
        error: 'test error',
        resultDir: '/results/run-123',
      });
    });

    it('should filter out null and undefined optional fields', () => {
      const response = buildStatusResponse({
        id: 'run-123',
        status: 'completed',
        exitCode: null,
        failureClass: undefined,
        error: null,
      });

      expect(response).toEqual({
        id: 'run-123',
        status: 'completed',
      });
    });

    it('should handle optional fields being omitted', () => {
      const response = buildStatusResponse({
        id: 'run-123',
        status: 'completed',
      });

      expect(response).toEqual({
        id: 'run-123',
        status: 'completed',
      });
    });
  });

  describe('detectContentType', () => {
    it('should detect JSON content type', () => {
      expect(detectContentType('metadata.json')).toBe('application/json');
    });

    it('should detect markdown content type', () => {
      expect(detectContentType('result-summary.md')).toBe('text/markdown');
    });

    it('should detect JSONL content type', () => {
      expect(detectContentType('progress.jsonl')).toBe('application/x-jsonl');
    });

    it('should detect diff content type', () => {
      expect(detectContentType('git.diff')).toBe('text/plain');
    });

    it('should default to text/plain', () => {
      expect(detectContentType('unknown.xyz')).toBe('text/plain');
    });
  });

  describe('isNonEmptyFile', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it('should return true for non-empty files', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'content');

      expect(isNonEmptyFile(filePath)).toBe(true);
    });

    it('should return false for empty files', () => {
      const filePath = path.join(tempDir, 'empty.txt');
      fs.writeFileSync(filePath, '');

      expect(isNonEmptyFile(filePath)).toBe(false);
    });

    it('should return false for non-existent files', () => {
      expect(isNonEmptyFile('/non/existent/file.txt')).toBe(false);
    });
  });
});
