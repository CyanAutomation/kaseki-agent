#!/usr/bin/env node

/**
 * Analyze goal-setting feedback across multiple runs
 *
 * Usage:
 *   node analyze-goal-feedback.js [feedback_file]
 *
 * Reads JSONL feedback entries and produces analysis report showing:
 * - Correlation between goal quality and success rate
 * - SMART dimension effectiveness
 * - Kaseki improvement suggestions by priority
 *
 * Default: reads /results/goal-feedback.jsonl
 */

import fs from 'node:fs';

interface FeedbackEntry {
  phase?: string;
  goal_quality?: Record<string, unknown>;
  goal_check_verdict?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
  outcomes?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BucketStats {
  count: number;
  success_rate: string;
  verdict_met_rate: string;
  avg_quality_score: string;
  avg_completion_attempts: string;
}

interface BucketData {
  [key: string]: BucketStats;
}

interface SmartAnalysis {
  total_criteria: number;
  distribution: Record<string, string>;
  insight: string;
}

interface Recommendation {
  priority: string;
  area: string;
  recommendation: string;
}

interface Analysis {
  total_runs: number;
  message?: string;
  quality_buckets?: BucketData;
  correlation_insights?: string[];
  smart_analysis?: SmartAnalysis;
  recommendations?: Recommendation[];
}

function readFeedbackFile(filePath: string): FeedbackEntry[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`Feedback file not found: ${filePath}`);
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim());
  const entries: FeedbackEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      console.warn(`Failed to parse feedback entry: ${(e as Error).message}`);
    }
  }

  return entries;
}

function analyzeGoalFeedback(entries: FeedbackEntry[]): Analysis {
  if (entries.length === 0) {
    return {
      total_runs: 0,
      message: 'No feedback entries to analyze',
    };
  }

  // Filter for goal-check entries only
  const goalCheckEntries = entries.filter((e) => e.phase === 'goal_check');

  if (goalCheckEntries.length === 0) {
    return {
      total_runs: 0,
      message: 'No goal-check feedback entries found',
    };
  }

  // Bucket by goal quality
  const buckets: Record<string, { min: number; max: number; entries: FeedbackEntry[] }> = {
    high: { min: 85, max: 100, entries: [] },
    medium: { min: 60, max: 84, entries: [] },
    low: { min: 0, max: 59, entries: [] },
  };

  for (const entry of goalCheckEntries) {
    const score = (entry.goal_quality as Record<string, unknown>)?.score as number || 0;
    if (score >= buckets.high.min) buckets.high.entries.push(entry);
    else if (score >= buckets.medium.min) buckets.medium.entries.push(entry);
    else buckets.low.entries.push(entry);
  }

  // Compute statistics per bucket
  const stats: BucketData = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    if (bucket.entries.length === 0) continue;

    const successCount = bucket.entries.filter(
      (e) => (e.correlation as Record<string, unknown>)?.success === true,
    ).length;
    const verdictMetCount = bucket.entries.filter(
      (e) => (e.goal_check_verdict as Record<string, unknown>)?.met === true,
    ).length;

    stats[key] = {
      count: bucket.entries.length,
      success_rate: (((successCount / bucket.entries.length) * 100).toFixed(1)),
      verdict_met_rate: (((verdictMetCount / bucket.entries.length) * 100).toFixed(1)),
      avg_quality_score: (
        (bucket.entries.reduce((sum, e) => sum + ((e.goal_quality as Record<string, unknown>)?.score as number || 0), 0) /
          bucket.entries.length)
          .toFixed(1)
      ),
      avg_completion_attempts: (
        (bucket.entries.reduce((sum, e) => sum + ((e.outcomes as Record<string, unknown>)?.coding_attempts as number || 1), 0) /
          bucket.entries.length)
          .toFixed(1)
      ),
    };
  }

  // Analyze correlations
  const correlationNotes = analyzeCorrelations(goalCheckEntries);

  // SMART dimension analysis
  const smartAnalysis = analyzeSmartDimensions(goalCheckEntries);

  return {
    total_runs: goalCheckEntries.length,
    quality_buckets: stats,
    correlation_insights: correlationNotes,
    smart_analysis: smartAnalysis,
    recommendations: generateRecommendations(stats, correlationNotes, smartAnalysis),
  };
}

