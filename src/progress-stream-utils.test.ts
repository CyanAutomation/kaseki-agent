import { sanitizeToolName } from './progress-stream-utils.js';

describe('sanitizeToolName', () => {
  // Spec: Tool names are sanitized for safe display in progress logs
  // Expected behavior: Trim/normalize whitespace, strip XML tags, truncate to 100 chars, replace empty with 'tool'
  describe('whitespace and tag normalization', () => {
    test.each([
      ['  read_file  ', 'read_file'],
      ['bash    -lc   echo hi', 'bash -lc echo hi'],
      ['bash\n\t\r  -lc\u0000echo hi\u0007', 'bash -lc echo hi'],
      ['   ', 'tool'],
      ['', 'tool'],
      ['ls -la</arg_value>', 'ls -la'],
      ['<tool>bash</tool>', 'bash'],
      ['<foo></foo>', 'tool'],
      ['</arg_value>', 'tool'],
    ])('should normalize %p to %p', (input, expected) => {
      expect(sanitizeToolName(input)).toBe(expected);
    });
  });

  describe('length limits', () => {
    // Spec: Tool names are truncated to 100 chars for safe display
    test('should truncate names longer than 100 characters', () => {
      expect(sanitizeToolName('a'.repeat(120))).toHaveLength(100);
      expect(sanitizeToolName('a'.repeat(100))).toHaveLength(100);
      expect(sanitizeToolName('a'.repeat(99))).toHaveLength(99);
      expect(sanitizeToolName('long-tool-' + 'x'.repeat(200))).toHaveLength(100);
    });
  });

  describe('identity cases', () => {
    // Spec: Valid tool names should pass through unchanged
    test.each([
      ['read_file', 'read_file'],
      ['src/lib/parser.ts', 'src/lib/parser.ts'],
      ['my-tool.v2', 'my-tool.v2'],
      ['npm run test', 'npm run test'],
    ])('should preserve valid tool name: %p', (input, expected) => {
      expect(sanitizeToolName(input)).toBe(expected);
    });
  });

  describe('unicode handling', () => {
    // Spec: Unicode characters should be preserved for international tool names
    test('should preserve unicode characters safely', () => {
      expect(sanitizeToolName('npm 🔧 run')).toBe('npm 🔧 run');
      expect(sanitizeToolName('python3 📝 script')).toBe('python3 📝 script');
    });
  });
});
