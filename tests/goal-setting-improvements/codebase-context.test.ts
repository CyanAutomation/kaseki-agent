import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractShellFunctionBlock(scriptSource: string, startFunction: string, endFunction: string): string {
  const lines = scriptSource.split('\n');
  const startPattern = new RegExp(`^${escapeRegExp(startFunction)}\\(\\) \\{$`);
  const endPattern = new RegExp(`^${escapeRegExp(endFunction)}\\(\\) \\{$`);
  const startLine = lines.findIndex((line) => startPattern.test(line));
  const endLine = lines.findIndex((line, index) => index > startLine && endPattern.test(line));

  if (startLine === -1 || endLine === -1) {
    throw new Error(`Could not find ${startFunction} before ${endFunction}`);
  }

  return lines.slice(startLine, endLine).join('\n');
}

function renderGoalSettingPrompt(): string {
  const repoRoot = process.cwd();
  const scriptSource = readFileSync(path.join(repoRoot, 'kaseki-agent.sh'), 'utf8');
  const promptFunction = extractShellFunctionBlock(
    scriptSource,
    'build_goal_setting_prompt',
    'build_goal_setting_contract_repair_prompt',
  );
  const harness = [
    'get_caveman_instruction() { :; }',
    'validation_commands_for_goal_prompt() { printf \'%s\\n\' "$1"; }',
    'critical_change_contract_allows_noop() { return 1; }',
    promptFunction,
    'KASEKI_TASK_MODE=patch',
    'KASEKI_ALLOW_EMPTY_DIFF=0',
    'KASEKI_VALIDATION_COMMANDS=\'npm run check\'',
    'GOAL_SETTING_CANDIDATE_ARTIFACT=\'/tmp/goal-setting-candidate.json\'',
    'ORIGINAL_TASK_PROMPT=\'Fix null-safe parsing in src/parser.ts\'',
    'build_goal_setting_prompt',
  ].join('\n');

  return execFileSync('bash', ['-c', harness], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

// Requirement reference: docs/archive/GOAL_SETTING_IMPROVEMENTS.md, §3 "Codebase Context Preservation".
describe('Goal-Setting: Codebase Context Preservation (#3)', () => {
  let prompt: string;

  beforeAll(() => {
    prompt = renderGoalSettingPrompt();
  });

  it('renders repository-context guidance and requires evidence for codebase claims', () => {
    expect(prompt).toContain('- **Codebase context**: Tech stack, folder patterns, naming conventions');
    expect(prompt).toContain('Only name a file, version, or behavior after verifying it in the repository.');
    expect(prompt).toContain(
      'If evidence is ambiguous, record it as an open question rather than turning it into a success criterion.',
    );
  });

  it('keeps the user task authoritative while using repository context', () => {
    expect(prompt).toContain('Fix null-safe parsing in src/parser.ts');
    expect(prompt).toContain('The user\'s original prompt is authoritative.');
    expect(prompt).toContain('Do not add report/inventory deliverables, extra refactorings, test counts');
  });
});