function analyzeCorrelations(entries: FeedbackEntry[]): string[] {
  const notes: string[] = [];

  // Goal quality vs success
  const highQualitySuccessRate =
    entries
      .filter((e) => ((e.goal_quality as Record<string, unknown>)?.score as number || 0) >= 85)
      .reduce((sum, e) => sum + (((e.correlation as Record<string, unknown>)?.success as boolean) ? 1 : 0), 0) /
    Math.max(1, entries.filter((e) => ((e.goal_quality as Record<string, unknown>)?.score as number || 0) >= 85).length);

  const lowQualitySuccessRate =
    entries
      .filter((e) => ((e.goal_quality as Record<string, unknown>)?.score as number || 0) < 60)
      .reduce((sum, e) => sum + (((e.correlation as Record<string, unknown>)?.success as boolean) ? 1 : 0), 0) /
    Math.max(1, entries.filter((e) => ((e.goal_quality as Record<string, unknown>)?.score as number || 0) < 60).length);

  if (highQualitySuccessRate > lowQualitySuccessRate + 0.2) {
    notes.push(
      `Strong signal: High-quality goals (≥85) have ${(highQualitySuccessRate * 100).toFixed(0)}% success vs ${(lowQualitySuccessRate * 100).toFixed(0)}% for low-quality (<60)`,
    );
  }

  // Confidence grounding
  const highConfidenceCorrect =
    entries
      .filter((e) => (e.goal_check_verdict as Record<string, unknown>)?.confidence === 'high')
      .reduce(
        (sum, e) =>
          sum +
          (((e.goal_check_verdict as Record<string, unknown>)?.met as boolean) ===
          ((e.correlation as Record<string, unknown>)?.success as boolean) ? 1 : 0),
        0,
      ) / Math.max(1, entries.filter((e) => (e.goal_check_verdict as Record<string, unknown>)?.confidence === 'high').length);

  if (highConfidenceCorrect > 0.85) {
    notes.push(`Evaluator calibration good: High-confidence verdicts are ${(highConfidenceCorrect * 100).toFixed(0)}% accurate`);
  }

  // Evidence correlation
  const avgEvidenceCount =
    entries.reduce((sum, e) => sum + ((e.goal_check_verdict as Record<string, unknown>)?.evidenceCount as number || 0), 0) /
    entries.length;
  const avgMissingCount =
    entries.reduce((sum, e) => sum + ((e.goal_check_verdict as Record<string, unknown>)?.missingCount as number || 0), 0) /
    entries.length;
  notes.push(
    `Evaluator effort: avg ${avgEvidenceCount.toFixed(1)} evidence items, ${avgMissingCount.toFixed(1)} missing items per verdict`,
  );

  return notes;
}

function analyzeSmartDimensions(entries: FeedbackEntry[]): SmartAnalysis {
  const smartCounts: Record<string, number> = {};
  let totalCriteria = 0;

  for (const entry of entries) {
    const smartCriteria = ((entry.goal_quality as Record<string, unknown>)?.smart_criteria as unknown[]) || [];
    totalCriteria += smartCriteria.length;

    for (const criterion of smartCriteria) {
      const crit = criterion as Record<string, unknown>;
      const score = (crit.smart_score || 'unknown') as string;
      smartCounts[score] = (smartCounts[score] || 0) + 1;
    }
  }

  const smartDistribution: Record<string, string> = {};
  for (const [score, count] of Object.entries(smartCounts)) {
    smartDistribution[score] = (((count / totalCriteria) * 100).toFixed(1)) + '%';
  }

  return {
    total_criteria: totalCriteria,
    distribution: smartDistribution,
    insight:
      totalCriteria > 0
        ? `${smartCounts.high || 0} high-quality SMART criteria, ${smartCounts.low || 0} low-quality`
        : 'No SMART criteria data',
  };
}

function generateRecommendations(
  stats: BucketData,
  correlationNotes: string[],
  smartAnalysis: SmartAnalysis,
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Recommendation 1: Focus on goal quality
  const highCount = stats.high?.count || 0;
  const lowCount = stats.low?.count || 0;
  if (highCount > 0 && lowCount > 0) {
    const highSuccess = parseFloat(stats.high?.success_rate || '0');
    const lowSuccess = parseFloat(stats.low?.success_rate || '0');
    if (highSuccess > lowSuccess + 20) {
      recs.push({
        priority: 'high',
        area: 'goal_quality',
        recommendation: `High-quality goals have ${highSuccess.toFixed(0)}% vs ${lowSuccess.toFixed(0)}% success for low-quality. Invest in goal-setting phase—ROI is clear.`,
      });
    }
  }

  // Recommendation 2: Evaluator calibration
  if (correlationNotes[1]) {
    recs.push({
      priority: 'high',
      area: 'evaluator_quality',
      recommendation: correlationNotes[1],
    });
  }

  // Recommendation 3: SMART criteria strength
  if (smartAnalysis.distribution.high || smartAnalysis.distribution.low) {
    const lowPercent = parseFloat(smartAnalysis.distribution.low || '0');
    if (lowPercent > 20) {
      recs.push({
        priority: 'medium',
        area: 'smart_criteria',
        recommendation: `${lowPercent.toFixed(0)}% of SMART criteria score low. Goal-setting should emphasize measurability and specificity.`,
      });
    }
  }

  return recs;
}

