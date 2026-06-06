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

  const severityKeywords: Record<Severity, readonly string[]> = {
    critical: ['critical', 'vulnerability', 'leak', 'race condition', 'unauthorized'],
    warning: ['missing', 'performance', 'deprecated', 'memory leak', 'validation', 'needs improvement'],
    info: ['style', 'good', 'standards are met', 'architecture is sound'],
  } as const;

  const findingTriggers = ['found', 'identified', 'discovered', 'analysis', 'observation', 'conclusion'];

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

  function severityOf(finding: string): Severity {
    const lower = finding.toLowerCase();
    if (severityKeywords.warning.some(keyword => lower.includes(keyword))) return 'warning';
    if (severityKeywords.critical.some(keyword => lower.includes(keyword))) return 'critical';
    return 'info';
  }

  function parseFindings(report: string): ParsedFinding[] {
    return report
      .split('\n')
      .map((line): ParsedFinding | null => {
        const match = line.match(/^(\d+)\. (.+)$/);
        if (!match) return null;

        const text = match[2].trim();
        const trigger = findingTriggers.find(keyword => text.toLowerCase().includes(keyword));

        return {
          ordinal: Number(match[1]),
          text,
          severity: severityOf(text),
          trigger: trigger ?? '',
        };
      })
      .filter((finding): finding is ParsedFinding => finding !== null);
  }

  function findingTexts(report: string): string[] {
    return parseFindings(report).map(finding => finding.text);
  }

  function countBySeverity(findings: ParsedFinding[]): Record<Severity, number> {
    return findings.reduce<Record<Severity, number>>(
      (acc, finding) => {
        acc[finding.severity] += 1;
        return acc;
      },
      { critical: 0, warning: 0, info: 0 }
    );
  }

  function groupBySeverity(findings: ParsedFinding[]): Record<Severity, string[]> {
    return findings.reduce<Record<Severity, string[]>>(
      (acc, finding) => {
        acc[finding.severity].push(finding.text);
        return acc;
      },
      { critical: [], warning: [], info: [] }
    );
  }

  function expectRequiredFindingFields(findings: ParsedFinding[]): void {
    findings.forEach((finding, index) => {
      expect(finding.ordinal).toBe(index + 1);
      expect(finding.text.length).toBeGreaterThanOrEqual(12);
      expect(finding.text).not.toMatch(/^\s*$/);
      expect(finding.trigger).not.toBe('');
      expect(['critical', 'warning', 'info']).toContain(finding.severity);
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
    expect(countBySeverity(parsedFindings)).toEqual({ critical: 1, warning: 4, info: 5 });
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
    expect(parsedFindings).toHaveLength(5);
    expectRequiredFindingFields(parsedFindings);
    expect(countBySeverity(parsedFindings)).toEqual({ critical: 1, warning: 2, info: 2 });

    const grouped = groupBySeverity(parsedFindings);
    expect(grouped.critical).toEqual([expect.stringContaining('critical security issue')]);
    expect(grouped.warning).toEqual(expect.arrayContaining([
      expect.stringContaining('performance problem'),
      expect.stringContaining('documentation needs improvement'),
    ]));
    expect(grouped.info).toEqual(expect.arrayContaining([
      expect.stringContaining('style inconsistency'),
      expect.stringContaining('good test coverage'),
    ]));

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
    expect(parsedFindings).toHaveLength(3);
    expectRequiredFindingFields(parsedFindings);
    expect(countBySeverity(parsedFindings)).toEqual({ critical: 2, warning: 0, info: 1 });
    parsedFindings.forEach((finding) => {
      expect(finding.text).not.toContain('sk-or-');
      expect(finding.text).not.toContain('[thinking]');
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
