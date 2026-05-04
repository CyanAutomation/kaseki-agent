import { sanitizeToolName } from './progress-stream-utils.js';

describe('sanitizeToolName', () => {
  it('strips XML/HTML tags', () => {
    expect(sanitizeToolName('ls -la</arg_value>')).toBe('ls -la');
    expect(sanitizeToolName('<tool>bash</tool>')).toBe('bash');
  });

  it('returns "tool" when empty after stripping', () => {
    expect(sanitizeToolName('')).toBe('tool');
    expect(sanitizeToolName('   ')).toBe('tool');
    expect(sanitizeToolName('<foo></foo>')).toBe('tool');
    expect(sanitizeToolName('</arg_value>')).toBe('tool');
  });

  it('trims whitespace', () => {
    expect(sanitizeToolName('  read_file  ')).toBe('read_file');
  });

  it('collapses whitespace and strips control characters', () => {
    expect(sanitizeToolName('bash\n\t\r  -lc\u0000echo hi\u0007')).toBe('bash -lc echo hi');
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
