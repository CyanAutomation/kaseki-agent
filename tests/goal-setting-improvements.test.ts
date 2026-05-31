/**
 * Goal-Setting Agent Improvements - Test Suite
 *
 * Validates all 10 improvements:
 * 1. Anti-patterns extraction
 * 2. SMART criteria validation
 * 3. Codebase context preservation
 * 4. Example-driven goals
 * 5. Quality metrics scorecard
 * 6. Constraint categorization
 * 7. Feedback loop infrastructure
 * 8. Reasoning transparency
 * 9. Iterative refinement
 * 10. Quality warnings
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  GoalSettingOutput,
  GoalSettingOutputSchema,
  calculateGoalQualityScore,
  hasQualityWarnings,
  getCriterionText,
  isGoalSettingOutput,
  isSmartCriterion,
  parseGoalSettingOutput,
} from '../src/types/goal-setting';
import { collectGoalFeedback, analyzeGoalFeedback } from '../src/lib/goal-setting-feedback';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractShellFunctionBlock = (scriptSource: string, startFunction: string, endFunction: string) => {
  const lines = scriptSource.split('\n');
  const startPattern = new RegExp(`^${escapeRegExp(startFunction)}\\(\\) \\{$`);
  const endPattern = new RegExp(`^${escapeRegExp(endFunction)}\\(\\) \\{$`);
  const startLineIndexes = lines.flatMap((line, index) => (startPattern.test(line) ? [index] : []));

  expect(startLineIndexes, `${startFunction} must have exactly one top-level declaration`).toHaveLength(1);

  const startLineIndex = startLineIndexes[0];
  const endLineIndex = lines.findIndex((line, index) => index > startLineIndex && endPattern.test(line));

  expect(endLineIndex, `${endFunction} must be the next verified top-level boundary`).toBeGreaterThan(startLineIndex);

  return lines.slice(startLineIndex, endLineIndex).join('\n');
};

describe('Goal-Setting Agent Improvements', () => {
  // ===== IMPROVEMENT #1: ANTI-PATTERNS =====
  describe('Improvement #1: Anti-Patterns / Do-NOT Clauses', () => {
    it('should validate supported anti-pattern categories and report missing or malformed input', () => {
      const baseGoal = {
        original_prompt: 'Fix TypeScript errors',
        upgraded_goal: 'Fix TypeScript errors in src/api/',
        key_requirements: ['Handle compilation errors'],
        success_criteria: ['TypeScript passes'],
        reasoning: 'clear scope boundaries',
        confidence: 'high',
      } satisfies Omit<GoalSettingOutput, 'anti_patterns'>;

      const goal = parseGoalSettingOutput({
        ...baseGoal,
        anti_patterns: {
          do_not_modify: ['src/generated/**'],
          do_not_break: ['API contracts'],
          must_preserve: ['error messages'],
        },
      });

      expect(goal.anti_patterns).toEqual({
        do_not_modify: ['src/generated/**'],
        do_not_break: ['API contracts'],
        must_preserve: ['error messages'],
      });
      expect(isGoalSettingOutput(goal)).toBe(true);

      const partialAntiPatterns = parseGoalSettingOutput({
        ...baseGoal,
        anti_patterns: {
          do_not_break: ['API contracts'],
        },
      });

      expect(partialAntiPatterns.anti_patterns).toEqual({
        do_not_break: ['API contracts'],
      });
      expect(hasQualityWarnings(partialAntiPatterns)).not.toContain(
        'No explicit anti-patterns defined - recommended for safety',
      );

      const missingAntiPatterns = parseGoalSettingOutput(baseGoal);
      expect(hasQualityWarnings(missingAntiPatterns)).toContain(
        'No explicit anti-patterns defined - recommended for safety',
      );

      expect(
        GoalSettingOutputSchema.safeParse({
          ...baseGoal,
          anti_patterns: {
            do_not_modify: 'src/generated/**',
          },
        }).success,
      ).toBe(false);
    });

    it('should support empty anti-pattern categories', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Simple fix',
        upgraded_goal: 'Simple fix upgraded',
        key_requirements: [],
        success_criteria: [],
        anti_patterns: {
          do_not_modify: [],
          do_not_break: ['existing behavior'],
        },
        reasoning: 'minimal anti-patterns',
        confidence: 'medium',
      };

      expect(goal.anti_patterns?.do_not_modify).toEqual([]);
      expect(goal.anti_patterns?.do_not_break).toContain('existing behavior');
    });
  });

  // ===== IMPROVEMENT #2: SMART CRITERIA =====
  describe('Improvement #2: SMART Criteria Validation', () => {
    it('should validate SMART criteria format', () => {
      const criteria = [
        {
          criterion: 'all tests pass',
          smart_score: 'high' as const,
          reasoning: 'binary, measurable outcome',
        },
        {
          criterion: 'add 5 edge-case tests',
          smart_score: 'high' as const,
          reasoning: 'specific count, achievable in one run',
        },
        {
          criterion: 'improve code quality',
          smart_score: 'low' as const,
          reasoning: 'vague, not measurable',
        },
      ];

      const weak = criteria.filter((c) => c.smart_score === 'low');
      expect(weak.length).toBe(1);
      expect(weak[0].criterion).toBe('improve code quality');
    });

    it('should detect weak SMART quality', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Fix something',
        upgraded_goal: 'Fix it better',
        key_requirements: [],
        success_criteria: [
          { criterion: 'improve stuff', smart_score: 'low' },
          { criterion: 'make it better', smart_score: 'low' },
          { criterion: 'do something', smart_score: 'low' },
        ],
        reasoning: 'weak criteria',
        confidence: 'low',
      };

      const warnings = hasQualityWarnings(goal);
      expect(warnings.some((w) => w.includes('Success criteria not measurable'))).toBe(true);
    });

    it('should support legacy string format for backward compatibility', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Old format goal',
        upgraded_goal: 'Upgraded old format',
        key_requirements: [],
        success_criteria: [
          'criterion 1', // String format (legacy)
          'criterion 2',
        ] as any,
        reasoning: 'backward compatibility test',
        confidence: 'medium',
      };

      expect(typeof goal.success_criteria[0]).toBe('string');
      expect(getCriterionText(goal.success_criteria[0] as any)).toBe('criterion 1');
    });
  });

  // ===== IMPROVEMENT #3: CODEBASE CONTEXT =====
  describe('Improvement #3: Codebase Context Preservation', () => {
    it('should include codebase signals in reasoning', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Add error handling',
        upgraded_goal:
          'Add error handling to async functions in src/api/ using try-catch. Format errors per established pattern. No new dependencies.',
        key_requirements: ['Follow existing error pattern', 'Node.js + TypeScript environment'],
        success_criteria: ['All errors caught', 'Consistent with codebase'],
        reasoning:
          'Codebase uses Node.js + TypeScript with async/await patterns. Error messages follow "action failed: reason" format.',
        confidence: 'high',
      };

      expect(goal.reasoning).toContain('Node.js');
      expect(goal.reasoning).toContain('TypeScript');
      expect(goal.key_requirements).toContain('Follow existing error pattern');
    });
  });

  // ===== IMPROVEMENT #4: EXAMPLES =====
  describe('Improvement #4: Example-Based Goal Clarification', () => {
    it('should include before/after examples', () => {
      const goalSettingArtifact = {
        original_prompt: 'Fix null handling',
        upgraded_goal: 'Fix parseRole() null-safety',
        key_requirements: ['preserve non-null role behavior'],
        success_criteria: ['Returns "Unnamed Role" for null input'],
        examples: {
          before: 'parseRole(null) → TypeError: Cannot read property',
          after: 'parseRole(null) → {name: "Unnamed Role"}',
        },
        reasoning: 'clear before/after contract',
        confidence: 'high',
      };

      const schemaResult = GoalSettingOutputSchema.safeParse(goalSettingArtifact);
      expect(schemaResult.success).toBe(true);

      const parsedGoal = parseGoalSettingOutput(goalSettingArtifact);
      expect(isGoalSettingOutput(parsedGoal)).toBe(true);
      expect(parsedGoal.examples).toEqual({
        before: 'parseRole(null) → TypeError: Cannot read property',
        after: 'parseRole(null) → {name: "Unnamed Role"}',
      });

      const feedback = collectGoalFeedback(
        'kaseki-examples',
        parsedGoal,
        new Map([
          ['pi scouting agent', { exit_code: 0, duration_seconds: 5 }],
          ['pi agent', { exit_code: 0, duration_seconds: 10 }],
          ['goal check', { exit_code: 0, duration_seconds: 3 }],
        ]),
        {
          status: 0,
          completed_successfully: true,
          total_duration_seconds: 18,
          validation_commands_run: ['npm test -- parseRole'],
          validation_exit_code: 0,
        },
      );

      expect(feedback.goal_setting_output.has_examples).toBe(true);

      const analysis = analyzeGoalFeedback([feedback]);
      expect(analysis.patterns.with_examples_success_rate).toBe(1);
      expect(analysis.patterns.without_examples_success_rate).toBe(0);
    });

    it('should warn if examples are missing', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Test prompt',
        upgraded_goal: 'Upgraded goal',
        key_requirements: [],
        success_criteria: [],
        reasoning: 'no examples',
        confidence: 'medium',
      };

      const warnings = hasQualityWarnings(goal);
      expect(warnings.some((w) => w.includes('examples'))).toBe(true);
    });
  });

  // ===== IMPROVEMENT #5: QUALITY METRICS =====
  describe('Improvement #5: Multi-Dimensional Quality Metrics', () => {
    it('should calculate 5-point quality scorecard', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Fix parser',
        upgraded_goal: 'Fix parseRole() null-safety with tests',
        key_requirements: [],
        success_criteria: [],
        quality_metrics: {
          clarity: 'high',
          measurability: 'high',
          specificity: 'high',
          scope_clarity: 'high',
          constraint_strength: 'high',
        },
        reasoning: 'all metrics high',
        confidence: 'high',
      };

      const score = calculateGoalQualityScore(goal);
      expect(score).toBe(100); // 5 x 25 = 100
    });

    it('should calculate mixed quality scores', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Improve code',
        upgraded_goal: 'Improve code quality',
        key_requirements: [],
        success_criteria: [],
        quality_metrics: {
          clarity: 'high',
          measurability: 'medium',
          specificity: 'low',
          scope_clarity: 'high',
          constraint_strength: 'medium',
        },
        reasoning: 'mixed quality',
        confidence: 'medium',
      };

      const score = calculateGoalQualityScore(goal);
      expect(score).toBe(75); // 25 + 12.5 + 0 + 25 + 12.5 = 75
    });

    it('should default to 50 if no quality metrics provided', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Test',
        upgraded_goal: 'Test upgraded',
        key_requirements: [],
        success_criteria: [],
        reasoning: 'no metrics',
        confidence: 'medium',
      };

      const score = calculateGoalQualityScore(goal);
      expect(score).toBe(50);
    });
  });

  // ===== IMPROVEMENT #6: CONSTRAINT CATEGORIZATION =====
  describe('Improvement #6: Constraint Categorization', () => {
    it('should categorize constraints by type', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Refactor auth',
        upgraded_goal: 'Refactor authentication safely',
        key_requirements: [],
        success_criteria: [],
        constraints: {
          operational: ['max 3 files changed'],
          architectural: ['preserve service boundaries'],
          technical: ['must pass TypeScript', 'no deprecated APIs'],
          business: ['maintain backward compatibility'],
        },
        reasoning: 'categorized constraints',
        confidence: 'high',
      };

      expect(goal.constraints?.operational).toContain('max 3 files changed');
      expect(goal.constraints?.architectural).toContain('preserve service boundaries');
      expect(goal.constraints?.technical).toHaveLength(2);
      expect(goal.constraints?.business).toContain('maintain backward compatibility');
    });

    it('should warn if constraints missing', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Test',
        upgraded_goal: 'Test upgraded',
        key_requirements: [],
        success_criteria: [],
        reasoning: 'no constraints',
        confidence: 'medium',
      };

      const warnings = hasQualityWarnings(goal);
      expect(warnings.some((w) => w.includes('constraints'))).toBe(true);
    });
  });

  // ===== IMPROVEMENT #7: FEEDBACK LOOP =====
  describe('Improvement #7: Goal-to-Outcome Feedback Loop', () => {
    it('should collect feedback from goal and outcomes', () => {
      const goal_setting_output = {
        confidence: 'high' as const,
        upgraded_goal: 'Test goal',
        quality_metrics: {
          clarity: 'high' as const,
          measurability: 'high' as const,
          specificity: 'high' as const,
          scope_clarity: 'high' as const,
          constraint_strength: 'high' as const,
        },
        success_criteria: [
          { criterion: 'test passes', smart_score: 'high' as const },
        ],
        anti_patterns: { do_not_modify: ['src/gen/**'] },
        constraints: { technical: ['must pass types'] },
      };

      const stage_timings = new Map([
        [
          'pi scouting agent',
          { exit_code: 0, duration_seconds: 30 },
        ],
        [
          'pi agent',
          { exit_code: 0, duration_seconds: 60 },
        ],
        ['goal check', { exit_code: 0, duration_seconds: 20 }],
      ]);

      const metadata = {
        status: 0,
        completed_successfully: true,
        total_duration_seconds: 110,
        validation_commands_run: ['npm test'],
        validation_exit_code: 0,
      };

      const feedback = collectGoalFeedback('kaseki-1', goal_setting_output, stage_timings, metadata);

      expect(feedback.instance_name).toBe('kaseki-1');
      expect(feedback.goal_setting_output.confidence).toBe('high');
      expect(feedback.agent_outcomes.scouting.success).toBe(true);
      expect(feedback.agent_outcomes.coding.success).toBe(true);
      expect(feedback.overall.success).toBe(true);
    });

    it('should analyze patterns from multiple feedback entries', () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00Z',
          instance_name: 'kaseki-1',
          goal_setting_output: {
            confidence: 'high' as const,
            quality_score: 100,
            smart_quality: 'high' as const,
            upgraded_goal: 'Goal 1',
            anti_patterns_count: 2,
            constraints_count: 4,
            success_criteria_count: 3,
          },
          agent_outcomes: {
            scouting: { exit_code: 0, duration_seconds: 30, success: true },
            coding: { exit_code: 0, duration_seconds: 60, diff_bytes: 500, success: true },
            validation: {
              commands_run: ['npm test'],
              failed_commands: [],
              exit_code: 0,
              success: true,
            },
            goal_check: { success: true, met: true, duration_seconds: 20 },
          },
          overall: {
            success: true,
            completed_successfully: true,
            total_duration_seconds: 110,
            quality_gates_passed: 3,
            quality_gates_failed: 0,
          },
        },
        {
          timestamp: '2026-05-30T11:00:00Z',
          instance_name: 'kaseki-2',
          goal_setting_output: {
            confidence: 'low' as const,
            quality_score: 30,
            smart_quality: 'low' as const,
            upgraded_goal: 'Goal 2',
            anti_patterns_count: 0,
            constraints_count: 0,
            success_criteria_count: 1,
          },
          agent_outcomes: {
            scouting: { exit_code: 1, duration_seconds: 30, success: false },
            coding: { exit_code: 1, duration_seconds: 0, diff_bytes: 0, success: false },
            validation: {
              commands_run: [],
              failed_commands: [],
              exit_code: -1,
              success: false,
            },
            goal_check: { success: false, met: false, duration_seconds: 0 },
          },
          overall: {
            success: false,
            completed_successfully: false,
            total_duration_seconds: 30,
            quality_gates_passed: 0,
            quality_gates_failed: 2,
          },
        },
      ] as any;

      const analysis = analyzeGoalFeedback(entries);

      expect(analysis.total_runs).toBe(2);
      expect(analysis.success_rate).toBe(0.5);
      expect(analysis.average_quality_score).toBe(65); // (100 + 30) / 2
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  // ===== IMPROVEMENT #8: REASONING TRANSPARENCY =====
  describe('Improvement #8: Reasoning Transparency', () => {
    it('should validate and preserve actionable reasoning through the production artifact validator', () => {
      const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
      const tempDir = mkdtempSync(join(tmpdir(), 'kaseki-goal-setting-validator-'));

      try {
        const resultsDir = join(tempDir, 'results');
        const candidateArtifact = join(resultsDir, 'goal-setting-candidate.json');
        const finalArtifact = join(resultsDir, 'goal-setting.json');
        const reasonFile = join(resultsDir, 'goal-setting-validation-reason.txt');
        const invalidCandidateArtifact = join(resultsDir, 'goal-setting-candidate-invalid.json');
        const invalidFinalArtifact = join(resultsDir, 'goal-setting-invalid.json');
        const invalidReasonFile = join(resultsDir, 'goal-setting-validation-reason-invalid.txt');
        const validationRunner = join(tempDir, 'validate-goal-setting-artifact.sh');

        mkdirSync(resultsDir, { recursive: true });

        const scriptSource = readFileSync(join(repoRoot, 'kaseki-agent.sh'), 'utf8');
        const validationFunctions = extractShellFunctionBlock(
          scriptSource,
          'validate_goal_setting_artifact',
          'run_goal_setting_agent',
        );
        writeFileSync(
          validationRunner,
          `#!/usr/bin/env bash
set -euo pipefail
export KASEKI_RESULTS_DIR=${JSON.stringify(resultsDir)}
${validationFunctions}
validate_goal_setting_artifact "$1" "$2" "$3"
`,
          { mode: 0o755 },
        );
        execFileSync('bash', ['-n', validationRunner]);

        const reasoning =
          'Upgrade narrows an ambiguous parser bug report into a bounded change: update parseRole() null handling, add regression coverage, and preserve generated files plus public error messages so downstream agents know which trade-offs are safe.';
        const successCriterionReasoning =
          'The criterion is actionable because it names parseRole(), the null-input scenario, and the exact test command that proves completion.';
        const artifact = {
          original_prompt: 'Fix bug',
          upgraded_goal:
            'Fix parseRole() null handling by returning the documented guest role for null input, with focused regression tests and no generated-file edits.',
          key_requirements: [
            'Update parseRole() behavior only for null or missing role input',
            'Add a regression test that exercises the null-input path',
          ],
          success_criteria: [
            {
              criterion: 'npm test -- parseRole passes with a null-input regression case',
              smart_score: 'high',
              reasoning: successCriterionReasoning,
            },
          ],
          anti_patterns: {
            do_not_modify: ['src/generated/**'],
            do_not_break: ['public parseRole() return contract for non-null roles'],
            must_preserve: ['existing error message text for invalid role values'],
          },
          constraints: {
            operational: ['keep the change scoped to parser code and parser tests'],
            architectural: ['do not introduce new dependencies'],
            technical: ['preserve TypeScript strict-mode compatibility'],
            business: ['avoid changing user-visible role labels except for the null fallback'],
          },
          examples: {
            before: 'parseRole(null) throws before downstream defaulting can run',
            after: "parseRole(null) returns the documented guest role and parseRole('admin') remains unchanged",
          },
          quality_metrics: {
            clarity: 'high',
            measurability: 'high',
            specificity: 'high',
            scope_clarity: 'high',
            constraint_strength: 'high',
          },
          reasoning,
          confidence: 'high',
        };

        writeFileSync(candidateArtifact, JSON.stringify(artifact));
        execFileSync('bash', [validationRunner, candidateArtifact, finalArtifact, reasonFile]);

        const validatedArtifact = JSON.parse(readFileSync(finalArtifact, 'utf8')) as typeof artifact;
        expect(readFileSync(reasonFile, 'utf8').trim()).toBe('valid');
        expect(validatedArtifact.reasoning).toBe(reasoning);
        expect(validatedArtifact.success_criteria[0].reasoning).toBe(successCriterionReasoning);

        const invalidArtifact = { ...artifact, reasoning: '' };
        writeFileSync(invalidCandidateArtifact, JSON.stringify(invalidArtifact));
        expect(() =>
          execFileSync('bash', [validationRunner, invalidCandidateArtifact, invalidFinalArtifact, invalidReasonFile], {
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        ).toThrow();

        const validationErrors = readFileSync(join(resultsDir, 'goal-setting-validation-errors.jsonl'), 'utf8');
        expect(validationErrors).toContain('missing_or_invalid: reasoning (must be non-empty string)');
        expect(readFileSync(invalidReasonFile, 'utf8').trim()).toBe('missing_required_fields');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ===== IMPROVEMENT #9: ITERATIVE REFINEMENT =====
  describe('Improvement #9: Iterative Refinement / Retry', () => {
    it('should persist and interpret retry attempts from an actual goal-setting retry', () => {
      const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
      const tempDir = mkdtempSync(join(tmpdir(), 'kaseki-goal-setting-retry-'));

      try {
        const fakeRepo = join(tempDir, 'fake-repo');
        const fakeBin = join(tempDir, 'bin');
        const resultsDir = join(tempDir, 'results');
        const workspaceRepo = join(tempDir, 'repo');
        const appLib = join(tempDir, 'app', 'lib');
        const scriptsDir = join(tempDir, 'scripts');
        const piCalls = join(tempDir, 'pi-calls.log');
        const piState = join(tempDir, 'pi-goal-setting-attempt');
        const modifiedScript = join(tempDir, 'kaseki-agent-modified.sh');

        mkdirSync(join(fakeRepo, 'deps', 'fake-dep'), { recursive: true });
        mkdirSync(fakeBin, { recursive: true });
        mkdirSync(resultsDir, { recursive: true });
        mkdirSync(workspaceRepo, { recursive: true });
        mkdirSync(appLib, { recursive: true });
        mkdirSync(scriptsDir, { recursive: true });
        writeFileSync(piCalls, '');
        writeFileSync(join(appLib, 'event-aggregator.js'), '');
        writeFileSync(join(appLib, 'timestamp-tracker.js'), '');
        writeFileSync(join(appLib, 'progress-stream-utils.js'), '');
        copyFileSync(join(repoRoot, 'scripts', 'allowlist-helper.sh'), join(scriptsDir, 'allowlist-helper.sh'));

        const scriptSource = readFileSync(join(repoRoot, 'kaseki-agent.sh'), 'utf8')
          .replaceAll('/workspace/repo', workspaceRepo)
          .replaceAll('/results', resultsDir)
          .replaceAll('/app/lib', appLib);
        writeFileSync(modifiedScript, scriptSource, { mode: 0o755 });

        writeFileSync(
          join(fakeRepo, 'package.json'),
          JSON.stringify({
            name: 'fake-goal-retry-repo',
            version: '1.0.0',
            private: true,
            scripts: { check: 'exit 0' },
            dependencies: { 'fake-dep': 'file:deps/fake-dep' },
          }),
        );
        writeFileSync(join(fakeRepo, 'deps', 'fake-dep', 'package.json'), JSON.stringify({ name: 'fake-dep', version: '1.0.0', private: true }));
        writeFileSync(
          join(fakeRepo, 'package-lock.json'),
          JSON.stringify({
            name: 'fake-goal-retry-repo',
            version: '1.0.0',
            lockfileVersion: 3,
            requires: true,
            packages: {
              '': { name: 'fake-goal-retry-repo', version: '1.0.0', dependencies: { 'fake-dep': 'file:deps/fake-dep' } },
              'deps/fake-dep': { version: '1.0.0' },
              'node_modules/fake-dep': { resolved: 'deps/fake-dep', link: true },
            },
          }),
        );
        execFileSync('git', ['-C', fakeRepo, 'init', '-q', '-b', 'main']);
        execFileSync('git', ['-C', fakeRepo, 'add', 'package.json', 'package-lock.json', 'deps/fake-dep/package.json']);
        execFileSync('git', ['-C', fakeRepo, '-c', 'user.email=kaseki-test@example.invalid', '-c', 'user.name=Kaseki Test', 'commit', '-q', '-m', 'initial']);

        writeFileSync(join(fakeBin, 'pi'), `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then echo "pi 0.0.0-test"; exit 0; fi
prompt="\${*: -1}"
if printf '%s' "$prompt" | grep -q 'goal-setting Pi agent'; then
  printf 'goal-setting\n' >> "${piCalls}"
  attempt=1
  if [ -f "${piState}" ]; then attempt=$(( $(cat "${piState}") + 1 )); fi
  printf '%s\n' "$attempt" > "${piState}"
  if [ "$attempt" -eq 1 ]; then
    echo 'api error: upstream timeout' >&2
    exit 1
  fi
  cat > "${resultsDir}/goal-setting-candidate.json" <<'JSON'
{"original_prompt":"retry original prompt","upgraded_goal":"retry-upgraded prompt from attempt two","reasoning":"second attempt succeeded after a transient failure","key_requirements":["persist retry metadata"],"success_criteria":[{"criterion":"metadata records the successful retry attempt","smart_score":"high","reasoning":"numeric metadata can be asserted"}],"anti_patterns":{"do_not_modify":[],"do_not_break":["retry metadata"],"must_preserve":["original prompt fallback"]},"constraints":{"operational":["retry once after transient goal-setting failure"],"architectural":[],"technical":[],"business":[]},"quality_metrics":{"clarity":"high","measurability":"high","specificity":"high","scope_clarity":"high","constraint_strength":"high"},"confidence":"high"}
JSON
elif printf '%s' "$prompt" | grep -q 'read-only scouting Pi agent'; then
  printf 'scouting\n' >> "${piCalls}"
  printf '%s\n' '{"task":"inspect","requirements":[],"relevant_files":[],"observations":[],"plan":[],"validation":[],"risks":[]}' > "${resultsDir}/scouting-candidate.json"
elif printf '%s' "$prompt" | grep -q 'read-only goal-check Pi agent'; then
  printf 'goal-check\n' >> "${piCalls}"
  printf '%s\n' '{"met":true,"confidence":"high","summary":"done","evidence":[],"missing":[],"retry_prompt":"","validation_notes":[]}' > "${resultsDir}/goal-check-candidate.json"
else
  printf 'coding\n' >> "${piCalls}"
  printf '%s' "$prompt" > "${resultsDir}/coding-prompt.txt"
fi
printf '{"type":"message","model":"test-model"}\n'
`, { mode: 0o755 });
        writeFileSync(join(fakeBin, 'kaseki-pi-progress-stream'), '#!/usr/bin/env bash\ncat\n', { mode: 0o755 });
        writeFileSync(join(fakeBin, 'kaseki-pi-event-filter'), '#!/usr/bin/env bash\ncat "$1" > "$2"\nprintf \'{"selected_model":"test-model"}\\n\' > "$3"\n', { mode: 0o755 });
        writeFileSync(join(fakeBin, 'timeout'), '#!/usr/bin/env bash\nshift 2\n"$@"\n', { mode: 0o755 });
        writeFileSync(join(fakeBin, 'validation-output-filter'), '#!/usr/bin/env bash\ncat\n', { mode: 0o755 });
        writeFileSync(join(fakeBin, 'npm'), '#!/usr/bin/env bash\necho "fake npm $*" >&2\nexit 0\n', { mode: 0o755 });

        execFileSync('bash', [modifiedScript], {
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
            REPO_URL: fakeRepo,
            GIT_REF: 'main',
            TASK_PROMPT: 'retry original prompt',
            OPENROUTER_API_KEY: 'test',
            GITHUB_APP_ENABLED: '0',
            KASEKI_GIT_CACHE_MODE: 'off',
            KASEKI_DEPENDENCY_CACHE_DIR: join(tempDir, 'dependency-cache'),
            KASEKI_IMAGE_DEPENDENCY_CACHE_DIR: join(tempDir, 'image-cache'),
            KASEKI_PRE_AGENT_VALIDATION_COMMANDS: 'npm run check',
            KASEKI_VALIDATION_COMMANDS: ':',
            KASEKI_ALLOW_EMPTY_DIFF: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
        });

        const piCallOrder = readFileSync(piCalls, 'utf8').trim().split('\n');
        expect(piCallOrder).toEqual(['goal-setting', 'goal-setting', 'scouting', 'coding', 'goal-check']);

        const metadata = JSON.parse(readFileSync(join(resultsDir, 'metadata.json'), 'utf8')) as {
          goal_setting_attempts: number;
          goal_setting_succeeded_on_attempt: number | null;
          goal_setting_exit_code: number;
          exit_code: number;
        };
        expect(metadata.exit_code).toBe(0);
        expect(metadata.goal_setting_exit_code).toBe(0);
        expect(metadata.goal_setting_attempts).toBe(2);
        expect(metadata.goal_setting_succeeded_on_attempt).toBe(2);

        const codingPrompt = readFileSync(join(resultsDir, 'coding-prompt.txt'), 'utf8');
        expect(codingPrompt).toContain('retry-upgraded prompt from attempt two');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  // ===== IMPROVEMENT #10: QUALITY WARNINGS =====
  describe('Improvement #10: Quality Warnings & Early Detection', () => {
    it('should flag multiple quality issues', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Do something',
        upgraded_goal: 'Do something better',
        key_requirements: [],
        success_criteria: [
          { criterion: 'improve stuff', smart_score: 'low' },
        ],
        quality_metrics: {
          clarity: 'low',
          measurability: 'low',
          specificity: 'low',
          scope_clarity: 'low',
          constraint_strength: 'low',
        },
        reasoning: 'low quality goal',
        confidence: 'low',
      };

      const warnings = hasQualityWarnings(goal);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('clarity'))).toBe(true);
      expect(warnings.some((w) => w.includes('measurable'))).toBe(true);
      expect(warnings.some((w) => w.includes('Scope'))).toBe(true);
    });

    it('should flag missing anti-patterns', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Test',
        upgraded_goal: 'Test upgraded',
        key_requirements: [],
        success_criteria: [],
        reasoning: 'no anti-patterns',
        confidence: 'medium',
      };

      const warnings = hasQualityWarnings(goal);
      expect(warnings.some((w) => w.includes('anti-patterns'))).toBe(true);
    });
  });

  // ===== HELPER FUNCTIONS =====
  describe('Helper Functions', () => {
    it('should check SMART criterion format', () => {
      const smart_criterion = { criterion: 'test', smart_score: 'high' as const };
      const string_criterion = 'test';

      expect(isSmartCriterion(smart_criterion)).toBe(true);
      expect(isSmartCriterion(string_criterion)).toBe(false);
    });

    it('should extract criterion text from both formats', () => {
      expect(getCriterionText({ criterion: 'test', smart_score: 'high' })).toBe('test');
      expect(getCriterionText('test string')).toBe('test string');
    });
  });
});
