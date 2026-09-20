import { validateClassificationConfidence } from './classification-validation';
import type { ClassificationAnswer } from '../types/openrouter-decisions';

describe('validateClassificationConfidence', () => {
  const makeAnswer = (
    answer: string | number,
    confidence?: number,
  ): ClassificationAnswer =>
    ({
      answer,
      confidence,
    }) as ClassificationAnswer;

  it('should return valid when all answers meet minimum confidence (0.75)', () => {
    const answers: Record<string, ClassificationAnswer> = {
      code_quality_issue: makeAnswer('low', 0.85),
      requires_human_review: makeAnswer('no', 0.8),
      fix_risk_level: makeAnswer('medium', 0.75),
    };

    const result = validateClassificationConfidence(answers);

    expect(result.isValid).toBe(true);
    expect(result.failedQuestions).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('should return invalid when one answer below minimum confidence', () => {
    const answers: Record<string, ClassificationAnswer> = {
      code_quality_issue: makeAnswer('low', 0.85),
      requires_human_review: makeAnswer('yes', 0.7),
      fix_risk_level: makeAnswer('medium', 0.8),
    };

    const result = validateClassificationConfidence(answers);

    expect(result.isValid).toBe(false);
    expect(result.failedQuestions).toContain('requires_human_review');
    expect(result.messages.some((message) => message.includes('requires_human_review'))).toBe(true);
  });

  it('should return invalid when missing confidence field', () => {
    const answers: Record<string, ClassificationAnswer> = {
      code_quality_issue: makeAnswer('high', undefined),
    };

    const result = validateClassificationConfidence(answers);

    expect(result.isValid).toBe(false);
    expect(result.failedQuestions).toContain('code_quality_issue');
    expect(result.messages.some((message) => message.includes('code_quality_issue'))).toBe(true);
  });

  it('should accept custom confidence threshold', () => {
    const answers: Record<string, ClassificationAnswer> = {
      code_quality_issue: makeAnswer('low', 0.85),
      requires_human_review: makeAnswer('no', 0.8),
      fix_risk_level: makeAnswer('medium', 0.75),
    };

    const result = validateClassificationConfidence(answers, 0.8);

    expect(result.isValid).toBe(false);
    expect(result.failedQuestions).toContain('fix_risk_level');
  });

  it('should provide detailed failure messages', () => {
    const answers: Record<string, ClassificationAnswer> = {
      code_quality_issue: makeAnswer('low', 0.85),
      requires_human_review: makeAnswer('yes', 0.68),
      fix_risk_level: makeAnswer('high', 0.72),
    };

    const result = validateClassificationConfidence(answers);

    expect(result.isValid).toBe(false);
    expect(result.failedQuestions).toEqual(
      expect.arrayContaining(['requires_human_review', 'fix_risk_level']),
    );
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('requires_human_review'),
        expect.stringContaining('fix_risk_level'),
      ]),
    );
  });

  it('should handle empty answers object', () => {
    const result = validateClassificationConfidence({});

    expect(result.isValid).toBe(true);
    expect(result.failedQuestions).toEqual([]);
    expect(result.messages).toEqual([]);
  });
});
