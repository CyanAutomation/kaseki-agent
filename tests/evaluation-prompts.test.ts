import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const renderer = path.join(projectRoot, 'scripts', 'render-prompt.sh');

type PromptName = 'goal-check' | 'run-evaluation' | 'agent';

type RenderOptions = {
  files?: Record<string, string>;
  env?: Record<string, string>;
  goalSettingArtifact?: string;
};

const renderPrompt = (name: PromptName, options: RenderOptions = {}) => {
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), `kaseki-${name}-prompt-`));
  try {
    for (const [relativePath, contents] of Object.entries(options.files ?? {})) {
      const filePath = path.join(resultsDir, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents);
    }
    return execFileSync('bash', [renderer, name], {
      encoding: 'utf8',
      env: {
        ...process.env,
        KASEKI_RESULTS_DIR: resultsDir,
        TASK_PROMPT: 'Implement pagination with regression coverage.',
        GOAL_SETTING_ARTIFACT: path.join(resultsDir, options.goalSettingArtifact ?? 'goal-setting.json'),
        SCOUTING_ARTIFACT: path.join(resultsDir, 'scouting.json'),
        TEST_IMPACT_WARNINGS_ARTIFACT: path.join(resultsDir, 'test-impact-warnings.json'),
        ...options.env,
      },
    });
  } finally {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }
};

