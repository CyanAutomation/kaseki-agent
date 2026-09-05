import { z } from 'zod';

const ScoreSchema = z.number().min(0).max(100);
const NonNegativeNumberSchema = z.number().finite().nonnegative();

export const RunScorecardCompletenessSchema = z.enum([
  'complete',
  'provisional',
  'not_applicable',
  'unavailable',
]);

const RunScorecardPhaseIdSchema = z.enum([
  'goal_setting',
  'scouting',
  'coding',
  'validation',
  'goal_check',
  'run_evaluation',
]);

export const RunScorecardLifecycleStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
]);

const ScorecardEvidenceReferenceSchema = z.object({
  id: z.string().min(1),
  artifact: z.string().min(1),
  locator: z.string().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  completeness: RunScorecardCompletenessSchema,
});

export const ScorecardTokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(),
  cache_write_tokens: z.number().int().nonnegative(),
  unknown_tokens: z.number().int().nonnegative(),
  unavailable: z.boolean(),
  completeness: RunScorecardCompletenessSchema,
});

export const ScorecardPhaseMeasurementSchema = z.object({
  phase: RunScorecardPhaseIdSchema,
  enabled: z.boolean(),
  outcome: z.enum(['succeeded', 'failed', 'invalid_artifact', 'skipped', 'not_started']),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime().nullable(),
  duration_ms: NonNegativeNumberSchema.nullable(),
  token_usage: ScorecardTokenUsageSchema,
  measurements: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  completeness: RunScorecardCompletenessSchema,
  confidence: ScoreSchema,
  evidence: z.array(ScorecardEvidenceReferenceSchema),
  warnings: z.array(z.string()),
});

export const ScorecardTimingTotalsSchema = z.object({
  wall_clock_ms: NonNegativeNumberSchema,
  phase_duration_ms: z.object({
    goal_setting: NonNegativeNumberSchema.nullable(),
    scouting: NonNegativeNumberSchema.nullable(),
    coding: NonNegativeNumberSchema.nullable(),
    validation: NonNegativeNumberSchema.nullable(),
    goal_check: NonNegativeNumberSchema.nullable(),
    run_evaluation: NonNegativeNumberSchema.nullable(),
  }),
  completeness: RunScorecardCompletenessSchema,
});

export const ScorecardDimensionSchema = z.object({
  id: z.enum([
    'goal_quality',
    'scouting_quality',
    'implementation_quality',
    'validation_quality',
    'goal_attainment',
    'evaluation_quality',
  ]),
  weight: z.number().positive().max(1),
  effective_weight: z.number().nonnegative().max(1),
  raw_measurements: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  normalized_score: ScoreSchema,
  weighted_points: z.number().min(0).max(100),
  status: RunScorecardCompletenessSchema,
  rationale: z.string().min(1),
  evidence: z.array(ScorecardEvidenceReferenceSchema),
  warnings: z.array(z.string()),
});

const NormalizationRuleSchema = z.object({
  function: z.enum(['binary', 'weighted_components', 'target_ratio', 'inverse_target_ratio']),
  expression: z.string().min(1),
  parameters: z.record(z.number().finite()),
});

export const RunScorecardScoringConfigSchema = z.object({
  rubric_version: z.string().min(1),
  dimension_weights: z.record(z.number().nonnegative()),
  grade_bands: z.array(z.object({
    grade: z.enum(['A', 'B', 'C', 'D', 'F']),
    minimum_score: ScoreSchema,
    maximum_score: ScoreSchema,
  })),
  normalization_rules: z.record(NormalizationRuleSchema),
  task_size: z.enum(['small', 'medium', 'large', 'custom']),
  selected_targets: z.object({
    token_budget: z.number().int().positive(),
    wall_clock_ms: z.number().positive(),
    changed_lines: z.number().int().nonnegative().nullable(),
    rationale: z.string().min(1),
  }),
  caps: z.object({
    missing_diff: ScoreSchema,
    missing_validation: ScoreSchema,
    missing_diff_and_validation: ScoreSchema,
  }),
  enabled_phase_reliability_penalty_points: z.number().nonnegative(),
  disabled_phase_policy: z.literal('reweight_eligible_dimensions'),
});

export const RunScorecardSchema = z.object({
  schema_version: z.string().min(1),
  rubric_version: z.string().min(1),
  run_id: z.string().min(1),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable(),
  scored_at: z.string().datetime(),
  lifecycle_status: RunScorecardLifecycleStatusSchema,
  overall_score: ScoreSchema,
  grade: z.enum(['A', 'B', 'C', 'D', 'F']),
  evidence_coverage: z.object({
    required: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    ratio: z.number().min(0).max(1),
    missing_critical: z.array(z.enum(['diff', 'validation_result', 'goal_check', 'run_evaluation'])),
  }),
  completeness: RunScorecardCompletenessSchema,
  confidence: z.object({
    score: ScoreSchema,
    rationale: z.string().min(1),
  }),
  dimensions: z.array(ScorecardDimensionSchema),
  phases: z.object({
    goal_setting: ScorecardPhaseMeasurementSchema,
    scouting: ScorecardPhaseMeasurementSchema,
    coding: ScorecardPhaseMeasurementSchema,
    validation: ScorecardPhaseMeasurementSchema,
    goal_check: ScorecardPhaseMeasurementSchema,
    run_evaluation: ScorecardPhaseMeasurementSchema,
  }),
  token_totals: ScorecardTokenUsageSchema,
  timing_totals: ScorecardTimingTotalsSchema,
  scoring_config: RunScorecardScoringConfigSchema,
  warnings: z.array(z.string()),
});

export type RunScorecard = z.infer<typeof RunScorecardSchema>;
export type ScorecardDimension = z.infer<typeof ScorecardDimensionSchema>;
export type ScorecardPhaseMeasurement = z.infer<typeof ScorecardPhaseMeasurementSchema>;
export type RunScorecardScoringConfig = z.infer<typeof RunScorecardScoringConfigSchema>;
