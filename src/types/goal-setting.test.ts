import {
  GoalSettingOutputSchema,
  parseGoalSettingOutput,
  isGoalSettingOutput,
  isSmartCriterion,
  type GoalSettingOutput,
  type SmartCriterion,
  type PreservationConstraints,
} from './goal-setting';

describe('goal-setting types', () => {
  describe('GoalSettingOutputSchema validation', () => {
    const validOutput: GoalSettingOutput = {
      original_prompt: 'Original task',
      upgraded_goal: 'Improved goal with clarity',
      key_requirements: ['requirement 1', 'requirement 2'],
      success_criteria: [
        { criterion: 'measurable', smart_score: 'high', reasoning: 'Very specific' },
        'Legacy string criterion',
      ],
      reasoning: 'Detailed reasoning',
      confidence: 'high',
    };

    it('accepts valid goal-setting output', () => {
      const result = GoalSettingOutputSchema.safeParse(validOutput);
      expect(result.success).toBe(true);
    });

    it('requires a non-empty upgraded_goal', () => {
      const invalid = { ...validOutput, upgraded_goal: '' };
      const result = GoalSettingOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(expect.objectContaining({
          code: 'too_small',
          path: ['upgraded_goal'],
        }));
      }
    });

    it('requires at least one success criterion', () => {
      const invalid = { ...validOutput, success_criteria: [] };
      const result = GoalSettingOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('requires at least one measurable SMART criterion', () => {
      const invalid = {
        ...validOutput,
        success_criteria: [
          { criterion: 'vague', smart_score: 'low' as const },
          { criterion: 'vague2', smart_score: 'low' as const },
        ],
      };
      const result = GoalSettingOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts mixed criterion types (string and SmartCriterion)', () => {
      const output = {
        ...validOutput,
        success_criteria: [
          'simple string criterion',
          { criterion: 'smart', smart_score: 'high' as const },
        ],
      };
      const result = GoalSettingOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it('accepts traceable SMART criteria with explicit verification artifacts', () => {
      const result = GoalSettingOutputSchema.safeParse({
        ...validOutput,
        success_criteria: [{
          criterion: 'Reuse the existing normalizer',
          smart_score: 'high',
          source_requirement: 'Prefer reusing an existing abstraction',
          verification_sources: ['git.diff', 'changed-files.txt'],
        }],
      });
      expect(result.success).toBe(true);
    });

    it('requires confidence to be one of high/medium/low', () => {
      const invalid = { ...validOutput, confidence: 'unknown' };
      const result = GoalSettingOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts optional fields', () => {
      const minimalValid = {
        original_prompt: 'Original',
        upgraded_goal: 'Upgraded',
        key_requirements: ['req'],
        success_criteria: [{ criterion: 'measurable', smart_score: 'high' as const }],
        reasoning: 'Why',
        confidence: 'medium' as const,
      };
      const result = GoalSettingOutputSchema.safeParse(minimalValid);
      expect(result.success).toBe(true);
    });

    it('validates anti_patterns with at least one non-empty boundary', () => {
      const withValidAntiPatterns = {
        ...validOutput,
        anti_patterns: { do_not_modify: ['file1.ts'] },
      };
      const result1 = GoalSettingOutputSchema.safeParse(withValidAntiPatterns);
      expect(result1.success).toBe(true);

      const withInvalidAntiPatterns = {
        ...validOutput,
        anti_patterns: { do_not_modify: [''] },
      };
      const result2 = GoalSettingOutputSchema.safeParse(withInvalidAntiPatterns);
      expect(result2.success).toBe(false);
    });

    it('validates preservation_constraints', () => {
      const withPreservation: GoalSettingOutput & { preservation_constraints: PreservationConstraints } = {
        ...validOutput,
        preservation_constraints: {
          protected_sections: ['CHANGELOG', 'VERSION'],
          max_line_reduction: 100,
          structural_requirements: {
            preserve_headings: true,
            preserve_code_blocks: true,
          },
        },
      };
      const result = GoalSettingOutputSchema.safeParse(withPreservation);
      expect(result.success).toBe(true);
    });

    it('validates protected_line_ranges format', () => {
      const withLineRanges = {
        ...validOutput,
        preservation_constraints: {
          protected_line_ranges: [
            { start: 10, end: 20, pattern: 'export const', description: 'Public API' },
            { start: 30, end: 50 },
          ],
        },
      };
      const result = GoalSettingOutputSchema.safeParse(withLineRanges);
      expect(result.success).toBe(true);
    });

    it('rejects invalid line range (end < start)', () => {
      const invalid = {
        ...validOutput,
        preservation_constraints: {
          protected_line_ranges: [{ start: 20, end: 10 }],
        },
      };
      const result = GoalSettingOutputSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(expect.objectContaining({
          code: 'custom',
          message: 'end must be greater than or equal to start',
          path: ['preservation_constraints', 'protected_line_ranges', 0, 'end'],
        }));
      }
    });

    it('validates categorized constraints', () => {
      const withConstraints = {
        ...validOutput,
        constraints: {
          operational: ['No downtime', 'Zero-day fixes only'],
          architectural: ['Maintain module structure'],
          technical: ['Use TypeScript 4.9+'],
          business: ['Complete within sprint'],
        },
      };
      const result = GoalSettingOutputSchema.safeParse(withConstraints);
      expect(result.success).toBe(true);
    });

    it('validates quality_metrics', () => {
      const withQuality = {
        ...validOutput,
        quality_metrics: {
          clarity: 'high',
          measurability: 'high',
          specificity: 'high',
          scope_clarity: 'medium',
          constraint_strength: 'low',
        },
      };
      const result = GoalSettingOutputSchema.safeParse(withQuality);
      expect(result.success).toBe(true);
    });

    it('validates goal examples', () => {
      const withExamples = {
        ...validOutput,
        examples: {
          before: 'Old code style',
          after: 'New code style',
        },
      };
      const result = GoalSettingOutputSchema.safeParse(withExamples);
      expect(result.success).toBe(true);
    });
  });

  describe('parseGoalSettingOutput function', () => {
    const validData = {
      original_prompt: 'Test',
      upgraded_goal: 'Upgraded test',
      key_requirements: ['req'],
      success_criteria: [{ criterion: 'measurable', smart_score: 'high' as const }],
      reasoning: 'Because',
      confidence: 'high' as const,
    };

    it('parses valid data successfully', () => {
      const result = parseGoalSettingOutput(validData);
      expect(result.upgraded_goal).toBe('Upgraded test');
      expect(result.confidence).toBe('high');
    });

    it('throws on invalid data', () => {
      const invalid = { ...validData, confidence: 'invalid' };
      expect(() => parseGoalSettingOutput(invalid)).toThrow();
    });

    it('throws when success_criteria is empty', () => {
      const invalid = { ...validData, success_criteria: [] };
      expect(() => parseGoalSettingOutput(invalid)).toThrow();
    });

    it('throws on missing required fields', () => {
      const incomplete = { ...validData, upgraded_goal: undefined };
      expect(() => parseGoalSettingOutput(incomplete as any)).toThrow();
    });

    it('coerces fields to correct types if possible', () => {
      const coercible = {
        ...validData,
        success_criteria: ['string criterion'] as any,
      };
      const result = parseGoalSettingOutput(coercible);
      expect(Array.isArray(result.success_criteria)).toBe(true);
    });
  });

  describe('isGoalSettingOutput type guard', () => {
    const validOutput = {
      original_prompt: 'Test',
      upgraded_goal: 'Upgraded',
      key_requirements: ['req'],
      success_criteria: [{ criterion: 'measurable', smart_score: 'high' as const }],
      reasoning: 'Because',
      confidence: 'high' as const,
    };

    it('returns true for valid goal-setting output', () => {
      expect(isGoalSettingOutput(validOutput)).toBe(true);
    });

    it('returns false for invalid confidence', () => {
      expect(isGoalSettingOutput({ ...validOutput, confidence: 'unknown' })).toBe(false);
    });

    it('returns false for empty success_criteria', () => {
      expect(isGoalSettingOutput({ ...validOutput, success_criteria: [] })).toBe(false);
    });

    it('returns false for non-object input', () => {
      expect(isGoalSettingOutput('not an object')).toBe(false);
      expect(isGoalSettingOutput(null)).toBe(false);
      expect(isGoalSettingOutput(undefined)).toBe(false);
      expect(isGoalSettingOutput(123)).toBe(false);
    });

    it('returns false for objects missing required fields', () => {
      expect(isGoalSettingOutput({ upgraded_goal: 'Only this field' })).toBe(false);
    });

    it('returns false for all-low-score criteria', () => {
      const allLow = {
        ...validOutput,
        success_criteria: [
          { criterion: 'low1', smart_score: 'low' as const },
          { criterion: 'low2', smart_score: 'low' as const },
        ],
      };
      expect(isGoalSettingOutput(allLow)).toBe(false);
    });

    it('returns true even with extra unknown fields', () => {
      const withExtra = { ...validOutput, extra_field: 'ignored' };
      expect(isGoalSettingOutput(withExtra)).toBe(true);
    });
  });

  describe('isSmartCriterion type guard', () => {
    const validSmartCriterion: SmartCriterion = {
      criterion: 'Add TypeScript types to all functions',
      smart_score: 'high',
      reasoning: 'Improves maintainability',
    };

    it('returns true for valid SmartCriterion', () => {
      expect(isSmartCriterion(validSmartCriterion)).toBe(true);
    });

    it('returns true without optional reasoning', () => {
      expect(isSmartCriterion({ criterion: 'Test', smart_score: 'high' })).toBe(true);
    });

    it('returns false for string (not SmartCriterion)', () => {
      expect(isSmartCriterion('just a string')).toBe(false);
    });

    it('returns false for invalid smart_score', () => {
      expect(isSmartCriterion({ criterion: 'Test', smart_score: 'invalid' })).toBe(false);
    });

    it('returns false for empty criterion string', () => {
      expect(isSmartCriterion({ criterion: '', smart_score: 'high' })).toBe(false);
    });

    it('returns false for non-object input', () => {
      expect(isSmartCriterion(null)).toBe(false);
      expect(isSmartCriterion(undefined)).toBe(false);
      expect(isSmartCriterion(123)).toBe(false);
    });

    it('returns true with whitespace-only criterion (trimmed)', () => {
      expect(isSmartCriterion({ criterion: '   spaces   ', smart_score: 'medium' })).toBe(true);
    });

    it('recognizes all smart_score values', () => {
      expect(isSmartCriterion({ criterion: 'Test', smart_score: 'high' })).toBe(true);
      expect(isSmartCriterion({ criterion: 'Test', smart_score: 'medium' })).toBe(true);
      expect(isSmartCriterion({ criterion: 'Test', smart_score: 'low' })).toBe(true);
    });

    it('returns false for missing criterion', () => {
      expect(isSmartCriterion({ smart_score: 'high' } as any)).toBe(false);
    });

    it('returns false for missing smart_score', () => {
      expect(isSmartCriterion({ criterion: 'Test' } as any)).toBe(false);
    });
  });

  describe('Edge cases and schema interactions', () => {
    it('handles deeply nested preservation constraints', () => {
      const complex = {
        original_prompt: 'Test',
        upgraded_goal: 'Upgraded',
        key_requirements: ['req'],
        success_criteria: [{ criterion: 'measurable', smart_score: 'high' as const }],
        reasoning: 'Because',
        confidence: 'high' as const,
        preservation_constraints: {
          protected_sections: ['section1', 'section2'],
          protected_line_ranges: [
            { start: 1, end: 100, pattern: 'const.*=', description: 'Constants' },
            { start: 200, end: 300, pattern: 'export.*', description: 'Exports' },
          ],
          max_line_reduction: 50,
          structural_requirements: {
            preserve_headings: true,
            preserve_code_blocks: true,
            preserve_tables: false,
            preserve_links: true,
          },
        },
      };
      expect(isGoalSettingOutput(complex)).toBe(true);
    });

    it('validates success criteria with mix of types', () => {
      const mixed = {
        original_prompt: 'Test',
        upgraded_goal: 'Upgraded',
        key_requirements: ['req'],
        success_criteria: [
          'String criterion 1',
          { criterion: 'Smart criterion', smart_score: 'high' as const },
          'String criterion 2',
          { criterion: 'Another smart', smart_score: 'medium' as const, reasoning: 'Some reasoning' },
        ],
        reasoning: 'Because',
        confidence: 'low' as const,
      };
      expect(isGoalSettingOutput(mixed)).toBe(true);
    });

    it('quality_metrics with all low scores is still valid', () => {
      const allLowQuality = {
        original_prompt: 'Test',
        upgraded_goal: 'Upgraded',
        key_requirements: ['req'],
        success_criteria: [{ criterion: 'At least one good', smart_score: 'high' as const }],
        reasoning: 'Because',
        confidence: 'high' as const,
        quality_metrics: {
          clarity: 'low' as const,
          measurability: 'low' as const,
          specificity: 'low' as const,
          scope_clarity: 'low' as const,
          constraint_strength: 'low' as const,
        },
      };
      expect(isGoalSettingOutput(allLowQuality)).toBe(true);
    });
  });
});
