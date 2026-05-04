import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isNonEmptyFile,
  readFirstLine,
  readTailLines,
  fileExists,
  readFileContent,
  getFileStats,
  commandOutput,
} from './file-helpers';

describe('file-helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('isNonEmptyFile', () => {
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
      expect(isNonEmptyFile(path.join(tempDir, 'nonexistent.txt'))).toBe(false);
    });
  });

  describe('readFirstLine', () => {
    it('should read the first line of a file', () => {
      const filePath = path.join(tempDir, 'multiline.txt');
      fs.writeFileSync(filePath, 'first line\nsecond line\nthird line');

      expect(readFirstLine(filePath)).toBe('first line');
    });

    it('should handle single-line files', () => {
      const filePath = path.join(tempDir, 'single.txt');
      fs.writeFileSync(filePath, 'only line');

      expect(readFirstLine(filePath)).toBe('only line');
    });

    it('should trim whitespace from file boundaries', () => {
      const filePath = path.join(tempDir, 'whitespace.txt');
      fs.writeFileSync(filePath, '  trimmed  \nsecond');

      // trim() applies to the whole file content, so it removes leading/trailing whitespace
      // but the first line keeps its internal trailing spaces
      expect(readFirstLine(filePath)).toBe('trimmed  ');
    });

    it('should return undefined for non-existent files', () => {
      expect(readFirstLine(path.join(tempDir, 'nonexistent.txt'))).toBeUndefined();
    });

    it('should return undefined for empty files', () => {
      const filePath = path.join(tempDir, 'empty.txt');
      fs.writeFileSync(filePath, '');

      expect(readFirstLine(filePath)).toBeUndefined();
    });
  });

  describe('readTailLines', () => {
    it('should return last N lines', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';

      expect(readTailLines(content, 2)).toBe('line4\nline5');
    });

    it('should return all lines if content has fewer lines than requested', () => {
      const content = 'line1\nline2\nline3';

      expect(readTailLines(content, 5)).toBe(content);
    });

    it('should return empty string for maxLines <= 0', () => {
      const content = 'line1\nline2\nline3';

      expect(readTailLines(content, 0)).toBe('');
      expect(readTailLines(content, -1)).toBe('');
    });

    it('should handle CRLF line endings', () => {
      const content = 'line1\r\nline2\r\nline3\r\nline4';

      // The function splits on /\r?\n/ which handles both CRLF and LF
      // Then joins with \n, so CRLF is converted to LF in the output
      expect(readTailLines(content, 2)).toBe('line3\nline4');
    });
  });

  describe('fileExists', () => {
    it('should return true for existing files', () => {
      const filePath = path.join(tempDir, 'exists.txt');
      fs.writeFileSync(filePath, 'content');

      expect(fileExists(filePath)).toBe(true);
    });

    it('should return false for non-existent files', () => {
      expect(fileExists(path.join(tempDir, 'nonexistent.txt'))).toBe(false);
    });

    it('should return true for existing directories', () => {
      expect(fileExists(tempDir)).toBe(true);
    });
  });

  describe('readFileContent', () => {
    it('should read file content as text', () => {
      const filePath = path.join(tempDir, 'content.txt');
      fs.writeFileSync(filePath, 'hello world');

      expect(readFileContent(filePath)).toBe('hello world');
    });

    it('should return null for non-existent files', () => {
      expect(readFileContent(path.join(tempDir, 'nonexistent.txt'))).toBeNull();
    });

    it('should handle empty files', () => {
      const filePath = path.join(tempDir, 'empty.txt');
      fs.writeFileSync(filePath, '');

      expect(readFileContent(filePath)).toBe('');
    });
  });

  describe('getFileStats', () => {
    it('should return file stats for existing files', () => {
      const filePath = path.join(tempDir, 'test.txt');
      fs.writeFileSync(filePath, 'content');

      const stats = getFileStats(filePath);
      expect(stats).not.toBeNull();
      expect(stats?.size).toBe('content'.length);
      expect(stats?.isFile()).toBe(true);
    });

    it('should return null for non-existent files', () => {
      expect(getFileStats(path.join(tempDir, 'nonexistent.txt'))).toBeNull();
    });

    it('should work with directories', () => {
      const stats = getFileStats(tempDir);
      expect(stats).not.toBeNull();
      expect(stats?.isDirectory()).toBe(true);
    });
  });

  describe('commandOutput', () => {
    it('should execute a command and return its output', () => {
      const output = commandOutput('echo', ['hello']);
      expect(output).toBe('hello');
    });

    it('should return undefined for failed commands', () => {
      const output = commandOutput('false', []);
      expect(output).toBeUndefined();
    });

    it('should trim whitespace from output', () => {
      const output = commandOutput('echo', ['  padded  ']);
      expect(output).toBe('padded');
    });

    it('should return undefined for commands that produce no output', () => {
      const output = commandOutput('true', []);
      expect(output).toBeUndefined();
    });

    it('should support working directory', () => {
      const output = commandOutput('pwd', [], tempDir);
      expect(output).toBe(tempDir);
    });
  });
});
