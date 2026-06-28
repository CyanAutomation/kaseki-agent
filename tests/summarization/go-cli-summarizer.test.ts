/**
 * Go CLI summarizer parser contract tests.
 *
 * Unit tests mock the tree-sitter CLI JSON boundary so the parser contract is
 * deterministic. Set RUN_GO_CLI_SUMMARIZER_INTEGRATION=1 to exercise the real
 * CLI boundary explicitly.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GoCliSummarizer } from '../../src/summarization/go-cli-summarizer';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

type FixtureNode = {
  type: string;
  startPoint: [number, number];
  endPoint: [number, number];
  startIndex: number;
  endIndex: number;
  children?: FixtureNode[];
};

const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>;

const node = (source: string, type: string, text: string, children: FixtureNode[] = []): FixtureNode => {
  const startIndex = source.indexOf(text);
  if (startIndex === -1) {
    throw new Error(`Fixture text not found for ${type}: ${text}`);
  }
  return {
    type,
    startPoint: [0, 0],
    endPoint: [0, 0],
    startIndex,
    endIndex: startIndex + text.length,
    children,
  };
};

const mockTreeSitterOutput = (tree: FixtureNode): void => {
  mockExecFileSync.mockReturnValue(JSON.stringify(tree));
};

const writeFixture = (tmpDir: string, filename: string, code: string): string => {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, code);
  return filePath;
};

describe('GoCliSummarizer', () => {
  let summarizer: GoCliSummarizer;
  let tmpDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    summarizer = new GoCliSummarizer('go');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-summary-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('mocked tree-sitter parser contract', () => {
    it('preserves symbol navigation for Go files when full content is too large by extracting package, imports, structs, interfaces, functions, and receiver methods', () => {
      const code = `package services

import (
    "context"
    log "github.com/acme/log"
)

type Store interface {
    Save(ctx context.Context, user User) error
}

type User struct {
    ID   int
    Name string
}

func NewUser(name string) User {
    return User{Name: name}
}

func (u User) DisplayName() string {
    return u.Name
}

func (u *User) Rename(name string) {
    u.Name = name
}
`;
      const tree: FixtureNode = {
        type: 'source_file',
        startPoint: [0, 0],
        endPoint: [0, 0],
        startIndex: 0,
        endIndex: code.length,
        children: [
          node(code, 'package_clause', 'package services', [node(code, 'package_identifier', 'services')]),
          node(code, 'import_declaration', 'import (\n    "context"\n    log "github.com/acme/log"\n)', [
            node(code, 'import_spec_list', '(\n    "context"\n    log "github.com/acme/log"\n)', [
              node(code, 'import_spec', '"context"'),
              node(code, 'import_spec', 'log "github.com/acme/log"'),
            ]),
          ]),
          node(code, 'type_declaration', 'type Store interface {\n    Save(ctx context.Context, user User) error\n}', [
            node(code, 'type_spec', 'Store interface {\n    Save(ctx context.Context, user User) error\n}', [
              node(code, 'type_identifier', 'Store'),
              node(code, 'interface_type', 'interface {\n    Save(ctx context.Context, user User) error\n}'),
            ]),
          ]),
          node(code, 'type_declaration', 'type User struct {\n    ID   int\n    Name string\n}', [
            node(code, 'type_spec', 'User struct {\n    ID   int\n    Name string\n}', [
              node(code, 'type_identifier', 'User'),
              node(code, 'struct_type', 'struct {\n    ID   int\n    Name string\n}'),
            ]),
          ]),
          node(code, 'function_declaration', 'func NewUser(name string) User {\n    return User{Name: name}\n}', [
            node(code, 'identifier', 'NewUser'),
          ]),
          node(code, 'method_declaration', 'func (u User) DisplayName() string {\n    return u.Name\n}', [
            node(code, 'parameter_list', '(u User)'),
            node(code, 'identifier', 'DisplayName'),
          ]),
          node(code, 'method_declaration', 'func (u *User) Rename(name string) {\n    u.Name = name\n}', [
            node(code, 'parameter_list', '(u *User)'),
            node(code, 'identifier', 'Rename'),
          ]),
        ],
      };
      mockTreeSitterOutput(tree);

      const summary = summarizer.summarize(writeFixture(tmpDir, 'services.go', code));

      expect(summary).toMatchObject({
        language: 'go',
        packageName: 'services',
        imports: [{ module: 'context', items: [] }, { module: 'github.com/acme/log', items: [] }],
        functions: [{ name: 'NewUser', kind: 'function', signature: expect.stringContaining('func NewUser') }],
        types: [],
        interfaces: [{ name: 'Store', kind: 'interface', signature: 'type Store' }],
      });
      expect(summary.parseError).toBeUndefined();
      expect(summary.classes).toEqual([
        {
          name: 'User',
          methods: [
            { name: 'DisplayName', kind: 'method', signature: expect.stringContaining('func (u User) DisplayName') },
            { name: 'Rename', kind: 'method', signature: expect.stringContaining('func (u *User) Rename') },
          ],
        },
      ]);
      expect(mockExecFileSync).toHaveBeenCalledWith('tree-sitter', ['parse', expect.any(String), '--json'], expect.objectContaining({ timeout: 1000 }));
      expect((mockExecFileSync.mock.calls[0][1] as string[])[1]).toEqual(expect.stringContaining('services.go'));
    });

    it('summarizes methods for receiver types even when the struct declaration is outside the truncated parser fixture', () => {
      const code = `package api

func (h *Handler) Serve() error {
    return nil
}
`;
      mockTreeSitterOutput({
        type: 'source_file',
        startPoint: [0, 0],
        endPoint: [0, 0],
        startIndex: 0,
        endIndex: code.length,
        children: [
          node(code, 'package_clause', 'package api', [node(code, 'package_identifier', 'api')]),
          node(code, 'method_declaration', 'func (h *Handler) Serve() error {\n    return nil\n}', [
            node(code, 'parameter_list', '(h *Handler)'),
            node(code, 'identifier', 'Serve'),
          ]),
        ],
      });

      const summary = summarizer.summarize(writeFixture(tmpDir, 'handler.go', code));

      expect(summary.packageName).toBe('api');
      expect(summary.classes).toEqual([
        {
          name: 'Handler',
          methods: [{ name: 'Serve', kind: 'method', signature: expect.stringContaining('func (h *Handler) Serve') }],
        },
      ]);
      expect(summary.functions).toEqual([]);
      expect(summary.imports).toEqual([]);
      expect(summary.types).toEqual([]);
      expect(summary.interfaces).toEqual([]);
    });

    it('returns exact empty collections and a user-facing parse error when the Go CLI boundary fails', () => {
      const cliError = new Error('Command failed');
      (cliError as Error & { stderr: Buffer }).stderr = Buffer.from('fixture parser failure');
      mockExecFileSync.mockImplementation(() => {
        throw cliError;
      });

      const summary = summarizer.summarize(writeFixture(tmpDir, 'broken.go', 'package broken\nfunc broken(( {}'));

      expect(summary).toMatchObject({
        language: 'go',
        imports: [],
        exports: [],
        classes: [],
        functions: [],
        types: [],
        interfaces: [],
        parseError: 'tree-sitter-cli failed: fixture parser failure',
      });
    });

    it('returns exact empty collections and ENOENT guidance when tree-sitter is unavailable', () => {
      const cliError = new Error('spawn tree-sitter ENOENT');
      (cliError as Error & { code: string }).code = 'ENOENT';
      mockExecFileSync.mockImplementation(() => {
        throw cliError;
      });

      const summary = summarizer.summarize('package tools\n');

      expect(summary.imports).toEqual([]);
      expect(summary.exports).toEqual([]);
      expect(summary.classes).toEqual([]);
      expect(summary.functions).toEqual([]);
      expect(summary.types).toEqual([]);
      expect(summary.interfaces).toEqual([]);
      expect(summary.parseError).toBe('tree-sitter-cli not available (ENOENT)');
      expect(summary.originalSizeBytes).toBe(Buffer.byteLength('package tools\n', 'utf-8'));
    });
  });

  describe('opt-in real Go CLI integration', () => {
    const integrationIt = process.env.RUN_GO_CLI_SUMMARIZER_INTEGRATION === '1' ? it : it.skip;

    integrationIt('preserves Go symbol navigation through the real tree-sitter CLI boundary', () => {
      const actualChildProcess = jest.requireActual<typeof import('child_process')>('child_process');
      mockExecFileSync.mockImplementation(actualChildProcess.execFileSync as typeof execFileSync);
      const realSummarizer = new GoCliSummarizer('go');
      const code = `package main

import "fmt"

type Greeter struct{}

func Hello() { fmt.Println("hello") }
func (g Greeter) Greet() {}
`;

      const summary = realSummarizer.summarize(writeFixture(tmpDir, 'real.go', code));

      expect(summary.parseError).toBeUndefined();
      expect(summary.packageName).toBe('main');
      expect(summary.imports).toEqual([{ module: 'fmt', items: [] }]);
      expect(summary.functions.map((fn) => fn.name)).toEqual(['Hello']);
      expect(summary.classes).toEqual([
        { name: 'Greeter', methods: [{ name: 'Greet', kind: 'method', signature: expect.stringContaining('func (g Greeter) Greet') }] },
      ]);
    });
  });
});
