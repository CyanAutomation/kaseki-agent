/**
 * Optional environment capability probe for the real tree-sitter CLI binary.
 *
 * Run with RUN_TREE_SITTER_CLI_INTEGRATION=1 when the environment is expected
 * to provide the CLI and Go grammar. The normal Jest suite records this as a
 * skipped probe instead of failing on machines without tree-sitter CLI support.
 * This probe only verifies that this environment can invoke `npx tree-sitter`
 * with the Go grammar; it is not primary behavioral coverage for Go summarization.
 * Deterministic summarizer behavior is covered by the neighboring unit and integration tests.
 */
import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const integrationIt = process.env.RUN_TREE_SITTER_CLI_INTEGRATION === '1' ? it : it.skip;

type CliExecutionError = Error & {
  stderr?: Buffer | string;
  stdout?: Buffer | string;
  status?: number;
  signal?: NodeJS.Signals | null;
};

function formatCliOutput(output: Buffer | string | undefined): string | undefined {
  const formattedOutput = output?.toString().trim();

  return formattedOutput || undefined;
}

function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    const execError = error as CliExecutionError;
    const parts = [error.message];
    const stderr = formatCliOutput(execError.stderr);
    const stdout = formatCliOutput(execError.stdout);

    if (execError.status !== undefined) {
      parts.push(`exit status: ${execError.status}`);
    }
    if (execError.signal) {
      parts.push(`signal: ${execError.signal}`);
    }
    if (stderr) {
      parts.push(`stderr: ${stderr}`);
    }
    if (stdout) {
      parts.push(`stdout: ${stdout}`);
    }

    return parts.join('\n');
  }

  return String(error);
}

describe('optional tree-sitter CLI environment capability probe', () => {
  integrationIt('reports that npx tree-sitter can parse with the Go grammar', () => {
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

      let version: string;
      let jsonOutput: string;

      try {
        version = execFileSync('npx', ['tree-sitter', '--version'], { encoding: 'utf-8' }).trim();
      } catch (error) {
        throw new Error(`Failed to execute tree-sitter CLI: ${formatCliError(error)}`);
      }
      expect(version).toMatch(/tree-sitter/);

      const grammarDir = path.join(process.cwd(), 'node_modules', 'tree-sitter-go');
      try {
        jsonOutput = execFileSync('npx', ['tree-sitter', 'parse', goFile, '--json'], {
          cwd: grammarDir,
          encoding: 'utf-8',
        });
      } catch (error) {
        throw new Error(`Failed to parse Go file with tree-sitter: ${formatCliError(error)}`);
      }
      const tree = JSON.parse(jsonOutput);

      const newFormatSuccess = Boolean(tree.parse_summaries?.[0]?.successful);
      const oldFormatSuccess = tree.type === 'source_file' && Array.isArray(tree.children) && tree.children.length > 0;

      expect(newFormatSuccess || oldFormatSuccess).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
