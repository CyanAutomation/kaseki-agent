/**
 * Tests for collect-feedback CLI feedback semantics via the TypeScript source entry point.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('collect-feedback TypeScript source CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function writeJson(name: string, value: unknown): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, JSON.stringify(value));
    return filePath;
  }

  function runSourceCli(args: string[]) {
    return spawnSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), ['scripts/collect-feedback.ts', ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
  }

  function parseStdout(result: ReturnType<typeof runSourceCli>): Record<string, unknown> {
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    return JSON.parse(result.stdout.trim());
  }

  test('emits full goal-check feedback semantics with valid JSON files', () => {
    const goalSettingPath = writeJson('goal-setting.json', {
      quality_score: 85,
      quality_metrics: { clarity: 0.9, specificity: 0.8 },
      success_criteria: ['criterion 1', 'criterion 2'],
    });
    const goalCheckPath = writeJson('goal-check.json', {
      met: true,
      confidence: 'high',
      evidence: ['ev1', 'ev2'],
      missing: ['minor note'],
    });
    const metadataPath = writeJson('metadata.json', {
      validation_passed: true,
      coding_attempts: 3,
      total_duration_seconds: 120,
      goal_check_met: true,
    });

    const result = runSourceCli(['goal-check', 'kaseki-1', goalSettingPath, goalCheckPath, metadataPath]);

    expect(parseStdout(result)).toMatchObject({
      phase: 'goal_check',
      instance_name: 'kaseki-1',
      goal_quality: {
        score: 85,
        metrics: { clarity: 0.9, specificity: 0.8 },
        smart_criteria_count: 2,
      },
      goal_check_verdict: {
        met: true,
        confidence: 'high',
        evidenceCount: 2,
        missingCount: 1,
      },
      outcomes: {
        validation_passed: true,
        coding_attempts: 3,
        total_duration_seconds: 120,
        goal_check_met: true,
      },
      correlation: {
        goal_quality: 85,
        verdict_met: true,
        success: true,
        confidence_grade: 'high',
        notes: [],
      },
    });
  });

  test('emits full run-evaluation feedback semantics with valid JSON files', () => {
    const runEvaluationPath = writeJson('run-evaluation.json', {
      overall_assessment: 'good',
      reviewer_confidence: 'high',
      task_completion_score: 8,
      stage_value: [{ stage: 'scouting', value: 'good' }],
      kaseki_improvement_opportunities: [{ category: 'complexity', priority: 'medium' }],
    });
    const metadataPath = writeJson('metadata.json', {
      validation_passed: false,
      coding_attempts: 2,
      total_duration_seconds: 240,
      goal_check_met: false,
    });

    const result = runSourceCli(['run-evaluation', 'kaseki-1', runEvaluationPath, metadataPath]);

    expect(parseStdout(result)).toMatchObject({
      phase: 'run_evaluation',
      instance_name: 'kaseki-1',
      assessment: {
        overall_assessment: 'good',
        reviewer_confidence: 'high',
        task_completion_score: 8,
      },
      stage_values: [{ stage: 'scouting', value: 'good' }],
      improvements: [{ category: 'complexity', priority: 'medium' }],
      outcomes: {
        validation_passed: false,
        coding_attempts: 2,
        total_duration_seconds: 240,
        goal_check_met: false,
      },
    });
  });

  test('emits omitted/default behavior when goal-check files are missing', () => {
    const result = runSourceCli([
      'goal-check',
      'kaseki-1',
      path.join(tmpDir, 'missing-goal-setting.json'),
      path.join(tmpDir, 'missing-goal-check.json'),
      path.join(tmpDir, 'missing-metadata.json'),
    ]);

    expect(parseStdout(result)).toMatchObject({
      phase: 'goal_check',
      instance_name: 'kaseki-1',
      goal_quality: {
        score: 0,
        metrics: {},
        smart_criteria_count: 0,
      },
      goal_check_verdict: {
        met: false,
        confidence: 'unknown',
        evidenceCount: 0,
        missingCount: 0,
      },
      outcomes: {
        validation_passed: false,
        coding_attempts: 1,
        total_duration_seconds: 0,
        goal_check_met: false,
      },
      correlation: {
        goal_quality: 0,
        verdict_met: false,
        success: false,
        confidence_grade: 'unknown',
        notes: [],
      },
    });
  });

  test('emits omitted/default behavior when run-evaluation files are missing', () => {
    const result = runSourceCli([
      'run-evaluation',
      'kaseki-1',
      path.join(tmpDir, 'missing-run-evaluation.json'),
      path.join(tmpDir, 'missing-metadata.json'),
    ]);

    expect(parseStdout(result)).toMatchObject({
      phase: 'run_evaluation',
      instance_name: 'kaseki-1',
      assessment: {
        overall_assessment: 'unknown',
        reviewer_confidence: 'unknown',
        task_completion_score: 0,
      },
      stage_values: [],
      improvements: [],
      outcomes: {
        validation_passed: false,
        coding_attempts: 1,
        total_duration_seconds: 0,
        goal_check_met: false,
      },
    });
  });

  test.each([
    { args: [], usage: 'Usage: collect-feedback.js <phase> <instance_name> [paths...]' },
    { args: ['goal-check', 'kaseki-1'], usage: 'Usage: collect-feedback.js goal-check <instance_name> <goal_setting_json> <goal_check_json> <metadata_json>' },
    { args: ['run-evaluation', 'kaseki-1'], usage: 'Usage: collect-feedback.js run-evaluation <instance_name> <run_evaluation_json> <metadata_json>' },
    { args: ['unknown', 'kaseki-1'], usage: 'Unknown phase: unknown' },
  ])('returns exit status and usage text for invalid arguments: $usage', ({ args, usage }) => {
    const result = runSourceCli(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(usage);
  });
});
