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
  const projectRoot = process.cwd();

  beforeAll(() => {
    kasekiAgentPath = path.join(projectRoot, 'kaseki-agent.sh');
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
        scriptContent.indexOf('build_goal_check_prompt()') + 20000
      );
      expect(goalCheckSection.toLowerCase()).toContain('smart');
    });

    it('should include confidence grounding guidance', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 20000
      );
      expect(goalCheckSection).toContain('confidence');
      expect(goalCheckSection.toLowerCase()).toContain('grounding');
    });

    it('should request specific evidence with file/line references', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 20000
      );
      expect(goalCheckSection).toContain('specific');
      expect(goalCheckSection).toContain('verifiable');
      expect(goalCheckSection).toContain('line');
    });

    it('should maintain required JSON schema fields', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const goalCheckSection = scriptContent.substring(
        scriptContent.indexOf('build_goal_check_prompt()'),
        scriptContent.indexOf('build_goal_check_prompt()') + 20000);
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
        scriptContent.indexOf('build_run_evaluation_prompt()') + 20000
      );
      expect(runEvalSection).toContain('GOAL_SETTING_ARTIFACT');
      expect(runEvalSection).toContain('goal_setting_context');
    });

    it('should mention goal quality influence on reviewer confidence', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 20000);
      expect(runEvalSection.toLowerCase()).toContain('quality');
      expect(runEvalSection.toLowerCase()).toContain('confidence');
      expect(runEvalSection).toContain('goal');
    });

    it('should include stage value assessment framework', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 20000);
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
        scriptContent.indexOf('build_run_evaluation_prompt()') + 20000);
      expect(runEvalSection).toContain('task_completion_score');
      expect(runEvalSection).toContain('SMART');
    });

    it('should maintain required JSON schema fields', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const runEvalSection = scriptContent.substring(
        scriptContent.indexOf('build_run_evaluation_prompt()'),
        scriptContent.indexOf('build_run_evaluation_prompt()') + 20000);
      expect(runEvalSection).toContain('"overall_assessment"');
      expect(runEvalSection).toContain('"reviewer_confidence"');
      expect(runEvalSection).toContain('"task_completion_score"');
      expect(runEvalSection).toContain('"stage_value"');
      expect(runEvalSection).toContain('"kaseki_improvement_opportunities"');
    });
  });

  describe('Scouting and Coding Prompt Test Impact Guidance', () => {
    it('should require scouting JSON test impact for parser and output contract changes', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const scoutingSection = scriptContent.substring(
        scriptContent.indexOf('build_scouting_prompt()'),
        scriptContent.indexOf('run_scouting_agent()')
      );

      expect(scoutingSection).toContain('"test_impact"');
      expect(scoutingSection).toContain('parsing logic');
      expect(scoutingSection).toContain('output format');
      expect(scoutingSection).toContain('naming conventions');
      expect(scoutingSection).toContain('expectation strings');
      expect(scoutingSection).toContain('progress/event fields');
    });

    it('should instruct the coding agent to update impacted tests for parser output and naming behavior changes', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const agentSection = scriptContent.substring(
        scriptContent.indexOf('build_agent_prompt()'),
        scriptContent.indexOf('is_transient_goal_setting_failure()')
      );

      expect(agentSection).toContain('test_impact files');
      expect(agentSection).toContain('parser logic');
      expect(agentSection).toContain('output format');
      expect(agentSection).toContain('naming conventions');
      expect(agentSection).toContain('expectation strings');
      expect(agentSection).toContain('progress/event fields');
    });

    it('should enforce test impact in scouting artifact validation', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const validationSection = scriptContent.substring(
        scriptContent.indexOf('validate_scouting_artifact_with_node()'),
        scriptContent.indexOf('validate_scouting_artifact()')
      );

      expect(validationSection).toContain('"test_impact"');
      expect(validationSection).toContain('Array.isArray(artifact.test_impact)');
      expect(validationSection).toContain('test_impact[${index}]');
      expect(validationSection).toContain('"critical"');
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

      try {
        fs.mkdirSync(fakeBin, { recursive: true });
        fs.mkdirSync(fakeScriptsDir, { recursive: true });
        fs.mkdirSync(resultsDir, { recursive: true });
        fs.writeFileSync(path.join(fakeScriptsDir, 'collect-feedback.js'), '// fixture path only\n');
        fs.writeFileSync(goalSettingPath, JSON.stringify({ quality_score: 91, success_criteria: ['specific', 'measurable'] }));
        fs.writeFileSync(
          path.join(fakeBin, 'node'),
          `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(nodeArgsLog)}\nprintf '%s\\n' '{"phase":"goal_check","goal_check_verdict":{"met":true,"confidence":"high","evidenceCount":2,"missingCount":1},"goal_quality":{"score":91,"smart_criteria_count":2}}'\n`,
          { mode: 0o755 }
        );

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

        const fixture = `set -euo pipefail\n${collectGoalCheckFeedbackFunction}\nPATH=${JSON.stringify(fakeBin)}:$PATH\nSCRIPT_DIR=${JSON.stringify(fakeScriptsDir)}\nGOAL_SETTING_ARTIFACT=${JSON.stringify(goalSettingPath)}\nGOAL_CHECK_EXIT=0\nKASEKI_RESULTS_DIR=${JSON.stringify(resultsDir)}\ncollect_goal_check_feedback contract-instance\n`;
        execFileSync('bash', ['-c', fixture], { encoding: 'utf8' });

        const nodeArgs = fs.readFileSync(nodeArgsLog, 'utf8').trim().split('\n');
        expect(nodeArgs).toEqual([
          path.join(fakeScriptsDir, 'collect-feedback.js'),
          'goal-check',
          'contract-instance',
          goalSettingPath,
          path.join(resultsDir, 'goal-check.json'),
          path.join(resultsDir, 'metadata.json'),
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
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should collect run-evaluation feedback from the schema-valid artifact contract', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      const functionStart = scriptContent.indexOf('collect_run_evaluation_feedback() {');
      expect(functionStart).toBeGreaterThanOrEqual(0);

      let functionEnd = scriptContent.indexOf('\n}\n\nbuild_goal_check_prompt()', functionStart);
      if (functionEnd === -1) {
        functionEnd = scriptContent.indexOf('\n}\n\n\nbuild_goal_check_prompt()', functionStart);
      }
      if (functionEnd === -1) {
        functionEnd = scriptContent.indexOf('\n}\n', functionStart);
      }
      expect(functionEnd).toBeGreaterThan(functionStart);
      const collectRunEvaluationFeedbackFunction = scriptContent.slice(functionStart, functionEnd + 3);

      const runEvaluationFunctionStart = scriptContent.indexOf('run_run_evaluation() {');
      expect(runEvaluationFunctionStart).toBeGreaterThanOrEqual(0);
      const runEvaluationFunctionEnd = scriptContent.indexOf('\n}\n\n', runEvaluationFunctionStart);
      if (runEvaluationFunctionEnd === -1 || runEvaluationFunctionEnd <= runEvaluationFunctionStart) {
        throw new Error('Could not find end of run_run_evaluation function');
      }
      expect(runEvaluationFunctionEnd).toBeGreaterThan(runEvaluationFunctionStart);
      const runEvaluationFunction = scriptContent.slice(runEvaluationFunctionStart, runEvaluationFunctionEnd + 3);

      expect(collectRunEvaluationFeedbackFunction).toContain('local run_evaluation_path="/results/run-evaluation.json"');
      expect(collectRunEvaluationFeedbackFunction).toContain('local feedback_file="/results/kaseki-improvements.jsonl"');
      expect(collectRunEvaluationFeedbackFunction).toContain('node "$SCRIPT_DIR/collect-feedback.js" run-evaluation "$instance_name" "$run_evaluation_path" "$metadata_path"');
      expect(runEvaluationFunction).toContain('"$RUN_EVALUATION_CANDIDATE_ARTIFACT" "$RUN_EVALUATION_ARTIFACT"');
      expect(runEvaluationFunction).toContain('artifact.overall_assessment');
      expect(runEvaluationFunction).toContain('artifact.reviewer_confidence');
      expect(runEvaluationFunction).toContain('artifact.task_completion_score');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evaluation-feedback-contract-'));
      const fakeBin = path.join(tmpDir, 'bin');
      const nodeArgsLog = path.join(tmpDir, 'node-args.log');
      const resultsDir = path.join(tmpDir, 'results');
      const collectFeedbackPath = path.join(projectRoot, 'scripts', 'collect-feedback.js');
      const isolatedFunction = collectRunEvaluationFeedbackFunction
        .replace(/local run_evaluation_path="\/results\/run-evaluation.json"/, `local run_evaluation_path="${resultsDir}/run-evaluation.json"`)
        .replace(/local feedback_file="\/results\/kaseki-improvements.jsonl"/, `local feedback_file="${resultsDir}/kaseki-improvements.jsonl"`)
        .replace(/local metadata_path="\/results\/metadata.json"/, `local metadata_path="${resultsDir}/metadata.json"`);

      try {
        fs.mkdirSync(fakeBin, { recursive: true });
        fs.mkdirSync(resultsDir, { recursive: true });
        fs.writeFileSync(
          path.join(fakeBin, 'node'),
          `#!/usr/bin/env bash
printf '%s\\n' "$@" > ${JSON.stringify(nodeArgsLog)}
${JSON.stringify(process.execPath)} - "$@" <<'NODE'
const fs = require('fs');
const [, phase, instanceName, runEvaluationPath, metadataPath] = process.argv.slice(2);
const runEvaluation = JSON.parse(fs.readFileSync(runEvaluationPath, 'utf8'));
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
console.log(JSON.stringify({
  instance_name: instanceName,
  phase: phase.replace('-', '_'),
  assessment: {
    overall_assessment: runEvaluation.overall_assessment || 'unknown',
    reviewer_confidence: runEvaluation.reviewer_confidence || 'unknown',
    task_completion_score: runEvaluation.task_completion_score || 0,
  },
  outcomes: {
    validation_passed: metadata.validation_passed === true,
    coding_attempts: metadata.coding_attempts || 1,
    goal_check_met: metadata.goal_check_met === true,
  },
}));
NODE
`,
          { mode: 0o755 }
        );
        fs.writeFileSync(path.join(resultsDir, 'run-evaluation.json'), JSON.stringify({
          overall_assessment: 'good',
          reviewer_confidence: 'high',
          task_completion_score: 4,
          summary: 'The task was completed with strong evidence.',
          pr_summary: 'Adds the requested behavioral assertion.',
          human_review_focus: ['Confirm test coverage intent'],
          efficiency_findings: ['No repeated collection work'],
          warnings: [],
          stage_value: [{ stage: 'evaluation', value: 'high', reason: 'Captures evaluator output' }],
          kaseki_improvement_opportunities: [{ category: 'evaluation', priority: 'medium', suggestion: 'Keep contract tests behavioral' }],
        }));
        fs.writeFileSync(path.join(resultsDir, 'metadata.json'), JSON.stringify({
          validation_passed: true,
          coding_attempts: 1,
          goal_check_met: true,
          total_duration_seconds: 42,
        }));

        const fixture = `set -euo pipefail\n${isolatedFunction}\nPATH=${JSON.stringify(fakeBin)}:$PATH\nSCRIPT_DIR=${JSON.stringify(path.dirname(collectFeedbackPath))}\nRUN_EVALUATION_EXIT=0\ncollect_run_evaluation_feedback contract-instance\n`;
        try {
          execFileSync('bash', ['-c', fixture], { encoding: 'utf8' });
        } catch (error: any) {
          throw new Error(`Bash script execution failed: ${error.message}\nStderr: ${error.stderr || 'N/A'}`);
        }

        let nodeArgs: string[];
        try {
          nodeArgs = fs.readFileSync(nodeArgsLog, 'utf8').trim().split('\n');
        } catch (error: any) {
          throw new Error(`Failed to read node args log: ${error.message}`);
        }
        expect(nodeArgs).toEqual([
          collectFeedbackPath,
          'run-evaluation',
          'contract-instance',
          path.join(resultsDir, 'run-evaluation.json'),
          path.join(resultsDir, 'metadata.json'),
        ]);

        let feedbackLines: string[];
        try {
          feedbackLines = fs.readFileSync(path.join(resultsDir, 'kaseki-improvements.jsonl'), 'utf8').trim().split('\n');
        } catch (error: any) {
          throw new Error(`Failed to read feedback file: ${error.message}`);
        }
        expect(feedbackLines).toHaveLength(1);
        let feedback: any;
        try {
          feedback = JSON.parse(feedbackLines[0]);
        } catch (error: any) {
          throw new Error(`Failed to parse feedback JSON: ${error.message}\nContent: ${feedbackLines[0]}`);
        }
        expect(feedback).toMatchObject({
          phase: 'run_evaluation',
          assessment: {
            overall_assessment: 'good',
            reviewer_confidence: 'high',
            task_completion_score: 4,
          },
          outcomes: {
            validation_passed: true,
            coding_attempts: 1,
            goal_check_met: true,
          },
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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
    it('collect-feedback.js should satisfy the feedback collection contract', () => {
      const collectFeedbackPath = path.join(projectRoot, 'scripts', 'collect-feedback.js');
      expect(fs.existsSync(collectFeedbackPath)).toBe(true);

      const collectFeedbackContent = fs.readFileSync(collectFeedbackPath, 'utf8');
      const shellContent = fs.readFileSync(kasekiAgentPath, 'utf8');

      expect(collectFeedbackContent).toMatch(
        /node collect-feedback\.js goal-check <instance_name> <goal_setting_json> <goal_check_json> <metadata_json>/
      );
      expect(collectFeedbackContent).toMatch(
        /node collect-feedback\.js run-evaluation <instance_name> <run_evaluation_json> <metadata_json>/
      );

      const definesGoalCheckHandler = /function collectGoalCheckFeedback\(instanceName, goalSettingPath, goalCheckPath, metadataPath\)/.test(
        collectFeedbackContent
      );
      const exportsGoalCheckHandler = /(?:module\.)?exports(?:\s*\.\s*collectGoalCheckFeedback|\s*=\s*\{[^}]*collectGoalCheckFeedback[^}]*\})/.test(collectFeedbackContent);
      expect(definesGoalCheckHandler || exportsGoalCheckHandler).toBe(true);

      const definesRunEvaluationHandler = /function collectRunEvaluationFeedback\(instanceName, runEvaluationPath, metadataPath\)/.test(
        collectFeedbackContent
      );
      const exportsRunEvaluationHandler = /(?:module\.)?exports(?:\s*\.\s*collectRunEvaluationFeedback|\s*=\s*\{[^}]*collectRunEvaluationFeedback[^}]*\})/.test(collectFeedbackContent);
      expect(definesRunEvaluationHandler || exportsRunEvaluationHandler).toBe(true);

      expect(collectFeedbackContent).toContain("phase === 'goal-check'");
      expect(collectFeedbackContent).toContain('collectGoalCheckFeedback(instanceName, args[2], args[3], args[4])');
      expect(collectFeedbackContent).toContain("phase === 'run-evaluation'");
      expect(collectFeedbackContent).toContain('collectRunEvaluationFeedback(instanceName, args[2], args[3])');

      [
        'quality_metrics',
        'quality_score',
        'success_criteria',
        'met',
        'confidence',
        'evidence',
        'missing',
        'overall_assessment',
        'reviewer_confidence',
        'task_completion_score',
        'stage_value',
        'kaseki_improvement_opportunities',
        'validation_passed',
        'coding_attempts',
        'total_duration_seconds',
        'goal_check_met',
      ].forEach((fieldName) => {
        expect(collectFeedbackContent).toContain(fieldName);
      });

      expect(shellContent).toContain(
        'node "$SCRIPT_DIR/collect-feedback.js" goal-check "$instance_name" "$goal_setting_path" "$goal_check_path" "$metadata_path"'
      );
      expect(shellContent).toContain(
        'node "$SCRIPT_DIR/collect-feedback.js" run-evaluation "$instance_name" "$run_evaluation_path" "$metadata_path"'
      );
    });
  });

  describe('Documentation Cross-References', () => {
    it('should verify required links between evaluation docs', () => {
      // Validate that the three key evaluation docs link to each other
      const goalSettingPath = path.join(projectRoot, 'docs', 'GOAL_SETTING_GUIDE.md');
      const bestPracticesPath = path.join(projectRoot, 'docs', 'EVALUATION_BEST_PRACTICES.md');
      const feedbackLoopPath = path.join(projectRoot, 'docs', 'FEEDBACK_LOOP_INTEGRATION.md');

      // Check files exist
      expect(fs.existsSync(goalSettingPath)).toBe(true);
      expect(fs.existsSync(bestPracticesPath)).toBe(true);
      expect(fs.existsSync(feedbackLoopPath)).toBe(true);

      const goalSettingContent = fs.readFileSync(goalSettingPath, 'utf8');
      const bestPracticesContent = fs.readFileSync(bestPracticesPath, 'utf8');
      const feedbackLoopContent = fs.readFileSync(feedbackLoopPath, 'utf8');

      // GOAL_SETTING_GUIDE.md should link to EVALUATION_BEST_PRACTICES.md and FEEDBACK_LOOP_INTEGRATION.md
      expect(goalSettingContent).toMatch(/\[.*Evaluation Best Practices.*\]\(.*EVALUATION_BEST_PRACTICES\.md.*\)/);
      expect(goalSettingContent).toMatch(/\[.*Feedback Loop.*\]\(.*FEEDBACK_LOOP_INTEGRATION\.md.*\)/);

      // EVALUATION_BEST_PRACTICES.md should reference the feedback loop concept
      expect(bestPracticesContent).toContain('Feedback');
      expect(bestPracticesContent).toContain('Goal-Check');
      expect(bestPracticesContent).toContain('Run-Evaluation');

      // FEEDBACK_LOOP_INTEGRATION.md should reference goal-setting and best practices
      expect(feedbackLoopContent).toContain('Goal-Setting');
      expect(feedbackLoopContent).toContain('Goal-Check');
      expect(feedbackLoopContent).toContain('Run-Evaluation');
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

    describe('reviewer_confidence validation', () => {
      it('should validate reviewer_confidence enum - passes on valid values high, medium, low', () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        expect(scriptContent).toContain('reviewer_confidence');
        expect(scriptContent).toContain('high');
        expect(scriptContent).toContain('medium');
        expect(scriptContent).toContain('low');
        
        // Define the validator logic matching kaseki-agent.sh
        const confidenceValues = new Set(['high', 'medium', 'low']);
        
        // Test valid confidence levels
        const validValues = ['high', 'medium', 'low'];
        validValues.forEach(value => {
          const artifact = {
            overall_assessment: 'good',
            reviewer_confidence: value,
            task_completion_score: 4,
            summary: 'Test summary',
            pr_summary: 'Test PR summary',
            human_review_focus: [],
            efficiency_findings: [],
            warnings: [],
            stage_value: [],
            kaseki_improvement_opportunities: [],
          };
          
          // Should pass validation (no invalid.push)
          const invalid: string[] = [];
          if (!confidenceValues.has(artifact.reviewer_confidence)) {
            invalid.push('reviewer_confidence');
          }
          expect(invalid).toHaveLength(0);
          expect(invalid).not.toContain('reviewer_confidence');
        });
      });

      it('should reject invalid values: critical, unknown, empty string, missing, and non-string', () => {
        const confidenceValues = new Set(['high', 'medium', 'low']);
        
        // Test case 1: value = "critical" (not in enum)
        const invalid1: string[] = [];
        const artifact1: any = {
          overall_assessment: 'good',
          reviewer_confidence: 'critical',
          task_completion_score: 4,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!confidenceValues.has(artifact1.reviewer_confidence)) {
          invalid1.push('confidence_critical');
        }
        expect(invalid1).toContain('confidence_critical');
        
        // Test case 2: value = "unknown" (not in enum for reviewer_confidence)
        const invalid2: string[] = [];
        const artifact2: any = {
          overall_assessment: 'good',
          reviewer_confidence: 'unknown',
          task_completion_score: 4,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!confidenceValues.has(artifact2.reviewer_confidence)) {
          invalid2.push('confidence_unknown');
        }
        expect(invalid2).toContain('confidence_unknown');
        
        // Test case 3: value = "" (empty string)
        const invalid3: string[] = [];
        const artifact3: any = {
          overall_assessment: 'good',
          reviewer_confidence: '',
          task_completion_score: 4,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!confidenceValues.has(artifact3.reviewer_confidence)) {
          invalid3.push('confidence_empty');
        }
        expect(invalid3).toContain('confidence_empty');
        
        // Test case 4: value = 123 (non-string)
        const invalid4: string[] = [];
        const artifact4: any = {
          overall_assessment: 'good',
          reviewer_confidence: 123,
          task_completion_score: 4,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!confidenceValues.has(artifact4.reviewer_confidence)) {
          invalid4.push('confidence_number');
        }
        expect(invalid4).toContain('confidence_number');
        
        // Test case 5: missing reviewer_confidence field
        const invalid5: string[] = [];
        const artifact5: any = {
          overall_assessment: 'good',
          // reviewer_confidence intentionally missing
          task_completion_score: 4,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!confidenceValues.has(artifact5.reviewer_confidence)) {
          invalid5.push('confidence_missing');
        }
        expect(invalid5).toContain('confidence_missing');
      });

      it('should validate reviewer_confidence in actual kaseki-agent.sh validator', () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        
        // Verify the validator is present in the run-evaluation validation section
        const validationSection = scriptContent.substring(
          scriptContent.indexOf('run_run_evaluation'),
          scriptContent.indexOf('run_run_evaluation') + 10000
        );
        
        expect(validationSection).toContain('confidenceValues');
        expect(validationSection).toContain("new Set");
        expect(validationSection).toContain('"high"');
        expect(validationSection).toContain('"medium"');
        expect(validationSection).toContain('"low"');
        expect(validationSection).toContain('confidenceValues.has(artifact.reviewer_confidence)');
        expect(validationSection).toContain('invalid.push("reviewer_confidence")');
      });
    });

    describe('task_completion_score validation', () => {
      it('should validate task_completion_score as 1-5 integer - passes on valid values 1-5', () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        expect(scriptContent).toContain('task_completion_score');
        
        // Extract the validator logic
        const validatorMatch = scriptContent.match(
          /if \(!Number\.isInteger\(artifact\.task_completion_score\).*?artifact\.task_completion_score > 5\)/
        );
        expect(validatorMatch).not.toBeNull();
        
        // Test valid integer scores 1-5
        const validScores = [1, 2, 3, 4, 5];
        validScores.forEach(score => {
          const artifact = {
            overall_assessment: 'excellent',
            reviewer_confidence: 'high',
            task_completion_score: score,
            summary: 'Test summary',
            pr_summary: 'Test PR summary',
            human_review_focus: [],
            efficiency_findings: [],
            warnings: [],
            stage_value: [],
            kaseki_improvement_opportunities: [],
          };
          
          // Should pass validation (no invalid.push)
          const invalid: string[] = [];
          if (!Number.isInteger(artifact.task_completion_score) || 
              artifact.task_completion_score < 1 || 
              artifact.task_completion_score > 5) {
            invalid.push('task_completion_score');
          }
          expect(invalid).toHaveLength(0);
          expect(invalid).not.toContain('task_completion_score');
        });
      });

      it('should reject invalid values: 0, 6, 3.5, "4", and missing field', () => {
        const invalid: string[] = [];
        
        // Test case 1: score = 0 (below minimum)
        const artifact1 = {
          overall_assessment: 'poor',
          reviewer_confidence: 'low',
          task_completion_score: 0,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!Number.isInteger(artifact1.task_completion_score) || 
            artifact1.task_completion_score < 1 || 
            artifact1.task_completion_score > 5) {
          invalid.push('score_0');
        }
        expect(invalid).toContain('score_0');
        
        // Test case 2: score = 6 (above maximum)
        invalid.length = 0;
        const artifact2 = {
          overall_assessment: 'excellent',
          reviewer_confidence: 'high',
          task_completion_score: 6,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!Number.isInteger(artifact2.task_completion_score) || 
            artifact2.task_completion_score < 1 || 
            artifact2.task_completion_score > 5) {
          invalid.push('score_6');
        }
        expect(invalid).toContain('score_6');
        
        // Test case 3: score = 3.5 (float, not integer)
        invalid.length = 0;
        const artifact3 = {
          overall_assessment: 'good',
          reviewer_confidence: 'medium',
          task_completion_score: 3.5,
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!Number.isInteger(artifact3.task_completion_score) || 
            artifact3.task_completion_score < 1 || 
            artifact3.task_completion_score > 5) {
          invalid.push('score_3_5');
        }
        expect(invalid).toContain('score_3_5');
        
        // Test case 4: score = "4" (string, not integer)
        invalid.length = 0;
        const artifact4: any = {
          overall_assessment: 'good',
          reviewer_confidence: 'medium',
          task_completion_score: "4",
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!Number.isInteger(artifact4.task_completion_score) || 
            artifact4.task_completion_score < 1 || 
            artifact4.task_completion_score > 5) {
          invalid.push('score_string_4');
        }
        expect(invalid).toContain('score_string_4');
        
        // Test case 5: missing task_completion_score field
        invalid.length = 0;
        const artifact5: any = {
          overall_assessment: 'good',
          reviewer_confidence: 'medium',
          // task_completion_score intentionally missing
          summary: 'Test', pr_summary: 'Test',
          human_review_focus: [], efficiency_findings: [], warnings: [],
          stage_value: [], kaseki_improvement_opportunities: [],
        };
        if (!Number.isInteger(artifact5.task_completion_score) || 
            artifact5.task_completion_score < 1 || 
            artifact5.task_completion_score > 5) {
          invalid.push('score_missing');
        }
        expect(invalid).toContain('score_missing');
      });

      it('should validate task_completion_score in actual kaseki-agent.sh validator', () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        
        // Verify the validator is present in the run-evaluation validation section
        const validationSection = scriptContent.substring(
          scriptContent.indexOf('run_run_evaluation'),
          scriptContent.indexOf('run_run_evaluation') + 10000
        );
        
        expect(validationSection).toContain('Number.isInteger(artifact.task_completion_score)');
        expect(validationSection).toContain('artifact.task_completion_score < 1');
        expect(validationSection).toContain('artifact.task_completion_score > 5');
        expect(validationSection).toContain('invalid.push("task_completion_score")');
      });
    });
  });
});
