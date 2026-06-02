/**
 * Goal-Check Causality Assessment Integration
 *
 * Integrates validation failure causality analysis results into goal-check
 * decision-making to distinguish between:
 * - Implementation failures (goal-check verdict should fail)
 * - Pre-existing test failures (goal-check verdict might still succeed)
 * - Mixed scenarios (goal-check verdict requires nuanced assessment)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface CausalityAssessment {
  timestamp: string;
  assessment: {
    failureType: 'change_related' | 'pre_existing' | 'mixed' | 'inconclusive';
    confidence: number; // 0.0-1.0
    rationale: string;
    signals: {
      comparativeResults?: {
        analysis: any;
        indicatesChangeRelated: boolean;
        weight: number;
      };
      logMarkers?: {
        markers: any[];
        indicatesChangeRelated: boolean;
        weight: number;
      };
      codeImpact?: {
        analysis: any;
        indicatesChangeRelated: boolean;
        weight: number;
      };
    };
  };
  version: string;
}

export interface GoalCheckCausalityContext {
  has_causality_assessment: boolean;
  failure_type?: 'change_related' | 'pre_existing' | 'mixed' | 'inconclusive';
  confidence?: number;
  rationale?: string;
  recommendation?: string;
  implementation_valid?: boolean;
  should_consider_pre_existing?: boolean;
}

/**
 * Load causality assessment from artifact file
 */
export function loadCausalityAssessment(
  resultsDir: string = '/results'
): CausalityAssessment | null {
  const artifactPath = path.join(resultsDir, 'validation-causality-analysis.json');

  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(artifactPath, 'utf-8');
    return JSON.parse(content) as CausalityAssessment;
  } catch (err) {
    console.error(`Failed to load causality assessment: ${err}`);
    return null;
  }
}

/**
 * Extract goal-check context from causality assessment
 *
 * This informs goal-check whether validation failures are due to:
 * 1. Code changes (implementation not valid)
 * 2. Pre-existing issues (implementation might still be valid)
 * 3. Unclear (requires additional investigation)
 */
export function extractGoalCheckContext(
  causality: CausalityAssessment | null
): GoalCheckCausalityContext {
  if (!causality) {
    return {
      has_causality_assessment: false,
    };
  }

  const failureType = causality.assessment.failureType;
  const confidence = causality.assessment.confidence;

  // Determine recommendation for goal-check
  let recommendation = '';
  let implementation_valid = false;
  let should_consider_pre_existing = false;

  switch (failureType) {
    case 'change_related':
      recommendation = `Validation failures are caused by code changes (${(confidence * 100).toFixed(0)}% confidence). Implementation is NOT valid; goal-check should fail.`;
      implementation_valid = false;
      should_consider_pre_existing = false;
      break;

    case 'pre_existing':
      recommendation = `Validation failures are pre-existing, not caused by code changes (${(confidence * 100).toFixed(0)}% confidence). Implementation may still be valid; consider goal-check verdict on implementation merit alone.`;
      implementation_valid = true;
      should_consider_pre_existing = true;
      break;

    case 'mixed':
      recommendation = `Validation failures are mixed: some caused by changes, some pre-existing (${(confidence * 100).toFixed(0)}% confidence). Goal-check should: (1) Identify change-related failures and fail on those, (2) Accept pre-existing failures as non-blocking if they don't touch changed code.`;
      implementation_valid = false; // Fail on change-related failures
      should_consider_pre_existing = true;
      break;

    case 'inconclusive':
      recommendation = `Causality assessment is inconclusive (${(confidence * 100).toFixed(0)}% confidence). Goal-check should make determination based on other evidence (changed files, diff quality, requirements alignment).`;
      implementation_valid = false; // Conservative: fail until proven otherwise
      should_consider_pre_existing = false;
      break;
  }

  return {
    has_causality_assessment: true,
    failure_type: failureType,
    confidence,
    rationale: causality.assessment.rationale,
    recommendation,
    implementation_valid,
    should_consider_pre_existing,
  };
}

/**
 * Format causality assessment for display in goal-check prompt
 */
