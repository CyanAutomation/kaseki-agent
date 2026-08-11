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

    it.each([
      {
        description: 'an absolute workspace path',
        toolName: 'write_file',
        content: 'write /workspaces/kaseki-agent/src/index.ts',
        expected: 'src/index.ts',
      },
      {
        description: 'a dot-relative path',
        toolName: 'read_file',
        content: './lib/utils.ts',
        expected: 'lib/utils.ts',
      },
      {
        description: 'a path at the 40-character shortening threshold',
        toolName: 'read_file',
        content: `${'a'.repeat(28)}/dir/file.ts`,
        expected: `${'a'.repeat(28)}/dir/file.ts`,
      },
    ])('normalizes $description', ({ toolName, content, expected }) => {
      expect(extractFilePath(toolName, content)).toBe(expected);
    });

    it('maps tool names to operations when no path in content', () => {
      expect(extractFilePath('bash')).toBe('bash');
      expect(extractFilePath('grep')).toBe('grep');
      expect(extractFilePath('ls')).toBe('ls');
    });

    it('returns null for unknown tools without content', () => {
      expect(extractFilePath('unknown_tool')).toBeNull();
    });

    it.each([
      {
        description: 'without including unnecessary prefix',
        path: '/workspaces/kaseki-agent/src/deeply/nested/folder/structure/index.ts',
        expected: '…/structure/index.ts',
        retainedSegments: ['structure', 'index.ts'],
      },
      {
        description: 'one character above the 40-character shortening threshold',
        path: `${'a'.repeat(29)}/dir/file.ts`,
        expected: '…/dir/file.ts',
        retainedSegments: ['dir', 'file.ts'],
      },
    ])('shortens long file paths $description', ({ path, expected, retainedSegments }) => {
      const result = extractFilePath('read_file', path);

      expect(result).toBe(expected);
      expect(result?.split('/')).toEqual(['…', ...retainedSegments]);
      expect(result).toMatch(/^…\/[^/]+\/[^/]+$/);
      expect(result?.length).toBeLessThanOrEqual(40);
      expect(result?.startsWith('…/')).toBe(true);
    });
  });

  describe('extractDecision', () => {
    it('detects decision keywords in content', () => {
      expect(extractDecision('I will create a new file')).toContain('create');
      expect(extractDecision('Let me fix this bug')).toContain('fix');
      expect(extractDecision('I need to modify the handler')).toContain('modify');
      expect(extractDecision('Now I will implement the parser')).toContain('implement');
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
      const result = extractDecision(
        'distant-leading-marker 12345 nearby-before implement nearby-after-one nearby-after-two marker distant-trailing-marker',
      );

      expect(result).toBe(
        '12345 nearby-before implement nearby-after-one nearby-after-two marker',
      );
      expect(result).toHaveLength(70);
      expect(result).not.toContain('distant-leading-marker');
      expect(result).not.toContain('distant-trailing-marker');
    });

    it('extracts context when the keyword is at the start boundary', () => {
      expect(extractDecision('implement final-tail near the start')).toBe(
        'implement final-tail near the start',
      );
    });

    it('handles case-insensitive matching', () => {
      expect(extractDecision('I WILL CREATE a new module')).toContain('CREATE');
      expect(extractDecision('FiX the parser')).toContain('FiX');
    });
  });

  describe('detectError', () => {
    it.each([
      ['an error pattern', 'Error: Cannot read property', true],
      ['a failure pattern', 'Test FAILED: assertion failed', true],
      ['an exit code error', 'Process exited with code 1', true],
      ['successful content', 'Successfully created file index.ts', false],
      ['empty content', '', false],
      ['undefined content', undefined, false],
    ])('detects $description', (_description, content, hasError) => {
      expect(detectError(content).hasError).toBe(hasError);
    });

    const errorMarker = 'Error: uniquely-marked';
    const retainedPrefix = 'near-prefix-123456789012345678';
    const retainedSuffix = 'near-suffix-01234567890123456789012345';
    const distantPrefix = `DISTANT_PREFIX|${'prefix-content|'.repeat(12)}`;
    const distantSuffix = `DISTANT_SUFFIX|${'suffix-content|'.repeat(12)}`;

    it.each([
      {
        boundary: 'in the middle',
        content: `${distantPrefix}${retainedPrefix}${errorMarker}${retainedSuffix}${distantSuffix}`,
        expectedSnippet: `${retainedPrefix}${errorMarker}${retainedSuffix}`,
        expectedLength: 90,
      },
      {
        boundary: 'at the beginning',
        content: `${errorMarker}${retainedSuffix}${distantSuffix}`,
        expectedSnippet: `${errorMarker}${retainedSuffix}`,
        expectedLength: 60,
      },
      {
        boundary: 'at the end',
        content: `${distantPrefix}${retainedPrefix}${errorMarker}`,
        expectedSnippet: `${retainedPrefix}${errorMarker}`,
        expectedLength: 52,
      },
    ])(
      'extracts the documented context snippet when the error is $boundary',
      ({ content, expectedSnippet, expectedLength }) => {
        const result = detectError(content);

        expect(result).toEqual({ hasError: true, snippet: expectedSnippet });
        expect(result.snippet).toHaveLength(expectedLength);
        expect(result.snippet).not.toContain('DISTANT_PREFIX');
        expect(result.snippet).not.toContain('DISTANT_SUFFIX');
      },
    );
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

    it('abbreviates text exceeding limit without losing essential meaning', () => {
      const text = 'This is a very long text that exceeds the limit and should be truncated';
      const result = truncate(text, 20);
      // Result should be abbreviated (shorter than input)
      expect(result.length).toBeLessThan(text.length);
      // Result should still be readable with indication of abbreviation (e.g., ellipsis)
      expect(result).toBeTruthy();
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

    it('returns elapsed-only summary for events with no other extractable data', () => {
      const event = { type: 'unknown' };
      const summary = summarizeEvent(event, 'unknown_tool', Date.now() - 5000);
      expect(summary).toEqual({ elapsed: expect.stringMatching(/^5s$/) });
    });
  });

  describe('extractTopic', () => {
    // Progress-summary grammar: extractTopic's topicPatterns in pi-progress-summarizer.ts.
    it.each([
      ['format', 'Let me format the GitHub App Integration section', '[thinking] Format the GitHub App Integration section'],
      ['implement', 'Now I will implement the async error handler', '[thinking] Implement the async error handler'],
      ['check', 'Let me check the imports', '[thinking] Check the imports'],
      ['find', 'Let me find the root cause', '[thinking] Find the root cause'],
      ['analyze', 'I should analyze the test failures', '[thinking] Analyze the test failures'],
      ['review', 'I will review the proposed changes', '[thinking] Review the proposed changes'],
      ['fix', 'I will fix the parser regression', '[thinking] Fix the parser regression'],
      ['add', 'I am adding retry coverage', '[thinking] Adding retry coverage'],
      ['update', 'I am updating the API contract', '[thinking] Updating the API contract'],
      ['organize', 'I am organizing the imports', '[thinking] Organizing the imports'],
      ['validate', 'I will validate the generated schema', '[thinking] Validate the generated schema'],
      ['test', 'I am testing the fallback behavior', '[thinking] Testing the fallback behavior'],
    ])('normalizes the %s indicator', (_indicator, input, expected) => {
      expect(extractTopic(input)).toBe(expected);
    });

    it('returns null for content without topic indicators', () => {
      expect(extractTopic('Just reading through the file')).toBeNull();
      expect(extractTopic('Some random text without indicators')).toBeNull();
    });

    it('returns null for empty content', () => {
      expect(extractTopic('')).toBeNull();
      expect(extractTopic(undefined)).toBeNull();
    });

    it('extracts topic sentence without overflowing into subsequent sentences', () => {
      const result = extractTopic('Now I will format the config file. Then I need to test it.');
      expect(result).toBeTruthy();
      if (result) {
        // Should include the thinking indicator
        expect(result).toContain('[thinking]');
        // Should not include content from the second sentence (boundary test)
        const lowerResult = result.toLowerCase();
        expect(lowerResult).not.toContain('then');
        expect(lowerResult).not.toContain('test it');
      }
    });

    it('capitalizes first letter of extracted topic', () => {
      const result = extractTopic('let me implement a new parser module for JSON files');
      expect(result).toBe('[thinking] Implement a new parser module for JSON files');
      expect(result).toMatch(/^\[thinking\] [A-Z]/);
    });

    it('uses the first supported grammar rule when multiple indicators are present', () => {
      expect(extractTopic('I will analyze and format the configuration properly')).toBe(
        '[thinking] Format the configuration properly',
      );
    });

    it('handles case-insensitive matching', () => {
      expect(extractTopic('I will FORMAT the CONFIG file')).toBe(
        '[thinking] FORMAT the CONFIG file',
      );
    });

    it('truncates the topic at the maximum extraction length', () => {
      expect(extractTopic(`I will format ${'a'.repeat(100)}`)).toBe(
        `[thinking] Format ${'a'.repeat(69)}`,
      );
    });
  });
});