const requiredJsonFields = (prompt: string, heading: string, nextHeading: string) => {
  const start = prompt.indexOf(heading);
  const end = prompt.indexOf(nextHeading, start + heading.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return [...prompt.slice(start, end).matchAll(/^ {2}"([^"]+)":/gm)].map(match => match[1]);
};

describe('rendered prompt contracts', () => {
  it('rejects a missing prompt name with usage guidance', () => {
    const result = spawnSync('bash', [renderer], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Usage:');
  });

  it.each([
    {
      name: 'goal-check' as const,
      sections: ['## Your Task', '## Inputs to Inspect', '## Bounded evidence collection', '## Evaluation: SMART Criteria Check', '## Confidence Mapping', '## Retry Guidance', '## Required JSON artifact', '## Context'],
    },
    {
      name: 'run-evaluation' as const,
      sections: ['## Your Task', '## Inputs to Use', '## Evaluation Framework', '## Required JSON Output', '## Rules', '## Context'],
    },
    {
      name: 'agent' as const,
      sections: ['Operational guardrails:', 'Task:'],
    },
  ])('$name includes its required sections', ({ name, sections }) => {
    const prompt = renderPrompt(name);
    for (const section of sections) expect(prompt).toContain(section);
  });

  it('instructs goal-check to preserve output for the required verdict', () => {
    const prompt = renderPrompt('goal-check');
    expect(prompt).toContain('output target is advisory, not a completion limit');
    expect(prompt).toContain('Do not read the full git diff');
    expect(prompt).toMatch(/never spend your final\s+turn on another tool call/);
  });

  it.each([
    {
      name: 'goal-check' as const,
      heading: '## Required JSON artifact',
      nextHeading: '## Context',
      fields: ['met', 'confidence', 'summary', 'evidence', 'missing', 'retry_prompt', 'validation_notes', 'evidence_sources_inspected', 'contradictions', 'confidence_calibration'],
    },
    {
      name: 'run-evaluation' as const,
      heading: '## Required JSON Output',
      nextHeading: '## Rules',
      fields: ['overall_assessment', 'reviewer_confidence', 'task_completion_score', 'summary', 'human_review_focus', 'stage_value', 'evidence_sources_inspected', 'contradictions', 'confidence_calibration', 'phase_scorecard', 'efficiency_findings', 'kaseki_improvement_opportunities', 'pr_summary', 'warnings'],
    },
  ])('$name exposes the required artifact schema', ({ name, heading, nextHeading, fields }) => {
    expect(requiredJsonFields(renderPrompt(name), heading, nextHeading)).toEqual(fields);
  });

  it.each([
    {
      name: 'goal-check' as const,
      files: { 'goal-setting.json': '{}', 'test-impact-warnings.json': 'SUPPLIED_WARNING_CONTEXT' },
      env: { TASK_PROMPT: 'SUPPLIED_TASK_CONTEXT' },
      included: ['SUPPLIED_WARNING_CONTEXT', 'SUPPLIED_TASK_CONTEXT'],
    },
    {
      name: 'run-evaluation' as const,
      files: { 'goal-setting.json': '{"quality_score":91}', 'progress.jsonl': 'SUPPLIED_PROGRESS_CONTEXT' },
      env: { DRAFT_PR_BODY: 'SUPPLIED_PR_CONTEXT' },
      included: ['"quality_score":91', 'SUPPLIED_PROGRESS_CONTEXT', 'SUPPLIED_PR_CONTEXT'],
    },
    {
      name: 'agent' as const,
      files: { 'scouting.json': '{}' },
      env: { REPO_MEMORY_SECTION: '\nSUPPLIED_MEMORY_CONTEXT', GOAL_CHECK_RETRY_PROMPT: 'SUPPLIED_RETRY_CONTEXT' },
      included: ['SUPPLIED_MEMORY_CONTEXT', 'SUPPLIED_RETRY_CONTEXT', 'Scouting artifact:'],
    },
  ])('$name includes supplied context', ({ name, files, env, included }) => {
    const prompt = renderPrompt(name, { files, env });
    for (const value of included) expect(prompt).toContain(value);
  });

  it.each([
    { name: 'goal-check' as const, omitted: ['GOAL-SETTING ARTIFACT:', 'VALIDATION CAUSALITY ANALYSIS:'] },
    { name: 'run-evaluation' as const, omitted: ['GOAL-SETTING OUTPUT (use to calibrate reviewer_confidence):'] },
    { name: 'agent' as const, omitted: ['Scouting artifact:', 'Goal-check retry guidance:', 'Summarization Analysis:'] },
  ])('$name omits unavailable optional context', ({ name, omitted }) => {
    const prompt = renderPrompt(name);
    for (const value of omitted) expect(prompt).not.toContain(value);
  });

  it.each(['goal-check', 'run-evaluation', 'agent'] as const)(
    '%s preserves hostile fixture text without executing it',
    name => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostile-prompt-fixture-'));
      const touched = path.join(tmpDir, 'executed');
      const hostile = `HOSTILE_$(touch ${touched})_\`touch ${touched}\`_EOF`;
      try {
        const prompt = renderPrompt(name, {
          files: name === 'agent' ? { 'scouting.json': '{}' } : { 'goal-setting.json': hostile },
          env: { TASK_PROMPT: hostile },
        });
        expect(prompt).toContain(hostile);
        expect(fs.existsSync(touched)).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  it('reads artifact paths containing spaces without interpreting their contents', () => {
    const relativePath = 'artifact fixtures/goal setting.json';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki prompt paths '));
    const touched = path.join(tmpDir, 'executed');
    const hostile = `PATH_SAFE_$(touch ${touched})_\`touch ${touched}\``;

    try {
      const prompt = renderPrompt('run-evaluation', {
        files: { [relativePath]: hostile },
        goalSettingArtifact: relativePath,
      });

      expect(prompt).toContain(hostile);
      expect(fs.existsSync(touched)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('shell orchestration integration', () => {
  test('consumes the prompt returned by the sourced goal-check renderer', () => {
    const output = execFileSync('bash', ['-c', `
      set -euo pipefail
      get_caveman_instruction() { :; }
      source "$1/scripts/evaluation-prompts.sh"
      build_goal_check_prompt() { printf '%s' 'RENDERED_PROMPT_SENTINEL'; }
      run_pi_stage() { [ "$2" = 'RENDERED_PROMPT_SENTINEL' ]; printf '%s' "$2"; }
      goal_prompt="$(build_goal_check_prompt)"
      run_pi_stage goal-check "$goal_prompt"
    `, 'bash', projectRoot], { encoding: 'utf8' });

    expect(output).toBe('RENDERED_PROMPT_SENTINEL');
  });
});
