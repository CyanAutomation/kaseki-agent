import { z } from 'zod';

/**
 * Goal-Setting Agent Output Types
 *
 * Following OpenAI best practices for well-formed goals:
 * https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
 */

/**
 * SMART criterion with quality score
 * Specific, Measurable, Achievable, Relevant, Time-bound
 */
export const SmartCriterionSchema = z.object({
  criterion: z.string(),
  smart_score: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().optional(),
});

export interface SmartCriterion {
  criterion: string;
  smart_score: 'high' | 'medium' | 'low';
  reasoning?: string;
}

/**
 * Success criteria - can be string (legacy) or SmartCriterion (recommended)
 */
export const SuccessCriterionSchema = z.union([z.string(), SmartCriterionSchema]);

export type SuccessCriterion = string | SmartCriterion;

/**
 * Anti-patterns and hard boundaries
 */
export const AntiPatternsSchema = z.object({
  do_not_modify: z.array(z.string()).optional(),
  do_not_break: z.array(z.string()).optional(),
  must_preserve: z.array(z.string()).optional(),
});

export interface AntiPatterns {
  do_not_modify?: string[];
  do_not_break?: string[];
  must_preserve?: string[];
}

/**
 * Categorized constraints
 */
export const CategorizedConstraintsSchema = z.object({
  operational: z.array(z.string()).optional(),
  architectural: z.array(z.string()).optional(),
  technical: z.array(z.string()).optional(),
  business: z.array(z.string()).optional(),
});

export interface CategorizedConstraints {
  operational?: string[];
  architectural?: string[];
  technical?: string[];
  business?: string[];
}

/**
 * Example-driven goals for clarity
 */
export const GoalExamplesSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
});

export interface GoalExamples {
  before?: string;
  after?: string;
}

/**
 * 5-point quality scorecard for goal maturity
 */
const QualityLevelSchema = z.enum(['high', 'medium', 'low']);

export const QualityMetricsSchema = z.object({
  clarity: QualityLevelSchema,
  measurability: QualityLevelSchema,
  specificity: QualityLevelSchema,
  scope_clarity: QualityLevelSchema,
  constraint_strength: QualityLevelSchema,
});

export interface QualityMetrics {
  clarity: 'high' | 'medium' | 'low';
  measurability: 'high' | 'medium' | 'low';
  specificity: 'high' | 'medium' | 'low';
  scope_clarity: 'high' | 'medium' | 'low';
  constraint_strength: 'high' | 'medium' | 'low';
}

/**
 * Preservation constraints for structural safety
 * Prevents kaseki-241-style failures where agents remove protected content
 */
export const ProtectedLineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  pattern: z.string().optional(),
  description: z.string().optional(),
});

export const StructuralRequirementsSchema = z.object({
  preserve_headings: z.boolean().optional(),
  preserve_code_blocks: z.boolean().optional(),
  preserve_tables: z.boolean().optional(),
  preserve_links: z.boolean().optional(),
});

export const PreservationConstraintsSchema = z.object({
  protected_sections: z.array(z.string()).optional(),
  protected_line_ranges: z.array(ProtectedLineRangeSchema).optional(),
  max_line_reduction: z.number().int().nonnegative().optional(),
  structural_requirements: StructuralRequirementsSchema.optional(),
});

export interface ProtectedLineRange {
  start: number;
  end: number;
  pattern?: string;
  description?: string;
}

export interface StructuralRequirements {
  preserve_headings?: boolean;
  preserve_code_blocks?: boolean;
  preserve_tables?: boolean;
  preserve_links?: boolean;
}

export interface PreservationConstraints {
  protected_sections?: string[];
  protected_line_ranges?: ProtectedLineRange[];
  max_line_reduction?: number;
  structural_requirements?: StructuralRequirements;
}

/**
 * Complete goal-setting output
 * Produced by the goal-setting agent and used to upgrade TASK_PROMPT
 */
