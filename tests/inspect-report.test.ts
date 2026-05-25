/**
 * tests/inspect-report.test.ts
 * 
 * Tests for the inspect-report.md generation script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('inspect-report generation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join('/tmp', 'kaseki-inspect-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runGenerateScript(resultsDir: string): string {
    const scriptPath = path.join(__dirname, '../scripts/generate-inspect-report.js');
    execSync(`node "${scriptPath}" "${resultsDir}"`);
    return fs.readFileSync(path.join(resultsDir, 'inspect-report.md'), 'utf8');
  });

  test('generates report with minimal artifacts', () => {
    // Minimal setup: just the required pi-events and pi-summary
    fs.writeFileSync(
      path.join(tempDir, 'pi-events.jsonl'),
      JSON.stringify({
        type: 'assistant-message',
        content: 'Analysis found several issues in the codebase.',
      }) + '\n'
    );

    fs.writeFileSync(
      path.join(tempDir, 'pi-summary.json'),
      JSON.stringify({
        selected_model: 'openrouter/claude-3.5-sonnet',
        input_tokens: 500,
        output_tokens: 300,
        tool_start_count: 3,
        tool_end_count: 3,
      })
    );

    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    expect(report).toContain('# Inspect Report');
    expect(report).toContain('## Summary');
    expect(report).toContain('## Statistics');
    expect(report).toContain('## Recommendations');
    expect(report).toContain('openrouter/claude-3.5-sonnet');
  });

  test('includes key findings from events', () => {
    fs.writeFileSync(
      path.join(tempDir, 'pi-events.jsonl'),
      JSON.stringify({
        type: 'assistant-message',
        content:
          'Analysis identified several critical issues: missing error handling in the parser module and incomplete test coverage.',
      }) + '\n'
    );

    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    expect(report).toContain('Key Findings');
    expect(report).toMatch(/missing error handling|incomplete test coverage/);
  });

  test('lists analyzed files', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), JSON.stringify({}));
    fs.writeFileSync(
      path.join(tempDir, 'changed-files.txt'),
      'src/parser.ts\nsrc/lexer.ts\ntests/parser.test.ts\n'
    );

    const report = runGenerateScript(tempDir);

    expect(report).toContain('## Files Analyzed');
    expect(report).toContain('`src/parser.ts`');
    expect(report).toContain('`src/lexer.ts`');
    expect(report).toContain('`tests/parser.test.ts`');
  });

  test('sanitizes sensitive information', () => {
    const withSecrets = {
      type: 'assistant-message',
      content: 'Found issue. API key: sk-or-abc123def456 should not be exposed.',
    };

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), JSON.stringify(withSecrets) + '\n');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), JSON.stringify({}));
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    // Verify key is redacted
    expect(report).not.toContain('sk-or-abc123def456');
    expect(report).toContain('[redacted-key]');
  });

  test('handles missing artifacts gracefully', () => {
    // Create only minimal files
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');

    const report = runGenerateScript(tempDir);

    expect(report).toContain('# Inspect Report');
    expect(report).toContain('No significant findings detected');
  });

  test('report file is created at expected location', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');

    runGenerateScript(tempDir);

    const reportPath = path.join(tempDir, 'inspect-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);

    const content = fs.readFileSync(reportPath, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  test('includes token counts when available', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(
      path.join(tempDir, 'pi-summary.json'),
      JSON.stringify({
        input_tokens: 2500,
        output_tokens: 1200,
      })
    );
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    expect(report).toContain('Tokens used');
    expect(report).toContain('3700'); // 2500 + 1200
  });

  test('includes tool execution counts when available', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(
      path.join(tempDir, 'pi-summary.json'),
      JSON.stringify({
        tool_start_count: 5,
        tool_end_count: 5,
      })
    );
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    expect(report).toContain('Tool executions');
    expect(report).toContain('10'); // 5 + 5
  });

  test('limits findings to avoid excessive output', () => {
    // Create many findings
    const events = Array(20)
      .fill(null)
      .map((_, i) =>
        JSON.stringify({
          type: 'assistant-message',
          content: `Finding ${i}: This is discovery number ${i} in the analysis process.`,
        })
      )
      .join('\n');

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), events);
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    // Should limit to ~10 findings
    const findingMatches = report.match(/^\d+\. /gm);
    expect(findingMatches).toBeDefined();
    expect((findingMatches || []).length).toBeLessThanOrEqual(10);
  });

  test('report has proper markdown structure', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    // Check for markdown structure
    expect(report).toMatch(/^# Inspect Report\s/m);
    expect(report).toMatch(/^## Summary\s/m);
    expect(report).toMatch(/^## Statistics\s/m);
    expect(report).toMatch(/^\| Metric \| Value \|\s/m);
    expect(report).toMatch(/^---\s/m); // Footer separator
  });
});
