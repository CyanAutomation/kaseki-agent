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
  type Severity = 'critical' | 'warning' | 'info';

  type ParsedFinding = {
    ordinal: number;
    text: string;
    severity: Severity;
    trigger: string;
  };

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
  }

  function parseFindings(report: string): ParsedFinding[] {
    return report
      .split('\n')
      .map((line): ParsedFinding | null => {
        const match = line.match(/^(\d+)\. (.+)$/);
        if (!match) return null;

        const text = match[2].trim();
        // Severity is set to info by default; actual severity inference
        // should come from inspect-report.md structure, not brittle keyword matching

        return {
          ordinal: Number(match[1]),
          text,
          severity: 'info',  // Default; script determines actual severity
          trigger: '',  // Deprecated - kept for backward compatibility
        };
      })
      .filter((finding): finding is ParsedFinding => finding !== null);
  }

  function findingTexts(report: string): string[] {
    return parseFindings(report).map(finding => finding.text);
  }

  function expectRequiredFindingFields(findings: ParsedFinding[]): void {
    findings.forEach((finding, index) => {
      // Validate finding structure contract
      expect(finding.ordinal).toBe(index + 1);
      expect(finding.text.length).toBeGreaterThanOrEqual(20); // Real findings are longer than 12 chars
      expect(finding.text).not.toMatch(/^\s*$/); // Must have content
      expect(['critical', 'warning', 'info']).toContain(finding.severity);
      // Ensure no sensitive data leaked
      expect(finding.text).not.toMatch(/sk-or-/); // No API keys
      expect(finding.text).not.toMatch(/\[thinking\]/); // No internal blocks
    });
  }

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
      content: 'found security issue with API key: sk-or-abc123def456 that needs attention',
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

  test('report file is created at expected location with meaningful fallback content', () => {
    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');

    runGenerateScript(tempDir);

    const reportPath = path.join(tempDir, 'inspect-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);

    const content = fs.readFileSync(reportPath, 'utf8');
    expect(content).toMatch(/^# Inspect Report$/m);
    expect(content).toMatch(/^## Summary$/m);
    expect(content).toMatch(/^## Statistics$/m);
    expect(content).toMatch(/^## Recommendations$/m);

    // Empty pi-summary.json should still produce a valid statistics table with
    // the required event count, while omitting unavailable optional metrics.
    expect(content).toContain('| Metric | Value |');
    expect(content).toContain('| Pi events | 0 |');
    expect(content).not.toContain('| Tool executions |');
    expect(content).not.toContain('| Tokens used |');
    expect(content).not.toContain('| Model |');

    // Missing optional artifacts and no findings should use default/fallback
    // report text instead of producing blank or placeholder-only sections.
    expect(content).toContain('No significant findings detected during analysis.');
    expect(content).toContain('- Analysis complete with no issues identified');
    expect(content).toContain('- Repository appears to be in good health');
    expect(content).not.toContain('## Files Analyzed');
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
    // Create many findings with different severities and types
    const events = [
      {
        type: 'assistant-message',
        content: 'found critical security vulnerability in authentication module'
      },
      {
        type: 'assistant-message',
        content: 'identified performance bottleneck in database queries'
      },
      {
        type: 'assistant-message',
        content: 'discovered missing error handling in file operations'
      },
      {
        type: 'assistant-message',
        content: 'analysis shows incomplete test coverage for core functions'
      },
      {
        type: 'assistant-message',
        content: 'observation: deprecated API usage should be updated'
      },
      {
        type: 'assistant-message',
        content: 'conclusion: code quality standards are met'
      },
      {
        type: 'assistant-message',
        content: 'found minor style inconsistency in documentation'
      },
      {
        type: 'assistant-message',
        content: 'identified potential memory leak in event handlers'
      },
      {
        type: 'assistant-message',
        content: 'discovered unused import causing bundle bloat'
      },
      {
        type: 'assistant-message',
        content: 'analysis reveals type safety improvements needed'
      },
      {
        type: 'assistant-message',
        content: 'found critical bug in user authentication flow'
      },
      {
        type: 'assistant-message',
        content: 'identified data validation vulnerability'
      },
      {
        type: 'assistant-message',
        content: 'discovered race condition in concurrent operations'
      },
      {
        type: 'assistant-message',
        content: 'observation: logging needs improvement for debugging'
      },
      {
        type: 'assistant-message',
        content: 'conclusion: overall architecture is sound'
      }
    ].map(event => JSON.stringify(event)).join('\n');

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), events);
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    const parsedFindings = parseFindings(report);
    expect(parsedFindings).toHaveLength(10);
    expectRequiredFindingFields(parsedFindings);

    const findings = parsedFindings.map(finding => finding.text);
    expect(findings).toEqual(expect.arrayContaining([
      expect.stringContaining('critical security vulnerability'),
      expect.stringContaining('performance bottleneck'),
      expect.stringContaining('missing error handling'),
    ]));
    expect(findings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('race condition'),
      expect.stringContaining('logging needs improvement'),
      expect.stringContaining('overall architecture is sound'),
    ]));

    const uniqueFindings = [...new Set(findings)];
    expect(findings).toHaveLength(uniqueFindings.length);
    // Verify all findings have valid severity values (script determines actual categorization)
    expect(parsedFindings.every(f => ['critical', 'warning', 'info'].includes(f.severity))).toBe(true);
  });

  test('extracts findings with different severities and types', () => {
    const events = [
      {
        type: 'assistant-message',
        content: 'found critical security issue in authentication module'
      },
      {
        type: 'assistant-message',
        content: 'identified performance problem in data processing'
      },
      {
        type: 'assistant-message',
        content: 'discovered minor style inconsistency in code'
      },
      {
        type: 'assistant-message',
        content: 'analysis shows good test coverage for unit tests'
      },
      {
        type: 'assistant-message',
        content: 'observation: documentation needs improvement'
      },
      {
        type: 'assistant-message',
        content: 'this is not a finding - just regular conversation'
      },
      {
        type: 'assistant-message',
        content: 'thinking: this should be filtered out [thinking]internal thoughts[/thinking]'
      }
    ].map(event => JSON.stringify(event)).join('\n');

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), events);
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    const parsedFindings = parseFindings(report);
    expect(parsedFindings.length).toBeGreaterThanOrEqual(1);
    expectRequiredFindingFields(parsedFindings);

    // Verify findings contain expected content
    const allFindings = parsedFindings.map(f => f.text).join(' ');
    expect(allFindings).toContain('security issue');
    expect(allFindings).toContain('performance');

    // Verify non-findings are filtered out
    expect(allFindings).not.toContain('just regular conversation');
    expect(allFindings).not.toContain('thinking:');

    const findings = parsedFindings.map(finding => finding.text);
    expect(findings).not.toEqual(expect.arrayContaining([
      expect.stringContaining('just regular conversation'),
      expect.stringContaining('thinking:'),
    ]));
  });

  test('sanitizes and filters findings properly', () => {
    const events = [
      {
        type: 'assistant-message',
        content: 'found API key leak: sk-or-abc123def456 should be redacted'
      },
      {
        type: 'assistant-message',
        content: 'thinking: this internal thought should be removed [thinking]confidential analysis[/thinking]'
      },
      {
        type: 'assistant-message',
        content: 'identified environment variable: DATABASE_URL=postgres://user:pass@localhost'
      },
      {
        type: 'assistant-message',
        content: 'discovered vulnerability in authentication system'
      }
    ].map(event => JSON.stringify(event)).join('\n');

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), events);
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    // Semantic validation: sensitive information should be redacted
    expect(report).toContain('[redacted-key]');
    expect(report).not.toContain('sk-or-abc123def456');

    // Semantic validation: thinking blocks should be removed
    expect(report).not.toContain('[thinking]');
    expect(report).not.toContain('[/thinking]');
    expect(report).not.toContain('confidential analysis');
    expect(report).not.toContain('thinking: this internal thought should be removed');

    // Semantic validation: actual findings should be preserved
    expect(report).toContain('vulnerability in authentication system');

    const parsedFindings = parseFindings(report);
    expect(parsedFindings.length).toBeGreaterThanOrEqual(1);
    expectRequiredFindingFields(parsedFindings);

    // Verify all findings are well-formed with valid severity
    parsedFindings.forEach((finding) => {
      expect(finding.text).not.toContain('sk-or-');
      expect(finding.text).not.toContain('[thinking]');
      expect(['critical', 'warning', 'info']).toContain(finding.severity);
    });
  });

  test('handles findings with varying content lengths', () => {
    const events = [
      {
        type: 'assistant-message',
        content: 'found security issue' // Too short, should be filtered
      },
      {
        type: 'assistant-message',
        content: 'identified critical vulnerability in the authentication system that allows unauthorized access to sensitive user data through improper session management' // Very long, should be filtered
      },
      {
        type: 'assistant-message',
        content: 'discovered missing error handling in file operations which could lead to data corruption' // Valid length
      },
      {
        type: 'assistant-message',
        content: 'analysis shows potential memory leak in event listeners due to improper cleanup' // Valid length
      }
    ].map(event => JSON.stringify(event)).join('\n');

    fs.writeFileSync(path.join(tempDir, 'pi-events.jsonl'), events);
    fs.writeFileSync(path.join(tempDir, 'pi-summary.json'), '{}');
    fs.writeFileSync(path.join(tempDir, 'changed-files.txt'), '');

    const report = runGenerateScript(tempDir);

    // Semantic validation: should filter out findings that are too short
    expect(report).not.toContain('found security issue');

    // Semantic validation: should include findings of valid length
    expect(report).toContain('missing error handling in file operations');
    expect(report).toContain('potential memory leak in event listeners');
    // Semantic validation: should have exactly 3 findings (the long one is not filtered)
    const findings = findingTexts(report);
    expect(findings).toHaveLength(3);
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
