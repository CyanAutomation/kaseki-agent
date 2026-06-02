import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadCausalityAssessment,
  extractGoalCheckContext,
  formatCausalityForGoalCheck,
  suggestVerdictAdjustment,
  generateCausalityPromptSection,
  isImplementationLikelyValid,
  type CausalityAssessment,
  type GoalCheckCausalityContext,
} from './goal-check-causality-integration';

describe('Goal-Check Causality Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-check-causality-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadCausalityAssessment', () => {
    it('should load causality assessment from artifact file', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'change_related',
          confidence: 0.85,
          rationale: 'New test failure detected',
          signals: {
            comparativeResults: {
              analysis: {},
              indicatesChangeRelated: true,
              weight: 0.4,
            },
          },
        },
        version: '1.0',
      };

      fs.writeFileSync(
        path.join(tempDir, 'validation-causality-analysis.json'),
        JSON.stringify(assessment)
      );

      const loaded = loadCausalityAssessment(tempDir);
      expect(loaded).toEqual(assessment);
      expect(loaded?.assessment.failureType).toBe('change_related');
      expect(loaded?.assessment.confidence).toBe(0.85);
    });

    it('should return null if artifact does not exist', () => {
      const loaded = loadCausalityAssessment(tempDir);
      expect(loaded).toBeNull();
    });

    it('should return null if artifact is invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'validation-causality-analysis.json'), 'invalid json');
      const loaded = loadCausalityAssessment(tempDir);
      expect(loaded).toBeNull();
    });
  });

  describe('extractGoalCheckContext', () => {
    it('should return empty context if no causality assessment', () => {
      const context = extractGoalCheckContext(null);
      expect(context.has_causality_assessment).toBe(false);
      expect(context.failure_type).toBeUndefined();
    });

    it('should extract context for change_related failures', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'change_related',
          confidence: 0.85,
          rationale: 'New test failure introduced by change',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      expect(context.has_causality_assessment).toBe(true);
      expect(context.failure_type).toBe('change_related');
      expect(context.confidence).toBe(0.85);
      expect(context.implementation_valid).toBe(false);
      expect(context.should_consider_pre_existing).toBe(false);
      expect(context.recommendation).toContain('NOT valid');
    });

    it('should extract context for pre_existing failures', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'pre_existing',
          confidence: 0.92,
          rationale: 'Infrastructure failure detected',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      expect(context.has_causality_assessment).toBe(true);
      expect(context.failure_type).toBe('pre_existing');
      expect(context.implementation_valid).toBe(true);
      expect(context.should_consider_pre_existing).toBe(true);
      expect(context.recommendation).toContain('may still be valid');
    });

    it('should extract context for mixed failures', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'mixed',
          confidence: 0.65,
          rationale: 'Some failures from change, some pre-existing',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      expect(context.failure_type).toBe('mixed');
      expect(context.implementation_valid).toBe(false);
      expect(context.should_consider_pre_existing).toBe(true);
    });

    it('should extract context for inconclusive failures', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'inconclusive',
          confidence: 0.45,
          rationale: 'Insufficient signal agreement',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      expect(context.failure_type).toBe('inconclusive');
      expect(context.implementation_valid).toBe(false);
    });
  });

  describe('formatCausalityForGoalCheck', () => {
    it('should format causality context for display', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'change_related',
        confidence: 0.85,
        rationale: 'New test failure introduced',
        recommendation: 'Fix the code',
        implementation_valid: false,
        should_consider_pre_existing: false,
      };

      const formatted = formatCausalityForGoalCheck(context);
      expect(formatted).toContain('change_related');
      expect(formatted).toContain('85%');
      expect(formatted).toContain('not valid');
      expect(formatted).toContain('Confidence');
    });

    it('should format context with pre_existing flag', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'pre_existing',
        confidence: 0.92,
        rationale: 'Infrastructure issue',
        recommendation: 'Safe to proceed',
        implementation_valid: true,
        should_consider_pre_existing: true,
      };

      const formatted = formatCausalityForGoalCheck(context);
      expect(formatted).toContain('⚠️');
      expect(formatted).toContain('pre-existing');
      expect(formatted).toContain('✓');
    });

    it('should handle missing assessment', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: false,
      };

      const formatted = formatCausalityForGoalCheck(context);
      expect(formatted).toContain('No causality assessment');
    });
  });

  describe('suggestVerdictAdjustment', () => {
    it('should not adjust verdict if validation passed', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'change_related',
        confidence: 0.85,
        implementation_valid: false,
        should_consider_pre_existing: false,
      };

      const result = suggestVerdictAdjustment(true, false, context);
      expect(result.suggestedMet).toBe(true);
      expect(result.adjustmentReason).toContain('passed');
    });

    it('should suggest accepting pre_existing failures', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'pre_existing',
        confidence: 0.85,
        implementation_valid: true,
        should_consider_pre_existing: true,
      };

      const result = suggestVerdictAdjustment(true, true, context);
      expect(result.suggestedMet).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.adjustmentReason).toContain('pre-existing');
    });

    it('should suggest rejecting change_related failures', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'change_related',
        confidence: 0.85,
        implementation_valid: false,
        should_consider_pre_existing: false,
      };

      const result = suggestVerdictAdjustment(true, true, context);
      expect(result.suggestedMet).toBe(false);
      expect(result.confidence).toBe('high');
    });

    it('should suggest conservative approach for inconclusive', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'inconclusive',
        confidence: 0.45,
        implementation_valid: false,
        should_consider_pre_existing: false,
      };

      const result = suggestVerdictAdjustment(true, true, context);
      expect(result.suggestedMet).toBe(false);
      expect(result.confidence).toBe('low');
    });

    it('should lower confidence if pre_existing assessment is weak', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'pre_existing',
        confidence: 0.60, // Below threshold
        implementation_valid: true,
        should_consider_pre_existing: true,
      };

      const result = suggestVerdictAdjustment(true, true, context);
      expect(result.confidence).toBe('medium');
    });
  });

  describe('generateCausalityPromptSection', () => {
    it('should generate prompt section for valid causality assessment', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'pre_existing',
          confidence: 0.92,
          rationale: 'Database connection failed',
          signals: {},
        },
        version: '1.0',
      };

      fs.writeFileSync(
        path.join(tempDir, 'validation-causality-analysis.json'),
        JSON.stringify(assessment)
      );

      const section = generateCausalityPromptSection(tempDir);
      expect(section).toContain('Validation Failure Causality Assessment');
      expect(section).toContain('pre_existing');
      expect(section).toContain('92%');
    });

    it('should handle missing causality assessment', () => {
      const section = generateCausalityPromptSection(tempDir);
      expect(section).toContain('Validation Failure Causality Assessment');
      expect(section).toContain('No causality assessment');
    });
  });

  describe('isImplementationLikelyValid', () => {
    it('should return true for high-confidence pre_existing', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'pre_existing',
        confidence: 0.85,
        implementation_valid: true,
        should_consider_pre_existing: true,
      };

      expect(isImplementationLikelyValid(context)).toBe(true);
    });

    it('should return false for change_related', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'change_related',
        confidence: 0.85,
        implementation_valid: false,
        should_consider_pre_existing: false,
      };

      expect(isImplementationLikelyValid(context)).toBe(false);
    });

    it('should return false if confidence below threshold', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: true,
        failure_type: 'pre_existing',
        confidence: 0.70, // Below 0.75 threshold
        implementation_valid: true,
        should_consider_pre_existing: true,
      };

      expect(isImplementationLikelyValid(context)).toBe(false);
    });

    it('should return false if no assessment', () => {
      const context: GoalCheckCausalityContext = {
        has_causality_assessment: false,
      };

      expect(isImplementationLikelyValid(context)).toBe(false);
    });
  });

  describe('Integration: Real-World Scenarios', () => {
    it('should handle scenario: failed validation with change_related failures', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'change_related',
          confidence: 0.88,
          rationale: '2 new test failures introduced by change',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      const verdict = suggestVerdictAdjustment(true, true, context);

      expect(verdict.suggestedMet).toBe(false);
      expect(verdict.confidence).toBe('high');
      expect(isImplementationLikelyValid(context)).toBe(false);
    });

    it('should handle scenario: failed validation with pre_existing issues', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'pre_existing',
          confidence: 0.93,
          rationale: 'Database connection failures (ECONNREFUSED)',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      const verdict = suggestVerdictAdjustment(true, true, context);

      expect(verdict.suggestedMet).toBe(true); // Can still pass
      expect(verdict.confidence).toBe('high');
      expect(isImplementationLikelyValid(context)).toBe(true);
    });

    it('should handle scenario: mixed failures with uncertainty', () => {
      const assessment: CausalityAssessment = {
        timestamp: '2026-06-02T12:00:00Z',
        assessment: {
          failureType: 'mixed',
          confidence: 0.58,
          rationale: 'Some signal agreement on both change and pre-existing',
          signals: {},
        },
        version: '1.0',
      };

      const context = extractGoalCheckContext(assessment);
      const verdict = suggestVerdictAdjustment(true, true, context);

      expect(verdict.suggestedMet).toBe(false); // Conservative on mixed
      expect(isImplementationLikelyValid(context)).toBe(false);
    });
  });
});
