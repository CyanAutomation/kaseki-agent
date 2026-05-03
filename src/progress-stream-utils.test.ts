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

  it('truncates to 80 characters', () => {
    expect(sanitizeToolName('a'.repeat(100))).toHaveLength(80);
    expect(sanitizeToolName('a'.repeat(80))).toHaveLength(80);
    expect(sanitizeToolName('a'.repeat(79))).toHaveLength(79);
  });

  it('preserves valid tool names unchanged', () => {
    expect(sanitizeToolName('read_file')).toBe('read_file');
    expect(sanitizeToolName('src/lib/parser.ts')).toBe('src/lib/parser.ts');
    expect(sanitizeToolName('my-tool.v2')).toBe('my-tool.v2');
  });
});
