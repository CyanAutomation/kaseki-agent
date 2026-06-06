import { sanitizeToolName } from './progress-stream-utils.js';

describe('sanitizeToolName', () => {
  it.each([
    ['  read_file  ', 'read_file'],
    ['bash    -lc   echo hi', 'bash -lc echo hi'],
    ['bash\n\t\r  -lc\u0000echo hi\u0007', 'bash -lc echo hi'],
    ['   ', 'tool'],
    ['', 'tool'],
    ['ls -la</arg_value>', 'ls -la'],
    ['<tool>bash</tool>', 'bash'],
    ['<foo></foo>', 'tool'],
    ['</arg_value>', 'tool'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(sanitizeToolName(input)).toBe(expected);
  });

  it('truncates to 100 characters', () => {
    expect(sanitizeToolName('a'.repeat(120))).toHaveLength(100);
    expect(sanitizeToolName('a'.repeat(100))).toHaveLength(100);
    expect(sanitizeToolName('a'.repeat(99))).toHaveLength(99);
  });

  it('preserves valid tool names unchanged', () => {
    expect(sanitizeToolName('read_file')).toBe('read_file');
    expect(sanitizeToolName('src/lib/parser.ts')).toBe('src/lib/parser.ts');
    expect(sanitizeToolName('my-tool.v2')).toBe('my-tool.v2');
  });
});