function printQualityBuckets(analysis: Analysis): void {
  const bucketLabels: Record<string, string> = {
    high: 'High (≥85)',
    medium: 'Medium (60-84)',
    low: 'Low (<60)',
  };
  for (const bucket of ['high', 'medium', 'low']) {
    const stats = analysis.quality_buckets?.[bucket];
    if (!stats) continue;
    console.log(`  ${bucketLabels[bucket]}`);
    console.log(`    Count: ${stats.count}`);
    console.log(`    Success rate: ${stats.success_rate}%`);
    console.log(`    Verdict met rate: ${stats.verdict_met_rate}%`);
    console.log(`    Avg quality score: ${stats.avg_quality_score}/100`);
    console.log(`    Avg coding attempts: ${stats.avg_completion_attempts}`);
    console.log();
  }
}

function printInsights(analysis: Analysis): void {
  if (analysis.correlation_insights && analysis.correlation_insights.length > 0) {
    console.log('🔗 Correlation Insights\n');
    for (const insight of analysis.correlation_insights) console.log(`  • ${insight}`);
    console.log();
  }

  if (analysis.smart_analysis && analysis.smart_analysis.total_criteria > 0) {
    console.log('✨ SMART Criteria Analysis\n');
    console.log(`  Total criteria: ${analysis.smart_analysis.total_criteria}`);
    console.log('  Distribution:');
    for (const [score, pct] of Object.entries(analysis.smart_analysis.distribution)) {
      console.log(`    ${score}: ${pct}`);
    }
    console.log(`  Insight: ${analysis.smart_analysis.insight}`);
    console.log();
  }
}

function printRecommendations(analysis: Analysis): void {
  if (!analysis.recommendations || analysis.recommendations.length === 0) return;
  console.log('💡 Recommendations\n');
  for (const [priority, label] of [['high', '⚡ High Priority:'], ['medium', '→ Medium Priority:']] as const) {
    const recommendations = analysis.recommendations.filter((item) => item.priority === priority);
    if (recommendations.length === 0) continue;
    console.log(`  ${label}`);
    for (const recommendation of recommendations) {
      console.log(`    • [${recommendation.area}] ${recommendation.recommendation}`);
    }
    console.log();
  }
}

function printAnalysis(analysis: Analysis, feedbackFile: string): void {
  console.log('\n📊 Kaseki Goal-Setting Feedback Analysis');
  console.log('=====================================\n');
  console.log(`Reading: ${feedbackFile}\n`);

  if (analysis.total_runs === 0) {
    console.log('⚠️  ' + (analysis.message || ''));
    console.log('\nNo analysis available yet. Run kaseki instances to generate feedback.\n');
    process.exit(0);
  }

  console.log(`📈 Goal Quality vs Success Rate (${analysis.total_runs} runs)\n`);
  printQualityBuckets(analysis);
  printInsights(analysis);
  printRecommendations(analysis);
  console.log('✅ Analysis complete\n');
}

function main(): void {
  const feedbackFile = process.argv[2] || '/results/goal-feedback.jsonl';
  printAnalysis(analyzeGoalFeedback(readFeedbackFile(feedbackFile)), feedbackFile);
}

// Automatic execution when run directly (CommonJS-safe approach)
// This check avoids using import.meta.url which breaks in CommonJS transpilation
const isCliMode = process.argv[1]?.includes('analyze-goal-feedback');
if (isCliMode && typeof (globalThis as any).jest === 'undefined') {
  // Only run main if we're definitely in CLI mode and NOT in Jest test environment
  try {
    main();
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

// Internal test harness - consolidates helper functions used only by tests
// These are not part of the public API; tests should import via testHarness only
const testHarness = {
  readFeedbackFile,
  analyzeGoalFeedback,
  analyzeCorrelations,
  analyzeSmartDimensions,
  generateRecommendations,
};

// Public API: main() for CLI execution
// Test imports: use testHarness from module exports
export { testHarness, main };
