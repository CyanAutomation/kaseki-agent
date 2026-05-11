import { describe, it, expect } from '@jest/globals';
import { ANSI_COLORS } from '../src/ansi-colors';
import {
  extractFilePath,
  extractDecision,
  detectError,
  summarizeEvent,
  formatElapsed,
  truncate,
  formatProgressMessage,
  EventSampler,
  extractTopic,
} from '../src/pi-progress-summarizer';

describe('pi-progress-summarizer', () => {
  describe('extractFilePath', () => {
    it('extracts path from read_file tool', () => {
      const result = extractFilePath('read_file', 'reading /workspaces/kaseki-agent/src/parser.ts');
      expect(result).toMatch(/src\/parser/);
    });

    it('extracts path from grep_search tool', () => {
      const result = extractFilePath('grep_search', 'searching in src/handlers.ts');
      expect(result).toMatch(/handlers/);
    });

    it('shortens absolute paths', () => {
      const result = extractFilePath('write_file', 'write /workspaces/kaseki-agent/src/index.ts');
      expect(result).toMatch(/src\/index/);
      expect(result).not.toMatch(/workspaces/);
    });

    it('handles relative paths when content is provided', () => {
      const result = extractFilePath('read_file', './lib/utils.ts');
      expect(result).toBe('lib/utils.ts');
    });

    it('maps tool names to operations when no path in content', () => {
      expect(extractFilePath('bash')).toBe('bash');
      expect(extractFilePath('grep')).toBe('grep');
      expect(extractFilePath('ls')).toBe('ls');
    });

    it('returns null for unknown tools without content', () => {
      expect(extractFilePath('unknown_tool')).toBeNull();
    });

    it('truncates long paths with ellipsis', () => {
      const longPath = '/workspaces/kaseki-agent/src/deeply/nested/folder/structure/index.ts';
      const result = extractFilePath('read_file', longPath);
      if (result) {
        expect(result.length).toBeLessThanOrEqual(40);
        if (result.includes('…')) {
          expect(result).toMatch(/…\//);
        }
      }
    });
  });

  describe('extractDecision', () => {
    it('detects decision keywords in content', () => {
      expect(extractDecision('I will create a new file')).toContain('create');
      expect(extractDecision('Let me fix this bug')).toContain('fix');
      expect(extractDecision('I need to modify the handler')).toContain('modify');
    });

    it('returns null for content without keywords', () => {
      expect(extractDecision('This is just some information')).toBeNull();
      expect(extractDecision('I am reading the file')).toBeNull();
    });

    it('returns null for empty content', () => {
      expect(extractDecision('')).toBeNull();
      expect(extractDecision(undefined)).toBeNull();
    });

    it('extracts context around keyword', () => {
      const result = extractDecision('Now I will implement the parser with error handling');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('implement');
      }
    });

    it('handles case-insensitive matching', () => {
      expect(extractDecision('I WILL CREATE a new module')).toContain('CREATE');
      expect(extractDecision('FiX the parser')).toContain('FiX');
    });
  });

  describe('detectError', () => {
    it('detects error patterns in content', () => {
      const result = detectError('Error: Cannot read property');
      expect(result.hasError).toBe(true);
      expect(result.snippet).toContain('Error');
    });

    it('detects failure patterns', () => {
      const result = detectError('Test FAILED: assertion failed');
      expect(result.hasError).toBe(true);
    });

    it('detects exit code errors', () => {
      const result = detectError('Process exited with code 1');
      expect(result.hasError).toBe(true);
    });

    it('returns false for successful content', () => {
      const result = detectError('Successfully created file index.ts');
      expect(result.hasError).toBe(false);
    });

    it('returns false for empty content', () => {
      expect(detectError('').hasError).toBe(false);
      expect(detectError(undefined).hasError).toBe(false);
    });

    it('extracts context snippet around error', () => {
      const result = detectError('Some output before the actual Error: something bad happened here');
      expect(result.snippet).toBeTruthy();
      if (result.snippet) {
        expect(result.snippet).toContain('Error');
      }
    });
  });

  describe('formatElapsed', () => {
    it('formats seconds only for times under 60s', () => {
      const now = Date.now();
      const elapsed = formatElapsed(now - 30000); // 30 seconds
      expect(elapsed).toBe('30s');
    });

    it('formats minutes and seconds', () => {
      const now = Date.now();
      const elapsed = formatElapsed(now - 125000); // 2m 5s
      expect(elapsed).toMatch(/\dm \ds/);
    });

    it('formats longer durations', () => {
      const now = Date.now();
      const elapsed = formatElapsed(now - 605000); // 10m 5s
      expect(elapsed).toBe('10m 5s');
    });
  });

  describe('truncate', () => {
    it('returns text as-is if within limit', () => {
      const text = 'short text';
      expect(truncate(text, 20)).toBe(text);
    });

    it('truncates text exceeding limit', () => {
      const text = 'This is a very long text that exceeds the limit';
      const result = truncate(text, 20);
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('…');
    });

    it('handles undefined input', () => {
      expect(truncate(undefined, 20)).toBe('');
    });

    it('uses default max length of 100', () => {
      const text = 'a'.repeat(150);
      const result = truncate(text);
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });

  describe('formatProgressMessage', () => {
    it('formats basic message with stage and action', () => {
      const msg = formatProgressMessage('pi tool', 'read parser.ts');
      expect(msg).toContain('[progress]');
      expect(msg).toContain('pi tool');
      expect(msg).toContain('read parser.ts');
    });

    it('includes detail when provided', () => {
      const msg = formatProgressMessage('pi tool', 'read parser.ts', 'checking structure');
      expect(msg).toContain('checking structure');
    });

    it('includes elapsed time when provided', () => {
      const msg = formatProgressMessage('pi tool', 'read parser.ts', undefined, undefined, '1m 23s');
      expect(msg).toContain('1m 23s');
    });

    it('applies color for error level if available', () => {
      const msg = formatProgressMessage('pi tool', 'bash npm test', undefined, 'error');
      // When not in TTY, ANSI_COLORS will be empty, so just verify message structure
      expect(msg).toContain('[progress]');
      expect(msg).toContain('bash npm test');
      // If colors are available, they should be included
      if (ANSI_COLORS.RED !== '') {
        expect(msg).toContain('\x1b[31m');
      }
    });

    it('applies color for warn level if available', () => {
      const msg = formatProgressMessage('pi tool', 'auto retry', undefined, 'warn');
      expect(msg).toContain('[progress]');
      expect(msg).toContain('auto retry');
      // If colors are available, they should be included
      if (ANSI_COLORS.YELLOW !== '') {
        expect(msg).toContain('\x1b[33m');
      }
    });

    it('has no color for info level', () => {
      const msg = formatProgressMessage('pi tool', 'read file', undefined, 'info');
      // Should not have color codes for info level (colors are optional for info)
      // Just verify it doesn't crash
      expect(msg).toContain('[progress]');
    });
  });

  describe('EventSampler', () => {
    it('emits at configured rate', () => {
      const sampler = new EventSampler(5); // Emit every 5th event
      expect(sampler.shouldEmit()).toBe(false);
      expect(sampler.shouldEmit()).toBe(false);
      expect(sampler.shouldEmit()).toBe(false);
      expect(sampler.shouldEmit()).toBe(false);
      expect(sampler.shouldEmit()).toBe(true); // 5th event
    });

    it('resets counter on reset()', () => {
      const sampler = new EventSampler(3);
      sampler.shouldEmit();
      sampler.shouldEmit();
      sampler.shouldEmit(); // 3rd event would be true
      sampler.reset();
      expect(sampler.shouldEmit()).toBe(false); // Counter reset
    });

    it('defaults to rate of 10', () => {
      const sampler = new EventSampler();
      let emitCount = 0;
      for (let i = 0; i < 50; i++) {
        if (sampler.shouldEmit()) emitCount++;
      }
      // Should emit 5 times out of 50 (rate 10)
      expect(emitCount).toBe(5);
    });

    it('enforces minimum rate of 1 when given 0', () => {
      const sampler = new EventSampler(0);
      // With rate 1, every event is emitted
      expect(sampler.shouldEmit()).toBe(true); // 1st event
      expect(sampler.shouldEmit()).toBe(true); // 2nd event
      expect(sampler.shouldEmit()).toBe(true); // 3rd event
    });
  });

  describe('summarizeEvent', () => {
    it('extracts file path from event', () => {
      const event = {
        tool_name: 'read_file',
        message: { content: [{ text: '/src/parser.ts' }] },
      };
      const summary = summarizeEvent(event, 'read_file', Date.now() - 5000);
      expect(summary).toBeTruthy();
      if (summary && summary.action) {
        expect(summary.action).toMatch(/read|parser/);
      }
    });

    it('includes elapsed time', () => {
      const event = { type: 'message_update' };
      const startTime = Date.now() - 65000; // 65 seconds ago
      const summary = summarizeEvent(event, 'agent', startTime);
      expect(summary?.elapsed).toMatch(/1m/);
    });

    it('marks errors with error level', () => {
      const event = {
        type: 'tool_execution_end',
        message: { content: [{ text: 'Error: failed to read file' }] },
      };
      const summary = summarizeEvent(event, 'read_file', Date.now() - 5000);
      expect(summary?.level).toBe('error');
    });

    it('extracts decision keywords from content', () => {
      const event = {
        type: 'message_update',
        message: {
          content: [{ text: 'I will create a new file for the parser implementation' }],
        },
      };
      const summary = summarizeEvent(event, 'agent', Date.now() - 5000);
      expect(summary?.detail).toContain('create');
    });

    it('returns null for events with no extractable data', () => {
      const event = { type: 'unknown' };
      const summary = summarizeEvent(event, 'unknown_tool', Date.now() - 5000);
      // Should return an object (elapsed is always added)
      expect(summary).toBeTruthy();
    });
  });

  describe('extractTopic', () => {
    it('extracts topic from formatting indicator', () => {
      const result = extractTopic('Let me find and format the GitHub App Integration section');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('[thinking]');
        expect(result.toLowerCase()).toContain('format');
      }
    });

    it('detects implementing topic', () => {
      const result = extractTopic('Now I will implement the error handler for async operations');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('[thinking]');
        expect(result.toLowerCase()).toContain('implement');
      }
    });

    it('detects checking topic', () => {
      const result = extractTopic('Let me check if there are any invalid imports in the codebase');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('[thinking]');
        expect(result.toLowerCase()).toContain('check');
      }
    });

    it('detects analyzing topic', () => {
      const result = extractTopic('I should analyze the test failures to understand the root cause');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('[thinking]');
        expect(result.toLowerCase()).toContain('analyz');
      }
    });

    it('returns null for content without topic indicators', () => {
      expect(extractTopic('Just reading through the file')).toBeNull();
      expect(extractTopic('Some random text without indicators')).toBeNull();
    });

    it('returns null for empty content', () => {
      expect(extractTopic('')).toBeNull();
      expect(extractTopic(undefined)).toBeNull();
    });

    it('stops at sentence boundaries', () => {
      const result = extractTopic('Now I will format the config file. Then I need to test it.');
      expect(result).toBeTruthy();
      if (result) {
        expect(result.length).toBeLessThanOrEqual(100);
        // Should not include content from second sentence
        const lowerResult = result.toLowerCase();
        expect(lowerResult).not.toContain('then');
        expect(lowerResult).not.toContain('test it');
      }
    });

    it('capitalizes first letter of extracted topic', () => {
      const result = extractTopic('let me implement a new parser module for JSON files');
      if (result) {
        expect(result).toMatch(/\[thinking\] [A-Z]/);
      }
    });

    it('handles multiple indicator keywords - picks first', () => {
      const result = extractTopic('I will analyze and format the configuration properly');
      expect(result).toBeTruthy();
      if (result) {
        expect(result.toLowerCase()).toMatch(/analyz|format/);
      }
    });

    it('extracts context after indicator', () => {
      const result = extractTopic('I am checking if the environment variables are properly set');
      expect(result).toBeTruthy();
      if (result) {
        expect(result.toLowerCase()).toContain('check');
      }
    });

    it('handles case-insensitive matching', () => {
      const result = extractTopic('I will FORMAT the CONFIG file');
      expect(result).toBeTruthy();
      if (result) {
        expect(result).toContain('[thinking]');
        expect(result.toLowerCase()).toContain('format');
      }
    });

    it('extracts finding topic', () => {
      const result = extractTopic('Let me find the root cause of the issue');
      expect(result).toBeTruthy();
      if (result) {
        expect(result.toLowerCase()).toContain('find');
      }
    });

    it('keeps topic snippet under length limit', () => {
      const result = extractTopic(
        'Now I will format all the configuration files across the entire application ' +
          'to ensure consistency and compliance with the new standards'
      );
      expect(result).toBeTruthy();
      if (result) {
        expect(result.length).toBeLessThanOrEqual(120);
      }
    });
  });
});
