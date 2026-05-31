/**
 * Goal-Setting Feedback Loop Infrastructure
 *
 * Tracks goal-setting effectiveness by correlating:
 * - Goal quality metrics
 * - Agent behavior (scouting, coding, validation outcomes)
 * - Success/failure patterns
 *
 * Enables long-term optimization: which goals lead to better agent performance?
 */

export interface GoalFeedbackEntry {
  timestamp: string;
  instance_name: string;
  goal_setting_output: {
    confidence: 'high' | 'medium' | 'low';
    quality_score: number; // 0-100
    smart_quality: 'high' | 'low';
    upgraded_goal: string;
    anti_patterns_count: number;
    constraints_count: number;
    success_criteria_count: number;
    has_examples: boolean;
  };
  agent_outcomes: {
    scouting: {
      exit_code: number;
      duration_seconds: number;
      success: boolean;
    };
    coding: {
      exit_code: number;
      duration_seconds: number;
      diff_bytes: number;
      success: boolean;
    };
    validation: {
      commands_run: string[];
      failed_commands: string[];
      exit_code: number;
      success: boolean;
    };
    goal_check: {
      success: boolean;
      met: boolean;
      duration_seconds: number;
    };
  };
  overall: {
    success: boolean;
    completed_successfully: boolean;
    total_duration_seconds: number;
    quality_gates_passed: number;
    quality_gates_failed: number;
  };
}

export interface GoalFeedbackAnalysis {
  total_runs: number;
  success_rate: number;
  average_quality_score: number;
  patterns: {
    high_quality_goals_success_rate: number;
    low_quality_goals_success_rate: number;
    with_anti_patterns_success_rate: number;
    without_anti_patterns_success_rate: number;
    with_examples_success_rate: number;
    without_examples_success_rate: number;
  };
  recommendations: string[];
  improvements_suggested: string[];
}

/**
 * Collect feedback from a kaseki run and goal-setting output
 */
export function collectGoalFeedback(
  instance_name: string,
  goal_setting_output: any,
  stage_timings: Map<string, { exit_code: number; duration_seconds: number }>,
  metadata: any
): GoalFeedbackEntry {
  const quality_score = calculateQualityScore(goal_setting_output);
  const smart_quality = detectSmartQuality(goal_setting_output);

  return {
    timestamp: new Date().toISOString(),
    instance_name,
    goal_setting_output: {
      confidence: goal_setting_output.confidence || 'low',
      quality_score,
      smart_quality,
      upgraded_goal: goal_setting_output.upgraded_goal || '',
      anti_patterns_count: countAntiPatterns(goal_setting_output),
      constraints_count: countConstraints(goal_setting_output),
      success_criteria_count: (goal_setting_output.success_criteria || []).length,
      has_examples: hasGoalExamples(goal_setting_output),
    },
    agent_outcomes: {
      scouting: extractStageOutcome(stage_timings, 'pi scouting agent'),
      coding: extractCodingStageOutcome(stage_timings, 'pi agent', metadata),
      validation: extractValidationOutcome(metadata),
      goal_check: extractGoalCheckOutcome(stage_timings, 'goal check'),
    },
    overall: {
      success: metadata.status === 0,
      completed_successfully: metadata.completed_successfully || false,
      total_duration_seconds: metadata.total_duration_seconds || 0,
      quality_gates_passed: metadata.quality_gates_passed || 0,
      quality_gates_failed: metadata.quality_gates_failed || 0,
    },
  };
}

function calculateQualityScore(output: any): number {
  if (!output.quality_metrics) return 50;

  const { clarity, measurability, specificity, scope_clarity, constraint_strength } =
    output.quality_metrics;
  const scores: Record<string, number> = { high: 25, medium: 12.5, low: 0 };

  const total =
    (scores[clarity] || 0) +
    (scores[measurability] || 0) +
    (scores[specificity] || 0) +
    (scores[scope_clarity] || 0) +
    (scores[constraint_strength] || 0);

  return Math.round(total);
}

function detectSmartQuality(output: any): 'high' | 'low' {
  if (!output.success_criteria) return 'low';

  let weak_criteria = 0;
  output.success_criteria.forEach((c: any) => {
    const smart_score = typeof c === 'object' ? c.smart_score : 'unknown';
    if (smart_score === 'low') weak_criteria++;
  });

  return weak_criteria > output.success_criteria.length / 2 ? 'low' : 'high';
}

