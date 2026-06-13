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

function parseJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`Failed to parse JSON from ${filePath}:`, e.message);
    return {};
  }
}

function collectGoalCheckFeedback(instanceName, goalSettingPath, goalCheckPath, metadataPath) {
  const goalSetting = parseJson(goalSettingPath);
  const goalCheck = parseJson(goalCheckPath);
  const metadata = parseJson(metadataPath);

  // Extract goal quality metrics
  const qualityMetrics = goalSetting.quality_metrics || {};
  const qualityScore = goalSetting.quality_score || 0;
  const smartCriteria = goalSetting.success_criteria || [];

  // Extract goal-check verdict
  const verdict = {
    met: goalCheck.met === true,
    confidence: goalCheck.confidence || 'unknown',
    evidenceCount: (goalCheck.evidence || []).length,
    missingCount: (goalCheck.missing || []).length,
  };

  // Extract outcomes from metadata
  const outcomes = extractOutcomes(metadata);

  // Build feedback entry
  const feedback = {
    timestamp: new Date().toISOString(),
    instance_name: instanceName,
    phase: 'goal_check',
    goal_quality: {
      score: qualityScore,
      metrics: qualityMetrics,
      smart_criteria_count: smartCriteria.length,
    },
    goal_check_verdict: verdict,
    outcomes,
    correlation: {
      goal_quality: qualityScore,
      verdict_met: verdict.met,
      success: verdict.met && outcomes.validation_passed,
      confidence_grade: verdict.confidence,
      notes: computeCorrelationNotes(qualityScore, verdict, outcomes),
    },
  };

  return feedback;
}

function collectRunEvaluationFeedback(instanceName, runEvaluationPath, metadataPath) {
  const runEvaluation = parseJson(runEvaluationPath);
  const metadata = parseJson(metadataPath);

  const feedback = {
    timestamp: new Date().toISOString(),
    instance_name: instanceName,
    phase: 'run_evaluation',
    assessment: {
      overall_assessment: runEvaluation.overall_assessment || 'unknown',
      reviewer_confidence: runEvaluation.reviewer_confidence || 'unknown',
      task_completion_score: runEvaluation.task_completion_score || 0,
    },
    stage_values: parseStageValues(runEvaluation.stage_value || []),
    improvements: parseImprovements(runEvaluation.kaseki_improvement_opportunities || []),
    outcomes: extractOutcomes(metadata),
  };

  return feedback;
}

function extractOutcomes(metadata) {
  return {
    validation_passed: metadata.validation_passed === true,
    coding_attempts: metadata.coding_attempts || 1,
    total_duration_seconds: metadata.total_duration_seconds || 0,
    goal_check_met: metadata.goal_check_met === true,
  };
}

function computeCorrelationNotes(qualityScore, verdict, outcomes) {
  const notes = [];

  if (qualityScore >= 85 && !verdict.met) {
    notes.push('High-quality goal but verdict unmet—investigate scouting/coding accuracy');
  }
  if (qualityScore < 60 && verdict.met) {
    notes.push('Low-quality goal but verdict met—goal clarity issues may mask real requirements');
  }
  if (verdict.confidence === 'low' && verdict.evidenceCount < 2) {
    notes.push('Evaluator confidence low with sparse evidence—goal clarity issue?');
  }
  if (outcomes.validation_passed && !verdict.met) {
    notes.push('Validation passed but goal unmet—agent may have fixed wrong thing');
  }

  return notes;
}

function parseStageValues(stageValues) {
  return stageValues.map((s) => ({
    stage: s.stage || 'unknown',
    value: s.value || 'unknown',
  }));
}

function parseImprovements(improvements) {
  return improvements.map((imp) => ({
    category: imp.category || 'unknown',
    priority: imp.priority || 'medium',
  }));
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: collect-feedback.js <phase> <instance_name> [paths...]');
    process.exit(1);
  }

  const phase = args[0];
  const instanceName = args[1];

  let feedback;

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

  // Output as JSONL for append
  console.log(JSON.stringify(feedback));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
