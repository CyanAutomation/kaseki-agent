import { ARTIFACT_METADATA_REGISTRY } from '../artifact-metadata';
import { RunEvaluationRenderedResponse } from '../kaseki-api-types';

/**
 * Extract value from object using field name variant priority.
 * Tries keys in order and returns the first truthy value.
 * @internal exported for testing
 */
export function getFieldVariant(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/**
 * Determine MIME content type for an artifact based on file name.
 * @internal exported for testing
 */
export function artifactContentType(fileName: string): string {
  const metadata = ARTIFACT_METADATA_REGISTRY[fileName];
  if (metadata) {
    return metadata.contentType;
  }
  // Fallback
  if (fileName.endsWith('.json')) return 'application/json';
  if (fileName.endsWith('.md')) return 'text/markdown';
  if (fileName.endsWith('.jsonl')) return 'application/x-jsonl';
  if (fileName.endsWith('.tsv')) return 'text/tab-separated-values';
  return 'text/plain';
}

/**
 * Convert a value to a string array, handling multiple input types.
 * @internal exported for testing
 */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [String(value)];
}

/**
 * Convert a value to an array of objects, handling type coercion.
 * @internal exported for testing
 */
export function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : { value: entry }));
}

/**
 * Extract assessment section from parsed evaluation.
 * Handles multiple field name variants: overall, overall_assessment, overallAssessment.
 * @internal exported for testing
 */
export function extractOverallAssessment(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const assessment = getFieldVariant(parsed, 'overall', 'overall_assessment', 'overallAssessment');
  return assessment ? { assessment } : undefined;
}

/**
 * Extract problem section from parsed evaluation.
 * Handles variants: problem, issues, problems.
 * @internal exported for testing
 */
export function extractProblems(parsed: Record<string, unknown>): string[] {
  return asStringArray(getFieldVariant(parsed, 'problem', 'issues', 'problems'));
}

/**
 * Extract solution section from parsed evaluation.
 * Handles variants: solution, what_was_fixed, whatWasFixed, fixes.
 * @internal exported for testing
 */
export function extractSolutions(parsed: Record<string, unknown>): string[] {
  return asStringArray(getFieldVariant(parsed, 'solution', 'what_was_fixed', 'whatWasFixed', 'fixes'));
}

/**
 * Extract human review recommendations from parsed evaluation.
 * Handles variants: human_review_recommendations, humanReviewRecommendations, human_review_focus.
 * @internal exported for testing
 */
export function extractHumanReviewRecommendations(parsed: Record<string, unknown>): string[] {
  return asStringArray(getFieldVariant(parsed, 'human_review_recommendations', 'humanReviewRecommendations', 'human_review_focus'));
}

/**
 * Extract improvement opportunities from parsed evaluation.
 * Handles variants: opportunities, kaseki_improvement_opportunities, improvement_opportunities, improvementOpportunities.
 * @internal exported for testing
 */
export function extractOpportunities(parsed: Record<string, unknown>): Array<Record<string, unknown>> {
  return asObjectArray(
    getFieldVariant(parsed, 'opportunities', 'kaseki_improvement_opportunities', 'improvement_opportunities', 'improvementOpportunities')
  );
}

/**
 * Build markdown content from evaluation sections.
 * @internal exported for testing
 */
export function buildMarkdownContent(sections: { summary: string[]; problem: string[]; solution: string[]; humanReview: string[] }): string | undefined {
  const parts = [
    sections.summary.length ? `## Summary\n${sections.summary.map((line) => `- ${line}`).join('\n')}` : '',
    sections.problem.length ? `## Problem\n${sections.problem.map((line) => `- ${line}`).join('\n')}` : '',
    sections.solution.length ? `## Solution\n${sections.solution.map((line) => `- ${line}`).join('\n')}` : '',
    sections.humanReview.length ? `## Human review\n${sections.humanReview.map((line) => `- ${line}`).join('\n')}` : '',
  ];
  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? filtered.join('\n\n') : undefined;
}

/**
 * Transform a parsed run-evaluation JSON into a rendered response with organized sections.
 */
export function renderRunEvaluationPayload(parsed: Record<string, unknown>, includeMarkdown: boolean): RunEvaluationRenderedResponse {
  const sections = {
    overall: extractOverallAssessment(parsed),
    summary: asStringArray(parsed.summary),
    problem: extractProblems(parsed),
    solution: extractSolutions(parsed),
    humanReview: extractHumanReviewRecommendations(parsed),
    stages: asObjectArray(getFieldVariant(parsed, 'stages', 'stage_by_stage_evaluation', 'stageByStageEvaluation')),
    efficiency: asObjectArray(getFieldVariant(parsed, 'efficiency', 'efficiency_findings', 'efficiencyFindings')),
    validation: asObjectArray(getFieldVariant(parsed, 'validation', 'validation_outcome', 'validationOutcome')),
    opportunities: extractOpportunities(parsed),
    warnings: asObjectArray(parsed.warnings),
    metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
      ? parsed.metadata as Record<string, unknown>
      : undefined,
  };

  const markdown = includeMarkdown
    ? buildMarkdownContent({ summary: sections.summary, problem: sections.problem, solution: sections.solution, humanReview: sections.humanReview })
    : undefined;

  return {
    format: 'rendered',
    file: 'run-evaluation.json',
    sections,
    markdown,
    raw: parsed,
  };
}