function countAntiPatterns(output: any): number {
  if (!output.anti_patterns) return 0;
  return (Object.values(output.anti_patterns) as any[]).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

function countConstraints(output: any): number {
  if (!output.constraints) return 0;
  return (Object.values(output.constraints) as any[]).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

function hasGoalExamples(output: any): boolean {
  if (!output.examples || typeof output.examples !== 'object') return false;
  return typeof output.examples.before === 'string' || typeof output.examples.after === 'string';
}

function extractStageOutcome(
  stage_timings: Map<string, any>,
  stage_name: string
): { exit_code: number; duration_seconds: number; success: boolean } {
  const timing = stage_timings.get(stage_name) || { exit_code: -1, duration_seconds: 0 };
  return {
    exit_code: timing.exit_code,
    duration_seconds: timing.duration_seconds,
    success: timing.exit_code === 0,
  };
}

function extractCodingStageOutcome(
  stage_timings: Map<string, any>,
  stage_name: string,
  metadata: any
): { exit_code: number; duration_seconds: number; diff_bytes: number; success: boolean } {
  const timing = stage_timings.get(stage_name) || { exit_code: -1, duration_seconds: 0 };
  return {
    exit_code: timing.exit_code,
    duration_seconds: timing.duration_seconds,
    diff_bytes: metadata.diff_bytes || 0,
    success: timing.exit_code === 0,
  };
}

function extractGoalCheckOutcome(
  stage_timings: Map<string, any>,
  stage_name: string
): { success: boolean; met: boolean; duration_seconds: number } {
  const timing = stage_timings.get(stage_name) || { exit_code: -1, duration_seconds: 0 };
  return {
    success: timing.exit_code === 0,
    met: timing.exit_code === 0,
    duration_seconds: timing.duration_seconds,
  };
}

function extractValidationOutcome(metadata: any): {
  commands_run: string[];
  failed_commands: string[];
  exit_code: number;
  success: boolean;
} {
  return {
    commands_run: metadata.validation_commands_run || [],
    failed_commands: metadata.validation_failed_commands || [],
    exit_code: metadata.validation_exit_code || -1,
    success: (metadata.validation_exit_code || -1) === 0,
  };
}

/**
 * Analyze patterns from multiple feedback entries
 */
export function analyzeGoalFeedback(entries: GoalFeedbackEntry[]): GoalFeedbackAnalysis {
  if (entries.length === 0) {
    return {
      total_runs: 0,
      success_rate: 0,
      average_quality_score: 0,
      patterns: {
        high_quality_goals_success_rate: 0,
        low_quality_goals_success_rate: 0,
        with_anti_patterns_success_rate: 0,
        without_anti_patterns_success_rate: 0,
        with_examples_success_rate: 0,
        without_examples_success_rate: 0,
      },
      recommendations: [],
      improvements_suggested: [],
    };
  }

  const total_runs = entries.length;
  const successful = entries.filter((e) => e.overall.success).length;
  const success_rate = successful / total_runs;
  const average_quality_score =
    entries.reduce((sum, e) => sum + e.goal_setting_output.quality_score, 0) / total_runs;

  const high_quality = entries.filter((e) => e.goal_setting_output.quality_score >= 75);
  const low_quality = entries.filter((e) => e.goal_setting_output.quality_score < 50);
  const with_anti_patterns = entries.filter((e) => e.goal_setting_output.anti_patterns_count > 0);
  const without_anti_patterns = entries.filter((e) => e.goal_setting_output.anti_patterns_count === 0);
  const with_examples = entries.filter((e) => e.goal_setting_output.has_examples);
  const without_examples = entries.filter((e) => !e.goal_setting_output.has_examples);

  const recommendations: string[] = [];
  const improvements_suggested: string[] = [];

  if (high_quality.length > 0) {
    const hq_success =
      high_quality.filter((e) => e.overall.success).length / high_quality.length;
    if (hq_success > success_rate + 0.1) {
      recommendations.push(
        `High-quality goals (score >= 75) have ${(hq_success * 100).toFixed(0)}% success rate vs. ${(success_rate * 100).toFixed(0)}% overall. Focus on improving goal quality.`
      );
    }
  }

  if (with_anti_patterns.length > 0 && without_anti_patterns.length > 0) {
    const with_success =
      with_anti_patterns.filter((e) => e.overall.success).length / with_anti_patterns.length;
    const without_success =
      without_anti_patterns.filter((e) => e.overall.success).length / without_anti_patterns.length;

    if (with_success > without_success + 0.1) {
      improvements_suggested.push(
        `Goals with explicit anti-patterns: ${(with_success * 100).toFixed(0)}% success vs. ${(without_success * 100).toFixed(0)}% without. Anti-patterns improve reliability.`
      );
    }
  }

  if (average_quality_score < 50) {
    improvements_suggested.push('Average goal quality is below 50/100. Focus on SMART criteria and clarity.');
  }

  return {
    total_runs,
    success_rate,
    average_quality_score,
    patterns: {
      high_quality_goals_success_rate:
        high_quality.length > 0
          ? high_quality.filter((e) => e.overall.success).length / high_quality.length
          : 0,
      low_quality_goals_success_rate:
        low_quality.length > 0
          ? low_quality.filter((e) => e.overall.success).length / low_quality.length
          : 0,
      with_anti_patterns_success_rate:
        with_anti_patterns.length > 0
          ? with_anti_patterns.filter((e) => e.overall.success).length / with_anti_patterns.length
          : 0,
      without_anti_patterns_success_rate:
        without_anti_patterns.length > 0
          ? without_anti_patterns.filter((e) => e.overall.success).length / without_anti_patterns.length
          : 0,
      with_examples_success_rate:
        with_examples.length > 0
          ? with_examples.filter((e) => e.overall.success).length / with_examples.length
          : 0,
      without_examples_success_rate:
        without_examples.length > 0
          ? without_examples.filter((e) => e.overall.success).length / without_examples.length
          : 0,
    },
    recommendations,
    improvements_suggested,
  };
}
