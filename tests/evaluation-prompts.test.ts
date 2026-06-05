import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';

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

  const writeJson = (filePath: string, value: unknown) => {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  };

  const renderGoalCheckPrompt = (goalSettingPath: string) => execFileSync(
    'bash',
    [
      '-c',
      `set -euo pipefail
eval "$(awk '
  index($0, "build_goal_check_prompt()") == 1 { emit=1 }
  index($0, "run_goal_check()") == 1 { emit=0 }
  emit { print }
' "$1")"
GOAL_SETTING_ARTIFACT="$2"
SCOUTING_ARTIFACT="$3/scouting.json"
TEST_IMPACT_WARNINGS_ARTIFACT="$3/test-impact-warnings.json"
GOAL_CHECK_CANDIDATE_ARTIFACT="$3/goal-check-candidate.json"
TASK_PROMPT="Add pagination support with concrete acceptance criteria and reject vague goals."
build_goal_check_prompt`,
      'render-goal-check-prompt',
      kasekiAgentPath,
      goalSettingPath,
      path.dirname(goalSettingPath),
    ],
    { encoding: 'utf8' }
  );

  describe('Goal-Check Prompt', () => {
    it('should include goal-setting artifact in prompt context', () => {
      const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
      expect(scriptContent).toContain('GOAL_SETTING_ARTIFACT');
      expect(scriptContent).toContain('build_goal_check_prompt');
      expect(scriptContent).toContain('goal_setting_context');
    });

    it('should render semantic SMART assessment guidance from the production goal-check prompt builder', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-check-prompt-contract-'));
      const goalSettingPath = path.join(tmpDir, 'goal-setting.json');

      try {
        writeJson(goalSettingPath, {
          upgraded_goal: 'Add API pagination support with clear request validation and regression coverage.',
          success_criteria: [
            'GET /items accepts page and pageSize query parameters with validation for positive integers.',
            'Pagination metadata includes total, page, pageSize, and totalPages in every successful response.',
            'Make pagination better.',
          ],
          smart_criteria: {
            specific: 'Pagination applies to GET /items only.',
            measurable: 'Acceptance criteria are verified by route-level tests and response fields.',
            achievable: 'Existing route handlers already centralize list responses.',
            relevant: 'The task asks for API pagination behavior.',
            time_bound: 'Complete within this coding-agent run.',
          },
          anti_patterns: ['Do not change unrelated endpoints.'],
        });

        const prompt = renderGoalCheckPrompt(goalSettingPath);

        expect(prompt).toContain('## Success Criteria Assessment Contract');
        expect(prompt).toContain('GOAL_CHECK_CONTRACT_PER_CRITERION_SMART');
        expect(prompt).toContain('GOAL_CHECK_CONTRACT_EVIDENCE_REQUIRED');
        expect(prompt).toContain('GOAL_CHECK_CONTRACT_MEASURABLE_ACCEPTANCE_CRITERIA');
        expect(prompt).toMatch(/each success criterion[\s\S]*all five SMART dimensions/i);
        expect(prompt).toMatch(/For every met or unmet criterion assessment[\s\S]*cite concrete evidence/i);
        expect(prompt).toMatch(/measurable acceptance criteria[\s\S]*observable pass\/fail conditions/i);
        expect(prompt).toMatch(/vague goals or intent statements[\s\S]*insufficient/i);
        expect(prompt).toContain('Make pagination better.');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
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
    const collectFeedbackPath = path.join(projectRoot, 'scripts', 'collect-feedback.js');

    const writeJson = (filePath: string, value: unknown) => {
      fs.writeFileSync(filePath, JSON.stringify(value));
    };

    const runCollectFeedback = (args: string[]) => spawnSync(
      process.execPath,
      [collectFeedbackPath, ...args],
      { encoding: 'utf8' }
    );

    const parseJsonStdout = (stdout: string) => {
      const output = stdout.trim();
      expect(output).not.toBe('');
      return JSON.parse(output);
    };

    it('should collect goal-check feedback with the expected artifact contract', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-check-feedback-contract-'));
      const goalSettingPath = path.join(tmpDir, 'goal-setting.json');
      const goalCheckPath = path.join(tmpDir, 'goal-check.json');
      const metadataPath = path.join(tmpDir, 'metadata.json');

      try {
        writeJson(goalSettingPath, {
          quality_score: 91,
          quality_metrics: {
            specificity: 5,
            measurability: 4,
            achievability: 5,
          },
          success_criteria: ['specific', 'measurable', 'achievable'],
        });
        writeJson(goalCheckPath, {
          met: true,
          confidence: 'high',
          evidence: [
            { file: 'src/example.ts', line: 12, reason: 'Implementation changed' },
            { file: 'tests/example.test.ts', line: 4, reason: 'Behavior covered' },
          ],
          missing: [{ requirement: 'None remaining' }],
          summary: 'Goal met with direct evidence.',
          retry_prompt: '',
        });
        writeJson(metadataPath, {
          validation_passed: true,
          coding_attempts: 2,
          total_duration_seconds: 42,
          goal_check_met: true,
        });

        const result = runCollectFeedback([
          'goal-check',
          'contract-instance',
          goalSettingPath,
          goalCheckPath,
          metadataPath,
        ]);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const feedback = parseJsonStdout(result.stdout);
        expect(feedback).toMatchObject({
          instance_name: 'contract-instance',
          phase: 'goal_check',
          goal_quality: {
            score: 91,
            metrics: {
              specificity: 5,
              measurability: 4,
              achievability: 5,
            },
            smart_criteria_count: 3,
          },
          goal_check_verdict: {
            met: true,
            confidence: 'high',
            evidenceCount: 2,
            missingCount: 1,
          },
          outcomes: {
            validation_passed: true,
            coding_attempts: 2,
            total_duration_seconds: 42,
            goal_check_met: true,
          },
          correlation: {
            goal_quality: 91,
            verdict_met: true,
            success: true,
            confidence_grade: 'high',
            notes: [],
          },
        });
        expect(new Date(feedback.timestamp).toString()).not.toBe('Invalid Date');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should collect run-evaluation feedback from the schema-valid artifact contract', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evaluation-feedback-contract-'));
      const runEvaluationPath = path.join(tmpDir, 'run-evaluation.json');
      const metadataPath = path.join(tmpDir, 'metadata.json');

      try {
        writeJson(runEvaluationPath, {
          overall_assessment: 'good',
          reviewer_confidence: 'high',
          task_completion_score: 4,
          summary: 'The task was completed with strong evidence.',
          pr_summary: 'Adds the requested behavioral assertion.',
          human_review_focus: ['Confirm test coverage intent'],
          efficiency_findings: ['No repeated collection work'],
          warnings: [],
          stage_value: [
            { stage: 'scouting', value: 'medium', reason: 'Identified impacted files' },
            { stage: 'evaluation', value: 'high', reason: 'Captured evaluator output' },
          ],
          kaseki_improvement_opportunities: [
            { category: 'goal_setting', priority: 'low', suggestion: 'Keep goals specific' },
            { category: 'evaluation', priority: 'medium', suggestion: 'Keep contract tests behavioral' },
          ],
        });
        writeJson(metadataPath, {
          validation_passed: false,
          coding_attempts: 3,
          total_duration_seconds: 99,
          goal_check_met: false,
        });

        const result = runCollectFeedback([
          'run-evaluation',
          'contract-instance',
          runEvaluationPath,
          metadataPath,
        ]);

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const feedback = parseJsonStdout(result.stdout);
        expect(feedback).toMatchObject({
          instance_name: 'contract-instance',
          phase: 'run_evaluation',
          assessment: {
            overall_assessment: 'good',
            reviewer_confidence: 'high',
            task_completion_score: 4,
          },
          stage_values: [
            { stage: 'scouting', value: 'medium' },
            { stage: 'evaluation', value: 'high' },
          ],
          improvements: [
            { category: 'goal_setting', priority: 'low' },
            { category: 'evaluation', priority: 'medium' },
          ],
          outcomes: {
            validation_passed: false,
            coding_attempts: 3,
            total_duration_seconds: 99,
            goal_check_met: false,
          },
        });
        expect(new Date(feedback.timestamp).toString()).not.toBe('Invalid Date');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should report CLI usage and phase errors at execution time', () => {
      const noArgs = runCollectFeedback([]);
      expect(noArgs.status).toBe(1);
      expect(noArgs.stderr).toContain('Usage: collect-feedback.js <phase> <instance_name> [paths...]');

      const incompleteGoalCheck = runCollectFeedback(['goal-check', 'contract-instance']);
      expect(incompleteGoalCheck.status).toBe(1);
      expect(incompleteGoalCheck.stderr).toContain('Usage: collect-feedback.js goal-check');

      const incompleteRunEvaluation = runCollectFeedback(['run-evaluation', 'contract-instance']);
      expect(incompleteRunEvaluation.status).toBe(1);
      expect(incompleteRunEvaluation.stderr).toContain('Usage: collect-feedback.js run-evaluation');

      const unknownPhase = runCollectFeedback(['unknown-phase', 'contract-instance']);
      expect(unknownPhase.status).toBe(1);
      expect(unknownPhase.stderr).toContain('Unknown phase: unknown-phase');
    });

    it('should fall back to default feedback values and warn when artifact JSON cannot be parsed', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-parse-error-'));
      const goalSettingPath = path.join(tmpDir, 'goal-setting.json');
      const goalCheckPath = path.join(tmpDir, 'goal-check.json');
      const metadataPath = path.join(tmpDir, 'metadata.json');

      try {
        fs.writeFileSync(goalSettingPath, '{not-json');
        fs.writeFileSync(goalCheckPath, '{not-json');
        fs.writeFileSync(metadataPath, '{not-json');

        const result = runCollectFeedback([
          'goal-check',
          'contract-instance',
          goalSettingPath,
          goalCheckPath,
          metadataPath,
        ]);

        expect(result.status).toBe(0);
        expect(result.stderr).toContain(`Failed to parse JSON from ${goalSettingPath}`);
        expect(result.stderr).toContain(`Failed to parse JSON from ${goalCheckPath}`);
        expect(result.stderr).toContain(`Failed to parse JSON from ${metadataPath}`);
        expect(parseJsonStdout(result.stdout)).toMatchObject({
          instance_name: 'contract-instance',
          phase: 'goal_check',
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
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Schema Validation', () => {
    describe('goal-check met validation', () => {
      const extractGoalCheckValidator = () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        const startMarker = 'node -e \'\nconst fs = require("node:fs");';
        const startIndex = scriptContent.indexOf(startMarker, scriptContent.indexOf('validate_goal_check_artifact_with_node()'));
        expect(startIndex).toBeGreaterThanOrEqual(0);

        const validatorStart = startIndex + "node -e '\n".length;
        const endMarker = '\n\' "$candidate_artifact" "$final_artifact" "$attempt" "$validation_error_file"';
        const endIndex = scriptContent.indexOf(endMarker, validatorStart);
        expect(endIndex).toBeGreaterThan(validatorStart);

        return scriptContent.slice(validatorStart, endIndex);
      };

      const baseGoalCheckArtifact = () => ({
        met: true as unknown,
        confidence: 'high',
        summary: 'The implementation satisfies the requested goal.',
        retry_prompt: '',
        evidence: ['src/example.ts:1 shows the requested implementation'],
        missing: [],
        validation_notes: [],
      });

      const runGoalCheckValidator = (artifact: Record<string, unknown>, attempt = 3) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-check-validator-'));
        const candidatePath = path.join(tmpDir, 'candidate.json');
        const outputPath = path.join(tmpDir, 'goal-check.json');
        const errorPath = path.join(tmpDir, 'validation-errors.json');

        try {
          // No filesystem modification needed - validator creates its own artifacts in tmpDir
          fs.writeFileSync(candidatePath, JSON.stringify(artifact));
          const result = spawnSync(
            process.execPath,
            ['-e', extractGoalCheckValidator(), candidatePath, outputPath, String(attempt), errorPath],
            { encoding: 'utf8' }
          );

          const validationError = fs.existsSync(errorPath)
            ? JSON.parse(fs.readFileSync(errorPath, 'utf8'))
            : undefined;
          const canonicalArtifact = fs.existsSync(outputPath)
            ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
            : undefined;

          return {
            status: result.status,
            stderr: result.stderr,
            validationError,
            canonicalArtifact,
            canonicalArtifactExists: fs.existsSync(outputPath),
          };
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      };

      it.each([
        ['met=true', true],
        ['met=false', false],
      ])('accepts and preserves valid goal-check artifacts with %s through the production validator', (_label, met) => {
        const result = runGoalCheckValidator({
          ...baseGoalCheckArtifact(),
          met,
          retry_prompt: met ? '' : 'Address the missing acceptance criteria before retrying.',
          missing: met ? [] : ['Acceptance criteria still need follow-up'],
        });

        expect(result.status).toBe(0);
        expect(result.validationError).toBeUndefined();
        expect(result.canonicalArtifact).toMatchObject({
          met,
          confidence: 'high',
          summary: 'The implementation satisfies the requested goal.',
          retry_prompt: met ? '' : 'Address the missing acceptance criteria before retrying.',
          evidence: ['src/example.ts:1 shows the requested implementation'],
          missing: met ? [] : ['Acceptance criteria still need follow-up'],
          validation_notes: [],
          attempt: 3,
        });
        expect(typeof result.canonicalArtifact.timestamp).toBe('string');
      });

      it.each([
        ['string', 'true'],
        ['numeric', 1],
        ['null', null],
        ['missing', undefined],
        ['array', [true]],
        ['object', { value: true }],
      ])('rejects goal-check artifacts with %s met values through the production validator', (_label, met) => {
        const artifact = baseGoalCheckArtifact();
        if (met === undefined) {
          delete (artifact as Record<string, unknown>).met;
        } else {
          artifact.met = met;
        }

        const result = runGoalCheckValidator(artifact);

        expect(result.status).not.toBe(0);
        expect(result.canonicalArtifactExists).toBe(false);
        expect(result.canonicalArtifact).toBeUndefined();
        expect(result.validationError).toMatchObject({
          reason_hint: 'schema_mismatch',
          errors: [
            expect.objectContaining({
              field: 'met',
              expected: 'boolean',
              severity: 'critical',
              suggestion: 'met must be true or false',
            }),
          ],
        });
      });
    });

    describe('reviewer_confidence validation', () => {
      const baseRunEvaluationArtifact = () => ({
        overall_assessment: 'good',
        reviewer_confidence: 'high' as unknown,
        task_completion_score: 4,
        summary: 'Test summary',
        pr_summary: 'Test PR summary',
        human_review_focus: [],
        efficiency_findings: [],
        warnings: [],
        stage_value: [{ stage: 'evaluation', value: 'medium', reason: 'Test fixture stage value' }],
        kaseki_improvement_opportunities: [
          { category: 'evaluation', priority: 'low', suggestion: 'Test fixture improvement' },
        ],
      });

      const extractRunEvaluationValidator = () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        const startMarker = 'node -e \'\nconst fs = require("node:fs");';
        const startIndex = scriptContent.indexOf(startMarker, scriptContent.indexOf('run_run_evaluation()'));
        expect(startIndex).toBeGreaterThanOrEqual(0);

        const validatorStart = startIndex + "node -e '\n".length;
        const endMarker = '\n\' "$RUN_EVALUATION_CANDIDATE_ARTIFACT" "$RUN_EVALUATION_ARTIFACT"';
        const endIndex = scriptContent.indexOf(endMarker, validatorStart);
        expect(endIndex).toBeGreaterThan(validatorStart);

        return scriptContent.slice(validatorStart, endIndex);
      };

      const runValidator = (artifact: Record<string, unknown>) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evaluation-validator-'));
        const candidatePath = path.join(tmpDir, 'candidate.json');
        const outputPath = path.join(tmpDir, 'run-evaluation.json');

        try {
          fs.writeFileSync(candidatePath, JSON.stringify(artifact));
          execFileSync(
            process.execPath,
            ['-e', extractRunEvaluationValidator(), candidatePath, outputPath, 'test-model', 'actual-test-model'],
            { encoding: 'utf8' }
          );
          return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      };

      const expectValidatorFailure = (artifact: Record<string, unknown>) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evaluation-validator-failure-'));
        const candidatePath = path.join(tmpDir, 'candidate.json');
        const outputPath = path.join(tmpDir, 'run-evaluation.json');

        try {
          fs.writeFileSync(candidatePath, JSON.stringify(artifact));
          expect(() => {
            execFileSync(
              process.execPath,
              ['-e', extractRunEvaluationValidator(), candidatePath, outputPath, 'test-model', 'actual-test-model'],
              { encoding: 'utf8', stdio: 'pipe' }
            );
          }).toThrow();
          expect(fs.existsSync(outputPath)).toBe(false);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      };

      it('accepts high, medium, and low reviewer_confidence values using the kaseki-agent.sh run-evaluation artifact validator', () => {
        for (const reviewerConfidence of ['high', 'medium', 'low']) {
          const validatedArtifact = runValidator({
            ...baseRunEvaluationArtifact(),
            reviewer_confidence: reviewerConfidence,
          });

          expect(validatedArtifact).toMatchObject({
            reviewer_confidence: reviewerConfidence,
            model: 'test-model',
            actual_model: 'actual-test-model',
          });
          expect(typeof validatedArtifact.timestamp).toBe('string');
        }
      });

      it('rejects critical, unknown, empty, missing, and non-string reviewer_confidence values using the kaseki-agent.sh run-evaluation artifact validator', () => {
        const invalidArtifacts = [
          { label: 'critical', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: 'critical' } },
          { label: 'unknown', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: 'unknown' } },
          { label: 'empty', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: '' } },
          { label: 'missing', artifact: (() => {
            const artifact = baseRunEvaluationArtifact();
            delete (artifact as Record<string, unknown>).reviewer_confidence;
            return artifact;
          })() },
          { label: 'number', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: 123 } },
          { label: 'boolean', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: true } },
          { label: 'array', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: ['high'] } },
          { label: 'object', artifact: { ...baseRunEvaluationArtifact(), reviewer_confidence: { value: 'high' } } },
        ];

        for (const { label, artifact } of invalidArtifacts) {
          try {
            expectValidatorFailure(artifact);
          } catch (error: any) {
            throw new Error(`Expected reviewer_confidence=${label} to fail validation: ${error.message}`);
          }
        }
      });
    });

    describe('task_completion_score validation', () => {
      const baseRunEvaluationArtifact = () => ({
        overall_assessment: 'good',
        reviewer_confidence: 'medium',
        task_completion_score: 4 as number | string | undefined,
        summary: 'Test summary',
        pr_summary: 'Test PR summary',
        human_review_focus: [],
        efficiency_findings: [],
        warnings: [],
        stage_value: [],
        kaseki_improvement_opportunities: [],
      });

      const extractRunEvaluationValidator = () => {
        const scriptContent = fs.readFileSync(kasekiAgentPath, 'utf8');
        const validatorStartMarker = 'const fs = require("node:fs");';
        const validatorStart = scriptContent.indexOf(validatorStartMarker, scriptContent.indexOf('run_run_evaluation() {'));
        const validatorEnd = scriptContent.indexOf(
          "\n' \"$RUN_EVALUATION_CANDIDATE_ARTIFACT\" \"$RUN_EVALUATION_ARTIFACT\"",
          validatorStart
        );

        expect(validatorStart).toBeGreaterThanOrEqual(0);
        expect(validatorEnd).toBeGreaterThan(validatorStart);

        const validator = scriptContent.slice(validatorStart, validatorEnd);
        expect(validator).toContain('Number.isInteger(artifact.task_completion_score)');
        expect(validator).toContain('artifact.task_completion_score < 1');
        expect(validator).toContain('artifact.task_completion_score > 5');
        expect(validator).toContain('invalid.push("task_completion_score")');
        return validator;
      };

      const runRunEvaluationValidator = (artifact: ReturnType<typeof baseRunEvaluationArtifact>) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-evaluation-validator-'));
        const input = path.join(tmpDir, 'candidate.json');
        const output = path.join(tmpDir, 'validated.json');

        try {
          fs.writeFileSync(input, JSON.stringify(artifact));
          const result = spawnSync(
            process.execPath,
            ['-e', extractRunEvaluationValidator(), input, output, 'test-model', 'actual-test-model'],
            { encoding: 'utf8' }
          );
          if (result.status !== 0) {
            throw new Error(result.stderr || result.error?.message || `validator exited with ${result.status}`);
          }

          return JSON.parse(fs.readFileSync(output, 'utf8'));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      };

      it.each([1, 2, 3, 4, 5])('accepts valid integer score %i through the actual run-evaluation validator', (score) => {
        const artifact = baseRunEvaluationArtifact();
        artifact.task_completion_score = score;

        const validatedArtifact = runRunEvaluationValidator(artifact);

        expect(validatedArtifact.task_completion_score).toBe(score);
        expect(validatedArtifact.model).toBe('test-model');
        expect(validatedArtifact.actual_model).toBe('actual-test-model');
      });

      it.each([
        ['below minimum', 0],
        ['above maximum', 6],
        ['non-integer number', 3.5],
        ['string number', '4'],
        ['missing field', undefined],
      ])('rejects %s task_completion_score through the actual run-evaluation validator', (_caseName, score) => {
        const artifact = baseRunEvaluationArtifact();
        if (score === undefined) {
          delete artifact.task_completion_score;
        } else {
          artifact.task_completion_score = score;
        }

        expect(() => runRunEvaluationValidator(artifact)).toThrow(/invalid run-evaluation fields: task_completion_score/);
      });
    });
  });
});
