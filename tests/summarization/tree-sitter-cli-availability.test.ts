/**
 * Optional integration check for the real tree-sitter CLI binary.
 *
 * Run with RUN_TREE_SITTER_CLI_INTEGRATION=1 when the environment is expected
 * to provide the CLI and Go grammar. The normal Jest suite records this as a
 * skipped environment-gated integration test instead of failing unit tests on
 * machines without tree-sitter CLI support.
 */
import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const integrationIt = process.env.RUN_TREE_SITTER_CLI_INTEGRATION === '1' ? it : it.skip;

describe('tree-sitter CLI availability integration', () => {
  integrationIt('parses a Go fixture and returns AST data through the real CLI', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-sitter-cli-'));
    const goFile = path.join(tmpDir, 'handler.go');

    try {
      fs.writeFileSync(goFile, `package handlers

import "fmt"

type Handler struct {
  name string
}

func (h Handler) Process() error {
  fmt.Println("Processing:", h.name)
  return nil
}

func CreateHandler(name string) *Handler {
  return &Handler{name: name}
}
`);

      const version = execFileSync('npx', ['tree-sitter', '--version'], { encoding: 'utf-8' }).trim();
      expect(version).toMatch(/tree-sitter/);

      const grammarDir = path.join(process.cwd(), 'node_modules', 'tree-sitter-go');
      const jsonOutput = execFileSync('npx', ['tree-sitter', 'parse', goFile, '--json'], {
        cwd: grammarDir,
        encoding: 'utf-8',
      });
      const tree = JSON.parse(jsonOutput);

      const newFormatSuccess = Boolean(tree.parse_summaries?.[0]?.successful);
      const oldFormatSuccess = tree.type === 'source_file' && Array.isArray(tree.children) && tree.children.length > 0;

      expect(newFormatSuccess || oldFormatSuccess).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
