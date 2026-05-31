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
 * Helper to check if a criterion is in new SmartCriterion format
 */
export function isSmartCriterion(c: SuccessCriterion): c is SmartCriterion {
  return typeof c === 'object' && 'criterion' in c;
}

/**
 * Get criterion text from either format
 */
export function getCriterionText(c: SuccessCriterion): string {
  return isSmartCriterion(c) ? c.criterion : c;
}

/**
 * Calculate overall goal quality score (0-100)
 */
export function calculateGoalQualityScore(output: GoalSettingOutput): number {
  if (!output.quality_metrics) return 50; // Default if no metrics provided

  const metrics = output.quality_metrics;
  const scores: Record<'high' | 'medium' | 'low', number> = {
    high: 25,
    medium: 12.5,
    low: 0,
  };

  const keys = Object.keys(metrics) as Array<keyof QualityMetrics>;
  const totalScore = keys.reduce((sum, key) => sum + scores[metrics[key]], 0);
  return Math.round(totalScore); // 0-100
}

/**
 * Check if goal has critical warnings
 */
export function hasQualityWarnings(output: GoalSettingOutput): string[] {
  const warnings: string[] = [];

  if (!output.quality_metrics) {
    warnings.push('No quality metrics provided');
  } else {
    const { clarity, measurability, specificity, scope_clarity, constraint_strength } =
      output.quality_metrics;

    if (clarity === 'low') warnings.push('Goal clarity is low - may cause agent confusion');
    if (measurability === 'low') warnings.push('Success criteria not measurable - agent may not know when done');
    if (specificity === 'low') warnings.push('Scope not specific enough - risk of scope creep');
    if (scope_clarity === 'low') warnings.push('Scope boundaries unclear - agent may change unintended files');
    if (constraint_strength === 'low') warnings.push('Constraints may not be enforceable by downstream agents');
  }

  if (!output.anti_patterns || Object.keys(output.anti_patterns).length === 0) {
    warnings.push('No explicit anti-patterns defined - recommended for safety');
  }

  if (!output.constraints || Object.keys(output.constraints).length === 0) {
    warnings.push('No constraints provided - recommended for scope control');
  }

  if (!output.examples) {
    warnings.push('No examples provided - would improve clarity');
  }

  return warnings;
}
