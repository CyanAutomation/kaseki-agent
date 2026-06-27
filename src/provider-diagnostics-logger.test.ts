/**
 * Unit Tests: Provider Diagnostics Logger
 *
 * Tests logging and deduplication of provider diagnostic information
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProviderDiagnosticsLogger, initializeProviderDiagnosticsLogger } from './provider-diagnostics-logger';

describe('Provider Diagnostics Logger', () => {
  let tempDir: string;
  let logger: ProviderDiagnosticsLogger;

  beforeEach(() => {
    // Create temporary directory for test logs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-diagnostics-'));
    logger = new ProviderDiagnosticsLogger(tempDir);
  });

  afterEach(() => {
    // Clean up
    logger.flush();
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }
  });

  describe('logEmptyAssistantTurn()', () => {
    it('should log empty assistant turn with full details', () => {
      logger.logEmptyAssistantTurn(
        'scouting',
        'gateway',
        'openai-responses',
        'auto',
        9019,
        146,
        'resp_4e859d2bfb3a457cb34d1e485d0b2958'
      );

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      expect(fs.existsSync(diagnosticsPath)).toBe(true);

      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.phase).toBe('scouting');
      expect(diagnostic.provider).toBe('gateway');
      expect(diagnostic.api).toBe('openai-responses');
      expect(diagnostic.outputTokens).toBe(146);
      expect(diagnostic.responseId).toBe('resp_4e859d2bfb3a457cb34d1e485d0b2958');
      expect(diagnostic.errorType).toBe('empty_assistant_turn');
    });

    it('should suggest gateway-specific action', () => {
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 50, 'resp_123');
      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.suggestedAction).toContain('llm-gateway.local.xyz');
      expect(diagnostic.suggestedAction).toContain('openai-responses adapter');
    });

    it('should include full response body when provided', () => {
      const fullResponse = {
        message: { content: null, role: 'assistant' },
        usage: { output_tokens: 146 },
      };

      logger.logEmptyAssistantTurn(
        'scouting',
        'gateway',
        'openai-responses',
        'auto',
        100,
        146,
        'resp_123',
        fullResponse
      );

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.fullResponseBody).toBeDefined();
      expect(diagnostic.fullResponseBody).toContain('content');
    });

    it('should deduplicate identical errors', () => {
      // Log the same error twice
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_123');
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_124');

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should only have one entry due to deduplication
      expect(lines.length).toBe(1);
    });

    it('should log different error variations separately', () => {
      // Same provider/api but different output tokens
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_123');
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 256, 'resp_124');

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should have two entries since token counts differ
      expect(lines.length).toBe(2);
    });
  });

  describe('logMalformedResponse()', () => {
    it('should log malformed response details', () => {
      logger.logMalformedResponse(
        'coding',
        'gateway',
        'openai-responses',
        'auto',
        'missing message.content field'
      );

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.phase).toBe('coding');
      expect(diagnostic.errorType).toBe('malformed_response');
      expect(diagnostic.errorMessage).toContain('missing message.content');
    });
  });

  describe('logProviderError()', () => {
    it('should log provider timeout', () => {
      logger.logProviderError('scouting', 'gateway', 'openai-responses', 'auto', 'timeout', 'Request timed out after 30s');
      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.errorType).toBe('timeout');
      expect(diagnostic.suggestedAction).toContain('KASEKI_AGENT_TIMEOUT_SECONDS');
    });

    it('should suggest action for auth error', () => {
      logger.logProviderError('scouting', 'gateway', 'openai-responses', 'auto', 'auth_error', 'Invalid API key');
      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.suggestedAction).toContain('API key');
    });

    it('should suggest action for rate limit', () => {
      logger.logProviderError('coding', 'openrouter', 'responses', 'gpt-4', 'rate_limit', 'Too many requests');
      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const diagnostic = JSON.parse(content.trim());

      expect(diagnostic.suggestedAction).toContain('concurrent');
    });
  });

  describe('Deduplication', () => {
    it('should prevent log spam from repeated errors', () => {
      // Log the same error 10 times
      for (let i = 0; i < 10; i++) {
        logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, `resp_${i}`);
      }

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should only log once
      expect(lines.length).toBe(1);
    });

    it('should track different error types separately', () => {
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_1');
      logger.logProviderError('scouting', 'gateway', 'openai-responses', 'auto', 'timeout', 'Timeout');

      logger.flush();

      const diagnosticsPath = path.join(tempDir, 'provider-diagnostics.jsonl');
      const content = fs.readFileSync(diagnosticsPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Should have two entries for different error types
      expect(lines.length).toBe(2);
    });
  });

  describe('getSummary()', () => {
    it('should provide error summary', () => {
      logger.logEmptyAssistantTurn('scouting', 'gateway', 'openai-responses', 'auto', 100, 146, 'resp_1');
      logger.logProviderError('scouting', 'gateway', 'openai-responses', 'auto', 'timeout', 'Timeout');

      const summary = logger.getSummary();
      expect(Object.keys(summary).length).toBe(2);
    });
  });

  describe('Singleton Instance', () => {
    it('should initialize and return global logger', () => {
      const logger1 = initializeProviderDiagnosticsLogger(tempDir);
      expect(logger1).toBeDefined();
    });
  });
});
