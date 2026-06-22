#!/usr/bin/env node

/**
 * Collect goal-check and run-evaluation feedback for analysis
 *
 * Usage:
 *   node collect-feedback.js goal-check <instance_name> <goal_setting_json> <goal_check_json> <metadata_json>
 *   node collect-feedback.js run-evaluation <instance_name> <run_evaluation_json> <metadata_json>
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

interface Feedback {
  timestamp: string;
  instance_name: string;
  phase: string;
  [key: string]: unknown;
}

interface Outcomes {
  validation_passed: boolean;
  coding_attempts: number;
  total_duration_seconds: number;
  goal_check_met: boolean;
}

interface StageValue {
  stage: string;
  value: string;
}

interface Improvement {
  category: string;
  priority: string;
}

function parseJson(filePath: string): Record<string, unknown> {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`Failed to parse JSON from ${filePath}:`, (e as Error).message);
    return {};
  }
}

function collectGoalCheckFeedback(instanceName: string, goalSettingPath: string, goalCheckPath: string, metadataPath: string): Feedback {
  const goalSetting = parseJson(goalSettingPath) as Record<string, unknown>;
  const goalCheck = parseJson(goalCheckPath) as Record<string, unknown>;
  const metadata = parseJson(metadataPath) as Record<string, unknown>;

  // Extract goal quality metrics
  const qualityMetrics = goalSetting.quality_metrics || {};
  const qualityScore = goalSetting.quality_score || 0;
  const smartCriteria = goalSetting.success_criteria || [];

  // Extract goal-check verdict
  const verdict = {
    met: goalCheck.met === true,
    confidence: goalCheck.confidence || 'unknown',
    evidenceCount: ((goalCheck.evidence as unknown[]) || []).length,
    missingCount: ((goalCheck.missing as unknown[]) || []).length,
  };

  // Extract outcomes from metadata
  const outcomes = extractOutcomes(metadata);

  // Build feedback entry
  const feedback: Feedback = {
    timestamp: new Date().toISOString(),
    instance_name: instanceName,
    phase: 'goal_check',
    goal_quality: {
      score: qualityScore,
      metrics: qualityMetrics,
      smart_criteria_count: (smartCriteria as unknown[]).length,
    },
    goal_check_verdict: verdict,
    outcomes,
    correlation: {
      goal_quality: qualityScore,
      verdict_met: verdict.met,
      success: verdict.met && outcomes.validation_passed,
      confidence_grade: verdict.confidence,
      notes: computeCorrelationNotes(qualityScore as number, verdict, outcomes),
    },
  };

  return feedback;
}

function collectRunEvaluationFeedback(instanceName: string, runEvaluationPath: string, metadataPath: string): Feedback {
  const runEvaluation = parseJson(runEvaluationPath) as Record<string, unknown>;
  const metadata = parseJson(metadataPath) as Record<string, unknown>;

  const feedback: Feedback = {
    timestamp: new Date().toISOString(),
    instance_name: instanceName,
    phase: 'run_evaluation',
    assessment: {
      overall_assessment: runEvaluation.overall_assessment || 'unknown',
      reviewer_confidence: runEvaluation.reviewer_confidence || 'unknown',
      task_completion_score: runEvaluation.task_completion_score || 0,
    },
    stage_values: parseStageValues(runEvaluation.stage_value as Record<string, unknown>[] || []),
    improvements: parseImprovements(runEvaluation.kaseki_improvement_opportunities as Record<string, unknown>[] || []),
    outcomes: extractOutcomes(metadata),
  };

  return feedback;
}

function extractOutcomes(metadata: Record<string, unknown>): Outcomes {
  return {
    validation_passed: metadata.validation_passed === true,
    coding_attempts: (metadata.coding_attempts as number) || 1,
    total_duration_seconds: (metadata.total_duration_seconds as number) || 0,
    goal_check_met: metadata.goal_check_met === true,
  };
}

function computeCorrelationNotes(qualityScore: number, verdict: Record<string, unknown>, outcomes: Outcomes): string[] {
  const notes: string[] = [];

  if (qualityScore >= 85 && !verdict.met) {
    notes.push('High-quality goal but verdict unmet—investigate scouting/coding accuracy');
  }
  if (qualityScore < 60 && verdict.met) {
    notes.push('Low-quality goal but verdict met—goal clarity issues may mask real requirements');
  }
  if (verdict.confidence === 'low' && (verdict.evidenceCount as number) < 2) {
    notes.push('Evaluator confidence low with sparse evidence—goal clarity issue?');
  }
  if (outcomes.validation_passed && !verdict.met) {
    notes.push('Validation passed but goal unmet—agent may have fixed wrong thing');
  }

  return notes;
}

function parseStageValues(stageValues: Record<string, unknown>[]): StageValue[] {
  return stageValues.map((s) => ({
    stage: (s.stage as string) || 'unknown',
    value: (s.value as string) || 'unknown',
  }));
}

function parseImprovements(improvements: Record<string, unknown>[]): Improvement[] {
  return improvements.map((imp) => ({
    category: (imp.category as string) || 'unknown',
    priority: (imp.priority as string) || 'medium',
  }));
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: collect-feedback.js <phase> <instance_name> [paths...]');
    process.exit(1);
  }

  const phase = args[0];
  const instanceName = args[1];

  let feedback: Feedback;

  if (phase === 'goal-check') {
    if (args.length < 5) {
      console.error('Usage: collect-feedback.js goal-check <instance_name> <goal_setting_json> <goal_check_json> <metadata_json>');
      process.exit(1);
    }

    feedback = collectGoalCheckFeedback(instanceName, args[2], args[3], args[4]);
  } else if (phase === 'run-evaluation') {
    if (args.length < 4) {
      console.error('Usage: collect-feedback.js run-evaluation <instance_name> <run_evaluation_json> <metadata_json>');
      process.exit(1);
    }

    feedback = collectRunEvaluationFeedback(instanceName, args[2], args[3]);
  } else {
    console.error(`Unknown phase: ${phase}`);
    process.exit(1);
  }

  console.log(JSON.stringify(feedback));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
