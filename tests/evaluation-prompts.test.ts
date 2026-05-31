import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

/**
 * Tests for evaluation prompt enhancements
 *
 * These tests verify that:
 * 1. Evaluation prompts include goal-setting context
 * 2. SMART framework is integrated into goal-check
 * 3. Confidence grounding guidance is present
 * 4. Evaluation JSON schemas remain valid
 */

describe('Evaluation Prompt Enhancements', () => {
  let kasekiAgentPath: string;

  beforeAll(() => {
    kasekiAgentPath = path.join(__dirname, '..', '..', 'kaseki-agent.sh');
    if (!fs.existsSync(kasekiAgentPath)) {
      throw new Error(`kaseki-agent.sh not found at ${kasekiAgentPath}`);
    }
  });

  describe('Goal-Check Prompt', () => {
    it('should include goal-setting artifact in prompt context', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      expect(scriptContent).toContain('GOAL_SETTING_ARTIFACT');
      expect(scriptContent).toContain('build_goal_check_prompt');
      expect(scriptContent).toContain('goal_setting_context');
    });

    it('should mention SMART framework in goal-check prompt', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 5000
      );
      expect(goalCheckSection.toLowerCase()).toContain('smart');
    });

    it('should include confidence grounding guidance', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 5000
      );
      expect(goalCheckSection).toContain('confidence');
      expect(goalCheckSection.toLowerCase()).toContain('grounding');
    });

    it('should request specific evidence with file/line references', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 5000
      );
      expect(goalCheckSection).toContain('specific');
      expect(goalCheckSection).toContain('verifiable');
      expect(goalCheckSection).toContain('line');
    });

    it('should maintain required JSON schema fields', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 6000
      );
      expect(goalCheckSection).toContain('"met"');
      expect(goalCheckSection).toContain('"confidence"');
      expect(goalCheckSection).toContain('"summary"');
      expect(goalCheckSection).toContain('"evidence"');
      expect(goalCheckSection).toContain('"retry_prompt"');
    });
  });

  describe('Run-Evaluation Prompt', () => {
    it('should include goal-setting artifact for quality context', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 5000
      );
      expect(runEvalSection).toContain('GOAL_SETTING_ARTIFACT');
      expect(runEvalSection).toContain('goal_setting_context');
    });

    it('should mention goal quality influence on reviewer confidence', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 6000
      );
      expect(runEvalSection.toLowerCase()).toContain('quality');
      expect(runEvalSection.toLowerCase()).toContain('confidence');
      expect(runEvalSection).toContain('goal');
    });

    it('should include stage value assessment framework', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 7000
      );
      expect(runEvalSection).toContain('stage');
      expect(runEvalSection).toContain('value');
    });

    it('should provide kaseki improvement categories and guidance', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 8000
      );
      expect(runEvalSection).toContain('category');
      expect(runEvalSection).toContain('priority');
      expect(runEvalSection).toContain('goal_setting');
    });

    it('should define task_completion_score framework tied to SMART', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 7000
      );
      expect(runEvalSection).toContain('task_completion_score');
      expect(runEvalSection).toContain('SMART');
    });

    it('should maintain required JSON schema fields', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 10000
      );
      expect(runEvalSection).toContain('"overall_assessment"');
      expect(runEvalSection).toContain('"reviewer_confidence"');
      expect(runEvalSection).toContain('"task_completion_score"');
      expect(runEvalSection).toContain('"stage_value"');
      expect(runEvalSection).toContain('"kaseki_improvement_opportunities"');
    });
  });

  describe('Feedback Collection Integration', () => {
    it('should collect goal-check feedback with the expected artifact contract', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const functionStart = scriptContent.indexOf('collect_goal_check_feedback() {');
      expect(functionStart).toBeGreaterThanOrEqual(0);

      const functionEnd = scriptContent.indexOf('\n}\n\ncollect_run_evaluation_feedback()', functionStart);
      expect(functionEnd).toBeGreaterThan(functionStart);
      const collectGoalCheckFeedbackFunction = scriptContent.slice(functionStart, functionEnd + 3);

      const lines = scriptContent.split('\n').map((line) => line.trim());
      const runGoalCheckLine = lines.findIndex((line) => line === 'run_goal_check "$coding_attempt"');
      expect(runGoalCheckLine).toBeGreaterThanOrEqual(0);
      const nextCommand = lines.slice(runGoalCheckLine + 1).find((line) => line.length > 0 && !line.startsWith('#'));
      expect(nextCommand).toBe('collect_goal_check_feedback "$INSTANCE_NAME"');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-check-feedback-contract-'));
      const fakeBin = path.join(tmpDir, 'bin');
      const fakeScriptsDir = path.join(tmpDir, 'scripts');
      const nodeArgsLog = path.join(tmpDir, 'node-args.log');
      const goalSettingPath = path.join(tmpDir, 'goal-setting.json');
      const resultsDir = path.join(tmpDir, 'results');
      const managedResults = ['goal-check.json', 'metadata.json', 'goal-feedback.jsonl'];
      const backups = new Map<string, string | null>();

      fs.mkdirSync(fakeBin, { recursive: true });
      fs.mkdirSync(fakeScriptsDir, { recursive: true });
      fs.writeFileSync(path.join(fakeScriptsDir, 'collect-feedback.js'), '// fixture path only\n');
      fs.writeFileSync(goalSettingPath, JSON.stringify({ quality_score: 91, success_criteria: ['specific', 'measurable'] }));
      fs.writeFileSync(
        path.join(fakeBin, 'node'),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(nodeArgsLog)}\nprintf '%s\\n' '{"phase":"goal_check","goal_check_verdict":{"met":true,"confidence":"high","evidenceCount":2,"missingCount":1},"goal_quality":{"score":91,"smart_criteria_count":2}}'\n`,
        { mode: 0o755 }
      );

      try {
        fs.mkdirSync(resultsDir, { recursive: true });
        for (const file of managedResults) {
        const filePath = path.join(resultsDir, file);
        backups.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null);
      }

      try {
        fs.writeFileSync(path.join(resultsDir, 'goal-check.json'), JSON.stringify({
          met: true,
          confidence: 'high',
          evidence: [{ file: 'src/example.ts', line: 12 }, { file: 'tests/example.test.ts', line: 4 }],
          missing: [{ requirement: 'none' }],
          summary: 'Goal met',
        }));
        fs.writeFileSync(path.join(resultsDir, 'metadata.json'), JSON.stringify({
          validation_passed: true,
          coding_attempts: 1,
          goal_check_met: true,
        }));
        fs.rmSync(path.join(resultsDir, 'goal-feedback.jsonl'), { force: true });

        const fixture = `set -euo pipefail\n${collectGoalCheckFeedbackFunction}\nPATH=${JSON.stringify(fakeBin)}:$PATH\nSCRIPT_DIR=${JSON.stringify(fakeScriptsDir)}\nGOAL_SETTING_ARTIFACT=${JSON.stringify(goalSettingPath)}\nGOAL_CHECK_EXIT=0\ncollect_goal_check_feedback contract-instance\n`;
        execFileSync('bash', ['-c', fixture], { encoding: 'utf8' });

        const nodeArgs = fs.readFileSync(nodeArgsLog, 'utf8').trim().split('\n');
        expect(nodeArgs).toEqual([
          path.join(fakeScriptsDir, 'collect-feedback.js'),
          'goal-check',
          'contract-instance',
          goalSettingPath,
          '/results/goal-check.json',
          '/results/metadata.json',
        ]);

        const feedbackLines = fs.readFileSync(path.join(resultsDir, 'goal-feedback.jsonl'), 'utf8').trim().split('\n');
        expect(feedbackLines).toHaveLength(1);
        const feedback = JSON.parse(feedbackLines[0]);
        expect(feedback).toMatchObject({
          phase: 'goal_check',
          goal_check_verdict: {
            met: true,
            confidence: 'high',
            evidenceCount: 2,
            missingCount: 1,
          },
          goal_quality: {
            score: 91,
            smart_criteria_count: 2,
          },
        });
      } finally {
        try {
          for (const [filePath, content] of backups) {
            if (content === null) {
              fs.rmSync(filePath, { force: true });
            } else {
              fs.writeFileSync(filePath, content);
            }
          }
        } catch (error) {
          // Ignore restoration errors to ensure tmpDir cleanup
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should have collect_run_evaluation_feedback function', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      expect(scriptContent).toContain('collect_run_evaluation_feedback');
    });

    it('should call collect_goal_check_feedback after goal-check', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const lines = scriptContent.split('\n').map((line) => line.trim());
      const runGoalCheckLine = lines.findIndex((line) => line === 'run_goal_check "$coding_attempt"');
      expect(runGoalCheckLine).toBeGreaterThanOrEqual(0);
      const nextCommand = lines.slice(runGoalCheckLine + 1).find((line) => line.length > 0 && !line.startsWith('#'));
      expect(nextCommand).toBe('collect_goal_check_feedback "$INSTANCE_NAME"');
    });

    it('should call collect_run_evaluation_feedback after run-evaluation', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('run_run_evaluation'),
        scriptContent.indexOf('run_run_evaluation') + 300
      );
      expect(runEvalSection).toContain('collect_run_evaluation_feedback');
    });
  });

  describe('Analysis Scripts', () => {
    it('should have collect-feedback.js script', () => {
      const collectFeedbackPath = path.join(__dirname, '..', '..', 'scripts', 'collect-feedback.js');
      expect(fs.existsSync(collectFeedbackPath)).toBe(true);
    });

    it('should have analyze-goal-feedback.js script', () => {
      const analyzePath = path.join(__dirname, '..', '..', 'scripts', 'analyze-goal-feedback.js');
      expect(fs.existsSync(analyzePath)).toBe(true);
    });

    it('collect-feedback.js should export goal-check and run-evaluation handlers', () => {
      const collectFeedbackPath = path.join(__dirname, '..', '..', 'scripts', 'collect-feedback.js');
      const content = fs.readFileSync(collectFeedbackPath, 'utf8');
      expect(content).toContain('collectGoalCheckFeedback');
      expect(content).toContain('collectRunEvaluationFeedback');
    });
  });

  describe('Documentation Updates', () => {
    it('should have EVALUATION_BEST_PRACTICES.md', () => {
      const docPath = path.join(__dirname, '..', '..', 'docs', 'EVALUATION_BEST_PRACTICES.md');
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toContain('SMART');
      expect(content).toContain('goal-check');
      expect(content).toContain('run-evaluation');
      expect(content).toContain('confidence');
    });

    it('should have FEEDBACK_LOOP_INTEGRATION.md', () => {
      const docPath = path.join(__dirname, '..', '..', 'docs', 'FEEDBACK_LOOP_INTEGRATION.md');
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toContain('Feedback Path');
      expect(content).toContain('goal quality');
      expect(content).toContain('improvement');
    });

    it('GOAL_SETTING_GUIDE.md should cross-reference evaluation docs', () => {
      const docPath = path.join(__dirname, '..', '..', 'docs', 'GOAL_SETTING_GUIDE.md');
      const content = fs.readFileSync(docPath, 'utf8');
      expect(content).toContain('EVALUATION_BEST_PRACTICES');
      expect(content).toContain('FEEDBACK_LOOP_INTEGRATION');
    });
  });

  describe('Schema Validation', () => {
    it('goal-check schema should require met as boolean', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const validationSection = scriptContent.substring(
        scriptContent.indexOf('typeof artifact.met !== "boolean"'),
        scriptContent.indexOf('typeof artifact.met !== "boolean"') + 200
      );
      expect(validationSection).toContain('boolean');
    });

    it('run-evaluation schema should validate reviewer_confidence enum', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      expect(scriptContent).toContain('reviewer_confidence');
      expect(scriptContent).toContain('high');
      expect(scriptContent).toContain('medium');
      expect(scriptContent).toContain('low');
    });

    it('task_completion_score should be validated as 1-5 integer', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      expect(scriptContent).toContain('task_completion_score');
    });
  });
});