export const GoalSettingOutputSchema = z.object({
  original_prompt: z.string(),
  upgraded_goal: z.string(),
  key_requirements: z.array(z.string()),
  success_criteria: z.array(SuccessCriterionSchema),
  anti_patterns: AntiPatternsSchema.optional(),
  constraints: CategorizedConstraintsSchema.optional(),
  examples: GoalExamplesSchema.optional(),
  quality_metrics: QualityMetricsSchema.optional(),
  preservation_constraints: PreservationConstraintsSchema.optional(),
  reasoning: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export interface GoalSettingOutput {
  original_prompt: string;
  upgraded_goal: string;
  key_requirements: string[];
  success_criteria: SuccessCriterion[];
  anti_patterns?: AntiPatterns;
  constraints?: CategorizedConstraints;
  examples?: GoalExamples;
  quality_metrics?: QualityMetrics;
  preservation_constraints?: PreservationConstraints;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Parse and validate runtime goal-setting output.
 */
export function parseGoalSettingOutput(output: unknown): GoalSettingOutput {
  return GoalSettingOutputSchema.parse(output);
}

/**
 * Runtime type guard for goal-setting output.
 */
export function isGoalSettingOutput(output: unknown): output is GoalSettingOutput {
  return GoalSettingOutputSchema.safeParse(output).success;
}

/**
 * Type guard: Check if criterion is SmartCriterion (object) vs string.
 */
export function isSmartCriterion(value: unknown): value is SmartCriterion {
  return SmartCriterionSchema.safeParse(value).success;
}

/**
 * Calculate numeric goal quality score from GoalSettingOutput or QualityMetrics.
 * Scoring: high=25, medium=12.5, low=0 points per dimension.
 * Returns 50 (midpoint) if no quality metrics provided.
 */
export function calculateGoalQualityScore(goal: GoalSettingOutput | QualityMetrics): number {
  // Extract metrics from GoalSettingOutput or use directly if QualityMetrics
  const metrics: QualityMetrics | undefined =
    'quality_metrics' in goal && goal.quality_metrics
      ? goal.quality_metrics
      : 'clarity' in (goal as any) && !('original_prompt' in goal)
        ? (goal as QualityMetrics)
        : undefined;

  if (!metrics) return 50; // Default midpoint score

  const scoreMap: Record<'high' | 'medium' | 'low', number> = {
    high: 25,
    medium: 12.5,
    low: 0,
  };

  return (
    scoreMap[metrics.clarity] +
    scoreMap[metrics.measurability] +
    scoreMap[metrics.specificity] +
    scoreMap[metrics.scope_clarity] +
    scoreMap[metrics.constraint_strength]
  );
}

/**
 * Collect quality warnings from a goal output.
 */
export function hasQualityWarnings(goal: GoalSettingOutput): string[] {
  const warnings: string[] = [];

  // Check structure
  if (!goal.anti_patterns ||
     (!goal.anti_patterns.do_not_modify?.length &&
      !goal.anti_patterns.do_not_break?.length &&
      !goal.anti_patterns.must_preserve?.length)) {
    warnings.push('No explicit anti-patterns defined - recommended for safety');
  }

  if (!goal.examples || (!goal.examples.before && !goal.examples.after)) {
    warnings.push('No examples provided - recommended for clarity');
  }

  if (!goal.constraints ||
     (!goal.constraints.operational?.length &&
      !goal.constraints.architectural?.length &&
      !goal.constraints.technical?.length &&
      !goal.constraints.business?.length)) {
    warnings.push('No constraints provided - recommended for architectural safety');
  }

  // Check SMART criteria
  const hasWeakSmart = goal.success_criteria.some(c =>
    typeof c !== 'string' && c.smart_score === 'low'
  );
  if (hasWeakSmart) {
    warnings.push('Success criteria not measurable (low smart_score)');
  }

  // Check quality metrics
  if (goal.quality_metrics) {
    const metrics = goal.quality_metrics;
    if (metrics.clarity === 'low') warnings.push('Goal clarity is low');
    if (metrics.measurability === 'low') warnings.push('Success criteria not measurable');
    if (metrics.specificity === 'low') warnings.push('Goal specificity is low');
    if (metrics.scope_clarity === 'low') warnings.push('Scope boundaries are unclear');
    if (metrics.constraint_strength === 'low') warnings.push('Constraint strength is low');
  }

  return warnings;
}

/**
 * Extract criterion text from SuccessCriterion union.
 * If string, returns as-is. If SmartCriterion object, returns criterion field.
 */
export function getCriterionText(criterion: SuccessCriterion): string {
  return typeof criterion === 'string' ? criterion : criterion.criterion;
}

/**
 * Preservation violation types
 */
export interface PreservationViolation {
  type: 'section_removed' | 'line_reduction_exceeded' | 'protected_range_deleted' | 'structural_requirement_broken';
  detail?: string;
  lineRange?: { start: number; end: number };
  actual?: number;
  limit?: number;
}

/**
 * Extract preservation violations from analysis result
 */
export function extractPreservationViolations(analysis: {
  originalLines: number;
  modifiedLines: number;
  removedSections?: string[];
  removedLineRanges?: Array<{ start: number; end: number }>;
  constraints: {
    max_line_reduction?: number;
    protected_sections?: string[];
  };
}): PreservationViolation[] {
  const violations: PreservationViolation[] = [];

  // Check removed sections
  if (analysis.removedSections && analysis.constraints.protected_sections) {
    for (const section of analysis.removedSections) {
      if (analysis.constraints.protected_sections.includes(section)) {
        violations.push({
          type: 'section_removed',
          detail: `Protected section removed: ${section}`,
        });
      }
    }
  }

  // Check line reduction
  if (analysis.constraints.max_line_reduction !== undefined) {
    const netReduction = analysis.originalLines - analysis.modifiedLines;
    if (netReduction > analysis.constraints.max_line_reduction) {
      violations.push({
        type: 'line_reduction_exceeded',
        detail: `File reduced by ${netReduction} lines, max allowed: ${analysis.constraints.max_line_reduction}`,
        actual: netReduction,
        limit: analysis.constraints.max_line_reduction,
      });
    }
  }

  return violations;
}

/**
 * Build caveman-style preservation warnings for Pi prompt
 * Token-efficient, no articles, direct imperatives
 */
export function buildPreservationWarnings(constraints: {
  must_preserve?: string[];
  max_line_reduction?: number;
}): string {
  const parts: string[] = ['⚠ PRESERVATION CONSTRAINTS:'];

  if (constraints.must_preserve && constraints.must_preserve.length > 0) {
    parts.push('');
    parts.push('MUST PRESERVE:');
    for (const item of constraints.must_preserve) {
      // Extract line range if present
      const match = item.match(/\(lines? (\d+)-(\d+)\)/);
      if (match) {
        parts.push(`  • ${item}`);
        parts.push(`    DO NOT: Delete, move, restructure`);
        parts.push(`    MAY: Add content before/after`);
      } else {
        parts.push(`  • ${item}`);
      }
    }
  }

  if (constraints.max_line_reduction !== undefined) {
    parts.push('');
    parts.push(`Max removal: ${constraints.max_line_reduction} lines`);
  }

  return parts.join('\n');
}
