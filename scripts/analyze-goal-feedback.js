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

const fs = require('fs');

function readFeedbackFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Feedback file not found: ${filePath}`);
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim());
  const entries = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      console.warn(`Failed to parse feedback entry: ${e.message}`);
    }
  }

  return entries;
}

function analyzeGoalFeedback(entries) {
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
  const buckets = {
    high: { min: 85, max: 100, entries: [] },
    medium: { min: 60, max: 84, entries: [] },
    low: { min: 0, max: 59, entries: [] },
  };

  for (const entry of goalCheckEntries) {
    const score = entry.goal_quality?.score || 0;
    if (score >= buckets.high.min) buckets.high.entries.push(entry);
    else if (score >= buckets.medium.min) buckets.medium.entries.push(entry);
    else buckets.low.entries.push(entry);
  }

  // Compute statistics per bucket
  const stats = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    if (bucket.entries.length === 0) continue;

    const successCount = bucket.entries.filter((e) => e.correlation?.success === true).length;
    const verdictMetCount = bucket.entries.filter((e) => e.goal_check_verdict?.met === true).length;

    stats[key] = {
      count: bucket.entries.length,
      success_rate: ((successCount / bucket.entries.length) * 100).toFixed(1),
      verdict_met_rate: ((verdictMetCount / bucket.entries.length) * 100).toFixed(1),
      avg_quality_score: (bucket.entries.reduce((sum, e) => sum + (e.goal_quality?.score || 0), 0) / bucket.entries.length).toFixed(1),
      avg_completion_attempts: (bucket.entries.reduce((sum, e) => sum + (e.outcomes?.coding_attempts || 1), 0) / bucket.entries.length).toFixed(1),
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

function analyzeCorrelations(entries) {
  const notes = [];

  // Goal quality vs success
  const highQualitySuccessRate = entries
    .filter((e) => (e.goal_quality?.score || 0) >= 85)
    .reduce((sum, e) => sum + (e.correlation?.success ? 1 : 0), 0) / Math.max(1, entries.filter((e) => (e.goal_quality?.score || 0) >= 85).length);

  const lowQualitySuccessRate = entries
    .filter((e) => (e.goal_quality?.score || 0) < 60)
    .reduce((sum, e) => sum + (e.correlation?.success ? 1 : 0), 0) / Math.max(1, entries.filter((e) => (e.goal_quality?.score || 0) < 60).length);

  if (highQualitySuccessRate > lowQualitySuccessRate + 0.2) {
    notes.push(`Strong signal: High-quality goals (≥85) have ${(highQualitySuccessRate * 100).toFixed(0)}% success vs ${(lowQualitySuccessRate * 100).toFixed(0)}% for low-quality (<60)`);
  }

  // Confidence grounding
  const highConfidenceCorrect = entries
    .filter((e) => e.goal_check_verdict?.confidence === 'high')
    .reduce((sum, e) => sum + (e.goal_check_verdict?.met === e.correlation?.success ? 1 : 0), 0) / Math.max(1, entries.filter((e) => e.goal_check_verdict?.confidence === 'high').length);

  if (highConfidenceCorrect > 0.85) {
    notes.push(`Evaluator calibration good: High-confidence verdicts are ${(highConfidenceCorrect * 100).toFixed(0)}% accurate`);
  }

  // Evidence correlation
  const avgEvidenceCount = entries.reduce((sum, e) => sum + (e.goal_check_verdict?.evidenceCount || 0), 0) / entries.length;
  const avgMissingCount = entries.reduce((sum, e) => sum + (e.goal_check_verdict?.missingCount || 0), 0) / entries.length;
  notes.push(`Evaluator effort: avg ${avgEvidenceCount.toFixed(1)} evidence items, ${avgMissingCount.toFixed(1)} missing items per verdict`);

  return notes;
}

function analyzeSmartDimensions(entries) {
  const smartCounts = {};
  let totalCriteria = 0;

  for (const entry of entries) {
    const smartCriteria = entry.goal_quality?.smart_criteria || [];
    totalCriteria += smartCriteria.length;

    for (const criterion of smartCriteria) {
      const score = criterion.smart_score || 'unknown';
      smartCounts[score] = (smartCounts[score] || 0) + 1;
    }
  }

  const smartDistribution = {};
  for (const [score, count] of Object.entries(smartCounts)) {
    smartDistribution[score] = ((count / totalCriteria) * 100).toFixed(1) + '%';
  }

  return {
    total_criteria: totalCriteria,
    distribution: smartDistribution,
    insight: totalCriteria > 0 ? `${smartCounts.high || 0} high-quality SMART criteria, ${smartCounts.low || 0} low-quality` : 'No SMART criteria data',
  };
}

function generateRecommendations(stats, correlationNotes, smartAnalysis) {
  const recs = [];

  // Recommendation 1: Focus on goal quality
  const highCount = stats.high?.count || 0;
  const lowCount = stats.low?.count || 0;
  if (highCount > 0 && lowCount > 0) {
    const highSuccess = parseFloat(stats.high?.success_rate || 0);
    const lowSuccess = parseFloat(stats.low?.success_rate || 0);
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
    const lowPercent = parseFloat(smartAnalysis.distribution.low || 0);
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

function main() {
  const args = process.argv.slice(2);
  const feedbackFile = args[0] || '/results/goal-feedback.jsonl';

  console.log('\n📊 Kaseki Goal-Setting Feedback Analysis');
  console.log('=====================================\n');
  console.log(`Reading: ${feedbackFile}\n`);

  const entries = readFeedbackFile(feedbackFile);
  const analysis = analyzeGoalFeedback(entries);

  if (analysis.total_runs === 0) {
    console.log('⚠️  ' + analysis.message);
    console.log('\nNo analysis available yet. Run kaseki instances to generate feedback.\n');
    process.exit(0);
  }

  // Print quality bucket stats
  console.log(`📈 Goal Quality vs Success Rate (${analysis.total_runs} runs)\n`);

  const bucketLabels = { high: 'High (≥85)', medium: 'Medium (60-84)', low: 'Low (<60)' };
  const bucketOrder = ['high', 'medium', 'low'];

  for (const bucket of bucketOrder) {
    if (analysis.quality_buckets[bucket]) {
      const stats = analysis.quality_buckets[bucket];
      console.log(`  ${bucketLabels[bucket]}`);
      console.log(`    Count: ${stats.count}`);
      console.log(`    Success rate: ${stats.success_rate}%`);
      console.log(`    Verdict met rate: ${stats.verdict_met_rate}%`);
      console.log(`    Avg quality score: ${stats.avg_quality_score}/100`);
      console.log(`    Avg coding attempts: ${stats.avg_completion_attempts}`);
      console.log();
    }
  }

  // Correlation insights
  if (analysis.correlation_insights.length > 0) {
    console.log('🔗 Correlation Insights\n');
    for (const insight of analysis.correlation_insights) {
      console.log(`  • ${insight}`);
    }
    console.log();
  }

  // SMART analysis
  if (analysis.smart_analysis.total_criteria > 0) {
    console.log('✨ SMART Criteria Analysis\n');
    console.log(`  Total criteria: ${analysis.smart_analysis.total_criteria}`);
    console.log('  Distribution:');
    for (const [score, pct] of Object.entries(analysis.smart_analysis.distribution)) {
      console.log(`    ${score}: ${pct}`);
    }
    console.log(`  Insight: ${analysis.smart_analysis.insight}`);
    console.log();
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log('💡 Recommendations\n');
    const highRecs = analysis.recommendations.filter((r) => r.priority === 'high');
    const mediumRecs = analysis.recommendations.filter((r) => r.priority === 'medium');

    if (highRecs.length > 0) {
      console.log('  ⚡ High Priority:');
      for (const rec of highRecs) {
        console.log(`    • [${rec.area}] ${rec.recommendation}`);
      }
      console.log();
    }

    if (mediumRecs.length > 0) {
      console.log('  → Medium Priority:');
      for (const rec of mediumRecs) {
        console.log(`    • [${rec.area}] ${rec.recommendation}`);
      }
      console.log();
    }
  }

  console.log('✅ Analysis complete\n');
}

main();