export function formatCausalityForGoalCheck(context: GoalCheckCausalityContext): string {
  if (!context.has_causality_assessment) {
    return '(No causality assessment available)';
  }

  const lines = [
    `Failure Causality Assessment:`,
    `- Type: ${context.failure_type}`,
    `- Confidence: ${(context.confidence! * 100).toFixed(0)}%`,
    `- Rationale: ${context.rationale}`,
    `- Recommendation: ${context.recommendation}`,
  ];

  if (context.should_consider_pre_existing) {
    lines.push(
      `⚠️  Note: Some failures appear to be pre-existing. Evaluate goal-check verdict considering only changes introduced in this run.`
    );
  }

  if (!context.implementation_valid) {
    lines.push(
      `❌ Assessment: Code changes directly caused validation failures. Implementation is not valid.`
    );
  } else {
    lines.push(
      `✓ Assessment: Failures are not caused by code changes. Implementation may be valid despite validation failures.`
    );
  }

  return lines.join('\n');
}

/**
 * Adjust goal-check verdict based on causality assessment
 *
 * If implementation otherwise meets goal requirements but validation failed due to
 * pre-existing issues, this may modify the verdict:
 * - If failure is change_related: verdict should FAIL (implementation not valid)
 * - If failure is pre_existing: verdict can PASS if implementation requirements met
 * - If failure is mixed: verdict should FAIL on change-related items, accept pre-existing
 * - If failure is inconclusive: conservative approach (fail)
 */
export function suggestVerdictAdjustment(
  initialVerdictMet: boolean,
  validationFailed: boolean,
  causality: GoalCheckCausalityContext
): {
  suggestedMet: boolean;
  adjustmentReason: string;
  confidence: 'high' | 'medium' | 'low';
} {
  // No adjustment if validation passed or no causality assessment
  if (!validationFailed || !causality.has_causality_assessment) {
    return {
      suggestedMet: initialVerdictMet,
      adjustmentReason: validationFailed ? 'No causality assessment available' : 'Validation passed',
      confidence: 'high',
    };
  }

  // Adjust based on causality verdict
  if (causality.failure_type === 'pre_existing') {
    return {
      suggestedMet:
        initialVerdictMet ||
        (causality.confidence! >= 0.75), /* High-confidence pre-existing failures don't block goal */
      adjustmentReason: `Failures are pre-existing (${(causality.confidence! * 100).toFixed(0)}% confidence). Implementation requirements can be assessed independently of validation failures.`,
      confidence: causality.confidence! >= 0.75 ? 'high' : 'medium',
    };
  }

  if (causality.failure_type === 'mixed') {
    return {
      suggestedMet: false, /* Mixed verdict: must investigate change-related failures */
      adjustmentReason: `Failures are mixed. Change-related items must be fixed before goal can be met.`,
      confidence: 'medium',
    };
  }

  if (causality.failure_type === 'change_related') {
    return {
      suggestedMet: false,
      adjustmentReason: `Failures are caused by code changes (${(causality.confidence! * 100).toFixed(0)}% confidence). Implementation is not valid.`,
      confidence: causality.confidence! >= 0.75 ? 'high' : 'medium',
    };
  }

  // Inconclusive: conservative approach
  return {
    suggestedMet: false,
    adjustmentReason: `Causality assessment is inconclusive. Conservative approach: fail until clearer evidence is available.`,
    confidence: 'low',
  };
}

/**
 * Generate causality assessment context for goal-check prompt
 */
export function generateCausalityPromptSection(
  resultsDir: string = '/results'
): string {
  const causality = loadCausalityAssessment(resultsDir);
  const context = extractGoalCheckContext(causality);
  const formatted = formatCausalityForGoalCheck(context);

  return `## Validation Failure Causality Assessment

${formatted}

---
`;
}

/**
 * Check if causality assessment suggests implementation is still valid
 */
export function isImplementationLikelyValid(
  causality: GoalCheckCausalityContext
): boolean {
  if (!causality.has_causality_assessment) {
    return false; // Unknown
  }

  // Implementation is likely valid if:
  // 1. Failures are pre_existing with high confidence
  // 2. Mixed failures but not all related to code changes
  return causality.failure_type === 'pre_existing' && causality.confidence! >= 0.75;
}
