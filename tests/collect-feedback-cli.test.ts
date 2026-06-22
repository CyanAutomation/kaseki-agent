/**
 * Tests for collect-feedback.js CLI functionality
 * Verifies that the script works as a command-line tool
 * after converting exported functions to internal
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('collect-feedback.js CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('should handle goal-check phase with valid JSON files', () => {
    // Create test fixtures
    const goalSetting = {
      quality_score: 85,
      quality_metrics: { clarity: 0.9 },
      success_criteria: ['criterion 1', 'criterion 2'],
    };

    const goalCheck = {
      met: true,
      confidence: 'high',
      evidence: ['ev1', 'ev2'],
      missing: [],
    };

    const metadata = {
      validation_passed: true,
      coding_attempts: 1,
      total_duration_seconds: 120,
      goal_check_met: true,
    };

    const goalSettingPath = path.join(tmpDir, 'goal-setting.json');
    const goalCheckPath = path.join(tmpDir, 'goal-check.json');
    const metadataPath = path.join(tmpDir, 'metadata.json');

    fs.writeFileSync(goalSettingPath, JSON.stringify(goalSetting));
    fs.writeFileSync(goalCheckPath, JSON.stringify(goalCheck));
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));

    // Run CLI
    const output = execSync(
      `node dist/collect-feedback.js goal-check kaseki-1 ${goalSettingPath} ${goalCheckPath} ${metadataPath}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    // Parse output as JSONL
    const feedback = JSON.parse(output.trim());

    // Verify structure
    expect(feedback.phase).toBe('goal_check');
    expect(feedback.instance_name).toBe('kaseki-1');
    expect(feedback.goal_quality).toBeDefined();
    expect(feedback.goal_check_verdict).toBeDefined();
    expect(feedback.goal_check_verdict.met).toBe(true);
  });

  test('should handle run-evaluation phase with valid JSON files', () => {
    // Create test fixtures
    const runEvaluation = {
      overall_assessment: 'good',
      reviewer_confidence: 'high',
      task_completion_score: 8,
      stage_value: [{ stage: 'scouting', value: 'good' }],
      kaseki_improvement_opportunities: [{ category: 'complexity', priority: 'medium' }],
    };

    const metadata = {
      validation_passed: true,
      coding_attempts: 1,
      total_duration_seconds: 120,
      goal_check_met: true,
    };

    const runEvaluationPath = path.join(tmpDir, 'run-evaluation.json');
    const metadataPath = path.join(tmpDir, 'metadata.json');

    fs.writeFileSync(runEvaluationPath, JSON.stringify(runEvaluation));
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));

    // Run CLI
    const output = execSync(
      `node dist/collect-feedback.js run-evaluation kaseki-1 ${runEvaluationPath} ${metadataPath}`,
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    // Parse output as JSONL
    const feedback = JSON.parse(output.trim());

    // Verify structure
    expect(feedback.phase).toBe('run_evaluation');
    expect(feedback.instance_name).toBe('kaseki-1');
    expect(feedback.assessment).toBeDefined();
    expect(feedback.assessment.overall_assessment).toBe('good');
  });

  test('should handle missing files gracefully', () => {
    // Run CLI with non-existent files - should return empty objects for missing files
    const output = execSync(
      'node dist/collect-feedback.js goal-check kaseki-1 /nonexistent/1.json /nonexistent/2.json /nonexistent/3.json',
      { encoding: 'utf-8', cwd: process.cwd() }
    );

    // Parse output as JSONL - should still produce valid feedback even with missing files
    const feedback = JSON.parse(output.trim());
    expect(feedback.phase).toBe('goal_check');
    expect(feedback.instance_name).toBe('kaseki-1');
  });

  test('should show usage on invalid arguments', () => {
    expect(() => {
      execSync('node dist/collect-feedback.js', {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
    }).toThrow();
  });
});
