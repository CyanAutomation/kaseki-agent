import { GoalSettingOutput, GoalSettingOutputSchema } from '../types/goal-setting';

/**
 * Placeholder patterns that indicate unprocessed template text
 * from goal-setting prompts. These should never appear in valid output.
 */
export const PLACEHOLDER_PATTERNS = [
  /\bthe original user prompt\b/i,
  /\bconcise goal \(1-3 sentences\), actionable for a coding agent\b/i,
  /\brequirement 1 \(critical constraint or dependency\)\b/i,
  /\bspecific, measurable criterion\b/i,
  /\bbrief reason \(e\.g\., clearly measurable, achievable in one run\)\b/i,
  /\bpath\/pattern[0-9]+\/\*\*/i,
  /\be\.g\., max 3 files changed\b/i,
  /\be\.g\., respect service boundaries\b/i,
  /\be\.g\., must pass type checking\b/i,
  /\be\.g\., maintain user-facing behavior\b/i,
  /\bexplanation of upgrades made and key decisions\b/i,
  /\binput\/state before changes \(if inferrable\)\b/i,
  /\bexpected output\/state after changes \(if inferrable\)\b/i,
];

/**
 * Detect placeholder content patterns in goal-setting artifact.
 * Returns array of detected placeholder patterns.
 *
 * @param artifact Goal-setting artifact (object or JSON string)
 * @returns Array of detected placeholder patterns (empty if none found)
 */
export function detectPlaceholders(artifact: unknown): string[] {
  const found: string[] = [];

  // Convert to string for pattern matching
  let str: string;
  if (typeof artifact === 'string') {
    str = artifact;
  } else {
    try {
      str = JSON.stringify(artifact);
    } catch {
      return [];
    }
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(str)) {
      found.push(pattern.source);
    }
  }

  return found;
}

/**
 * Check if artifact contains placeholder content.
 *
 * @param artifact Goal-setting artifact (object or JSON string)
 * @returns True if placeholders detected
 */
export function hasPlaceholders(artifact: unknown): boolean {
  return detectPlaceholders(artifact).length > 0;
}

/**
 * Create a minimal valid goal-setting artifact as a fallback
 * when the goal-setting agent fails to produce valid output.
 *
 * The fallback uses the original task prompt as the goal
 * and marks confidence as "low" to indicate degraded mode.
 *
 * @param taskPrompt Original task prompt from the run request
 * @returns Valid GoalSettingOutput with low confidence
 */
export function createFallbackGoalSettingArtifact(taskPrompt: string): GoalSettingOutput {
  return {
    original_prompt: taskPrompt,
    upgraded_goal: taskPrompt,
    key_requirements: ['Complete the task as specified', 'Maintain stability'],
    success_criteria: [
      {
        criterion: 'Task completed as specified in the original prompt',
        smart_score: 'medium',
        reasoning: 'Primary success criterion when goal-setting failed',
      },
    ],
    anti_patterns: {
      do_not_modify: [],
      do_not_break: ['Existing functionality', 'API contracts'],
      must_preserve: [],
    },
    constraints: {
      operational: [],
      architectural: [],
      technical: ['Must pass type checking if applicable'],
      business: [],
    },
    reasoning: 'Fallback goal-setting artifact generated because the goal-setting agent failed to produce valid output with concrete task-specific content. Using original task prompt as primary reference.',
    confidence: 'low',
  };
}

/**
 * Validate that a goal-setting artifact is valid and complete.
 * Checks:
 * - Required fields are present and non-empty
 * - No placeholder content detected
 * - Valid Zod schema compliance
 *
 * @param artifact Artifact to validate
 * @returns True if valid, false otherwise
 */
export function isValidGoalSettingArtifact(artifact: unknown): boolean {
  // Check for placeholder content first
  if (hasPlaceholders(artifact)) {
    return false;
  }

  // Validate against Zod schema
  const result = GoalSettingOutputSchema.safeParse(artifact);
  return result.success;
}

/**
 * Extract placeholder detection summary for logging.
 * Returns human-readable list of detected placeholder types.
 *
 * @param artifact Artifact to analyze
 * @returns Human-readable string describing detected placeholders
 */
export function getPlaceholderSummary(artifact: unknown): string {
  const found = detectPlaceholders(artifact);
  if (found.length === 0) {
    return 'No placeholders detected';
  }

  const placeholderNames = found.map((pattern) => {
    if (pattern.includes('original user prompt')) return 'original_prompt';
    if (pattern.includes('1-3 sentences')) return 'upgraded_goal';
    if (pattern.includes('specific, measurable')) return 'success_criteria';
    if (pattern.includes('pattern')) return 'anti_patterns.do_not_modify';
    if (pattern.includes('max 3 files')) return 'constraints.operational';
    if (pattern.includes('service boundaries')) return 'constraints.architectural';
    if (pattern.includes('type checking')) return 'constraints.technical';
    if (pattern.includes('maintain user')) return 'constraints.business';
    if (pattern.includes('upgrades made')) return 'reasoning';
    return pattern.substring(0, 30);
  });

  return `Detected placeholder content in: ${placeholderNames.join(', ')}`;
}
