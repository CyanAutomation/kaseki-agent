/**
 * hashline-validator.test.ts
 *
 * Test suite for HashlineValidator: Core validator for hashline edit operations.
 * Tests cover anchor validation, edit application, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HashlineValidator, validateHashlineEdit, applyHashlineEdit } from '../src/hashline-validator';
import type { HashlineEdit } from '../src/lib/hashline-types';

describe('HashlineValidator', () => {
  let validator: HashlineValidator;
  let tempDir: string;

  beforeEach(() => {
    validator = new HashlineValidator();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashline-test-'));
  });

  afterEach(() => {
    // Clean up temporary files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getLineHash', () => {
    it('should compute consistent SHA-256 hashes for lines', () => {
      const line = 'export function parseJson(input: string): any {';
      const hash1 = (validator as any).getLineHash(line);
      const hash2 = (validator as any).getLineHash(line);

      expect(hash1).toEqual(hash2);
      expect(hash1).toHaveLength(8);
      expect(/^[0-9a-f]{8}$/.test(hash1)).toBe(true);
    });

    it('should normalize newlines before hashing', () => {
      const lineWithNewline = 'function test() {\n';
      const lineWithout = 'function test() {';

      const hash1 = (validator as any).getLineHash(lineWithNewline);
      const hash2 = (validator as any).getLineHash(lineWithout);

      expect(hash1).toEqual(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = (validator as any).getLineHash('line 1');
      const hash2 = (validator as any).getLineHash('line 2');

      expect(hash1).not.toEqual(hash2);
    });
  });

  describe('validateAnchor', () => {
    it('should reject if file does not exist', () => {
      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: path.join(tempDir, 'nonexistent.ts'),
        anchor: {
          start_hash: 'abc12345',
          end_hash: 'def67890',
          context_lines: 3,
        },
        replacement: '// new code',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should successfully validate correct anchor hashes', () => {
      // Create a test file
      const content = `function hello() {
  console.log('world');
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      // Compute hashes for specific lines
      const lines = content.split('\n');
      const startHash = (validator as any).getLineHash(lines[1]).slice(0, 8);
      const endHash = (validator as any).getLineHash(lines[2]).slice(0, 8);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: startHash,
          end_hash: endHash,
          context_lines: 3,
        },
        replacement: '// replaced',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(true);
      expect(result.lineStart).toBe(1);
      expect(result.lineEnd).toBe(3);
    });

    it('should reject with stale anchor (not found)', () => {
      const content = `line 1
line 2
line 3`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'deadbeef',
          end_hash: 'cafebabe',
          context_lines: 3,
        },
        replacement: '// new',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should find anchors within context_lines distance', () => {
      const lines = ['line 0', 'line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
      const content = lines.join('\n');

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const startHash = (validator as any).getLineHash(lines[1]).slice(0, 8);
      const endHash = (validator as any).getLineHash(lines[4]).slice(0, 8);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: startHash,
          end_hash: endHash,
          context_lines: 5, // Should span up to 5 lines
        },
        replacement: '// replaced',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(true);
      expect(result.lineStart).toBe(1);
      expect(result.lineEnd).toBe(5);
    });

    it('should reject if end_hash is before start_hash', () => {
      const lines = ['line 0', 'line 1', 'line 2', 'line 3'];
      const content = lines.join('\n');

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const startHash = (validator as any).getLineHash(lines[3]).slice(0, 8);
      const endHash = (validator as any).getLineHash(lines[1]).slice(0, 8);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: startHash,
          end_hash: endHash,
          context_lines: 3,
        },
        replacement: '// replaced',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(false);
      // Accept either message - both indicate anchor validation failure
      expect(
        result.reason?.includes('not found') || 
        result.reason?.includes('End anchor found before start anchor')
      ).toBe(true);
    });

    it('should handle single-line edits', () => {
      const content = `export function test() {
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const hash = (validator as any).getLineHash(lines[1]).slice(0, 8);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: hash,
          end_hash: hash,
          context_lines: 2,
        },
        replacement: '  return 100;',
      };

      const result = validator.validateAnchor(edit);

      expect(result.valid).toBe(true);
      expect(result.lineStart).toBe(1);
      expect(result.lineEnd).toBe(2);
    });
  });

  describe('applyEdit', () => {
    it('should apply a simple single-line replacement', () => {
      const content = `function test() {
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 1,
        },
        replacement: '  return 100;',
      };

      validator.applyEdit(edit, 1, 2);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      expect(updatedContent).toContain('return 100;');
      expect(updatedContent).not.toContain('return 42;');
    });

    it('should apply multi-line replacements', () => {
      const content = `function test() {
  console.log('old');
  console.log('code');
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 3,
        },
        replacement: '  console.log("new");\n  console.log("code");',
      };

      validator.applyEdit(edit, 1, 3);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      const lines = updatedContent.split('\n');

      expect(lines[1]).toContain('console.log("new")');
      expect(lines[2]).toContain('console.log("code")');
    });

    it('should preserve lines before and after the edit', () => {
      const content = `line 0
line 1
line 2
line 3
line 4`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 3,
        },
        replacement: 'REPLACED',
      };

      validator.applyEdit(edit, 1, 4);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      const lines = updatedContent.split('\n');

      expect(lines[0]).toBe('line 0');
      expect(lines[1]).toBe('REPLACED');
      expect(lines[2]).toBe('line 4');
    });

    it('should throw if line range is invalid', () => {
      const content = `line 0
line 1
line 2`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 1,
        },
        replacement: 'replaced',
      };

      expect(() => {
        validator.applyEdit(edit, 5, 10); // Out of range
      }).toThrow();
    });

    it('should handle edits at the beginning of file', () => {
      const content = `line 0
line 1
line 2`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 1,
        },
        replacement: 'REPLACED',
      };

      validator.applyEdit(edit, 0, 1);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      const lines = updatedContent.split('\n');

      expect(lines[0]).toBe('REPLACED');
      expect(lines[1]).toBe('line 1');
    });

    it('should handle edits at the end of file', () => {
      const content = `line 0
line 1
line 2`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 1,
        },
        replacement: 'REPLACED',
      };

      validator.applyEdit(edit, 2, 3);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      const lines = updatedContent.split('\n');

      expect(lines[0]).toBe('line 0');
      expect(lines[1]).toBe('line 1');
      expect(lines[2]).toBe('REPLACED');
    });
  });

  describe('processEdits', () => {
    it('should process multiple edits and return results', () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `function hello() {
  return 42;
}
function world() {
  return 99;
}`;

      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const hash1 = (validator as any).getLineHash(lines[1]).slice(0, 8);
      const hash2 = (validator as any).getLineHash(lines[4]).slice(0, 8);

      const edits: HashlineEdit[] = [
        {
          type: 'hashline_edit',
          file: filePath,
          anchor: {
            start_hash: hash1,
            end_hash: hash1,
            context_lines: 1,
          },
          replacement: '  return 100;',
        },
        {
          type: 'hashline_edit',
          file: filePath,
          anchor: {
            start_hash: hash2,
            end_hash: hash2,
            context_lines: 1,
          },
          replacement: '  return 200;',
        },
      ];

      const { results, summary } = validator.processEdits(edits, tempDir);

      expect(results).toHaveLength(2);
      expect(summary.applied).toBe(2);
      expect(summary.rejected).toBe(0);
      expect(summary.errors).toBe(0);
      expect(summary.totalLinesModified).toBe(2);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      expect(updatedContent).toContain('return 100;');
      expect(updatedContent).toContain('return 200;');
    });

    it('should handle rejected edits gracefully', () => {
      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, 'line 1\nline 2\nline 3');

      const edits: HashlineEdit[] = [
        {
          type: 'hashline_edit',
          file: filePath,
          anchor: {
            start_hash: 'deadbeef',
            end_hash: 'cafebabe',
            context_lines: 1,
          },
          replacement: 'replaced',
        },
      ];

      const { results, summary } = validator.processEdits(edits, tempDir);

      expect(results[0].status).toBe('rejected');
      expect(summary.rejected).toBe(1);
      expect(summary.applied).toBe(0);
    });

    it('should continue processing after rejections', () => {
      const filePath = path.join(tempDir, 'test.ts');
      const content = `line 0
line 1
line 2
line 3`;

      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const validHash = (validator as any).getLineHash(lines[2]).slice(0, 8);

      const edits: HashlineEdit[] = [
        {
          type: 'hashline_edit',
          file: filePath,
          anchor: {
            start_hash: 'deadbeef',
            end_hash: 'cafebabe',
            context_lines: 1,
          },
          replacement: 'will fail',
        },
        {
          type: 'hashline_edit',
          file: filePath,
          anchor: {
            start_hash: validHash,
            end_hash: validHash,
            context_lines: 1,
          },
          replacement: 'VALID',
        },
      ];

      const { results, summary } = validator.processEdits(edits, tempDir);

      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('applied');
      expect(summary.applied).toBe(1);
      expect(summary.rejected).toBe(1);
    });
  });

  describe('Standalone functions', () => {
    it('should validate edit using standalone function', () => {
      const content = `export function test() {
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const lines = content.split('\n');
      const hash = (validator as any).getLineHash(lines[1]).slice(0, 8);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: hash,
          end_hash: hash,
          context_lines: 1,
        },
        replacement: '  return 100;',
      };

      const result = validateHashlineEdit(edit);

      expect(result.valid).toBe(true);
    });

    it('should apply edit using standalone function', () => {
      const content = `function test() {
  return 42;
}`;

      const filePath = path.join(tempDir, 'test.ts');
      fs.writeFileSync(filePath, content);

      const edit: HashlineEdit = {
        type: 'hashline_edit',
        file: filePath,
        anchor: {
          start_hash: 'abc123',
          end_hash: 'def456',
          context_lines: 1,
        },
        replacement: '  return 100;',
      };

      applyHashlineEdit(edit, 1, 2);

      const updatedContent = fs.readFileSync(filePath, 'utf-8');
      expect(updatedContent).toContain('return 100;');
    });
  });
});
