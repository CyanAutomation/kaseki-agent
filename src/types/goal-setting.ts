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
const SmartCriterionSchema = z.object({
  criterion: z.string().trim().min(1),
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
const SuccessCriterionSchema = z.union([z.string(), SmartCriterionSchema]);

export type SuccessCriterion = string | SmartCriterion;

/**
 * Anti-patterns and hard boundaries
 */
const AntiPatternsSchema = z.object({
  do_not_modify: z.array(z.string()).optional(),
  do_not_break: z.array(z.string()).optional(),
  must_preserve: z.array(z.string()).optional(),
}).strict().refine(
  (antiPatterns) =>
    [antiPatterns.do_not_modify, antiPatterns.do_not_break, antiPatterns.must_preserve]
      .some((entries) => entries?.some((entry) => entry.trim().length > 0)),
  { message: 'anti_patterns must include at least one non-empty boundary' },
);

export interface AntiPatterns {
  do_not_modify?: string[];
  do_not_break?: string[];
  must_preserve?: string[];
}

/**
 * Categorized constraints
 */
const CategorizedConstraintsSchema = z.object({
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
const GoalExamplesSchema = z.object({
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

const QualityMetricsSchema = z.object({
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
const ProtectedLineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  pattern: z.string().optional(),
  description: z.string().optional(),
});

const StructuralRequirementsSchema = z.object({
  preserve_headings: z.boolean().optional(),
  preserve_code_blocks: z.boolean().optional(),
  preserve_tables: z.boolean().optional(),
  preserve_links: z.boolean().optional(),
});

const PreservationConstraintsSchema = z.object({
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
  success_criteria: z.array(SuccessCriterionSchema).min(1).refine(
    (criteria) => criteria.some((criterion) => typeof criterion === 'string' || criterion.smart_score !== 'low'),
    { message: 'success_criteria must include at least one measurable SMART criterion' },
  ),
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

// Compatibility exports keep existing consumers on the stable module path while
// allowing quality and preservation rules to evolve independently.
export { calculateGoalQualityScore, hasQualityWarnings, getCriterionText } from './goal-setting-quality';
export {
  PreservationViolation,
  extractPreservationViolations,
  buildPreservationWarnings,
} from './goal-setting-preservation';
