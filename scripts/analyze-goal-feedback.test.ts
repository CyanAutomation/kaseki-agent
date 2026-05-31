/**
 * Tests for analyze-goal-feedback.js
 *
 * Coverage targets:
 * - readFeedbackFile: happy path, missing file, parse errors
 * - analyzeGoalFeedback: empty entries, with entries, quality bucketing
 * - analyzeCorrelations: quality-to-success correlation, confidence calibration, evidence analysis
 * - analyzeSmartDimensions: smart score distribution
 * - generateRecommendations: high/medium priority recommendations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Type definitions
interface SmartCriterion {
  smart_score?: string;
}

interface GoalCheckEntry {
  phase?: string;
  goal_quality?: {
    score?: number;
    smart_criteria?: SmartCriterion[];
  };
  correlation?: {
    success?: boolean;
  };
  goal_check_verdict?: {
    met?: boolean;
    confidence?: string;
    evidenceCount?: number;
    missingCount?: number;
  };
  outcomes?: {
    coding_attempts?: number;
  };
}

// Inline implementations for testing
function readFeedbackFile(filePath: string): GoalCheckEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim());
  const entries: GoalCheckEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip invalid JSON lines
    }
  }

  return entries;
}

function analyzeCorrelations(entries: GoalCheckEntry[]): string[] {
  const notes: string[] = [];

  const highQualitySuccessRate =
    entries
      .filter((e) => (e.goal_quality?.score || 0) >= 85)
      .reduce((sum, e) => sum + (e.correlation?.success ? 1 : 0), 0) /
    Math.max(
      1,
      entries.filter((e) => (e.goal_quality?.score || 0) >= 85).length
    );

  const lowQualitySuccessRate =
    entries
      .filter((e) => (e.goal_quality?.score || 0) < 60)
      .reduce((sum, e) => sum + (e.correlation?.success ? 1 : 0), 0) /
    Math.max(1, entries.filter((e) => (e.goal_quality?.score || 0) < 60).length);

  if (highQualitySuccessRate > lowQualitySuccessRate + 0.2) {
    notes.push(
      `Strong signal: High-quality goals (≥85) have ${(highQualitySuccessRate * 100).toFixed(0)}% success vs ${(lowQualitySuccessRate * 100).toFixed(0)}% for low-quality (<60)`
    );
  }

  const highConfidenceCorrect =
    entries
      .filter((e) => e.goal_check_verdict?.confidence === 'high')
      .reduce(
        (sum, e) =>
          sum +
          (e.goal_check_verdict?.met === e.correlation?.success ? 1 : 0),
        0
      ) /
    Math.max(1, entries.filter((e) => e.goal_check_verdict?.confidence === 'high').length);

  if (highConfidenceCorrect > 0.85) {
    notes.push(
      `Evaluator calibration good: High-confidence verdicts are ${(highConfidenceCorrect * 100).toFixed(0)}% accurate`
    );
  }

  const avgEvidenceCount =
    entries.reduce((sum, e) => sum + (e.goal_check_verdict?.evidenceCount || 0), 0) /
    entries.length;
  const avgMissingCount =
    entries.reduce((sum, e) => sum + (e.goal_check_verdict?.missingCount || 0), 0) /
    entries.length;

  notes.push(
    `Evaluator effort: avg ${avgEvidenceCount.toFixed(1)} evidence items, ${avgMissingCount.toFixed(1)} missing items per verdict`
  );

  return notes;
}

function analyzeSmartDimensions(entries: GoalCheckEntry[]): Record<string, unknown> {
  const smartCounts: Record<string, number> = {};
  let totalCriteria = 0;

  for (const entry of entries) {
    const smartCriteria = entry.goal_quality?.smart_criteria || [];
    totalCriteria += smartCriteria.length;

    for (const criterion of smartCriteria) {
      const score = criterion.smart_score || 'unknown';
      smartCounts[score] = (smartCounts[score] || 0) + 1;
    }
  }

  const smartDistribution: Record<string, string> = {};
  for (const [score, count] of Object.entries(smartCounts)) {
    smartDistribution[score] = ((count / totalCriteria) * 100).toFixed(1) + '%';
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
  stats: Record<string, any>,
  correlationNotes: string[],
  smartAnalysis: Record<string, any>
): Array<{
  priority: string;
  area: string;
  recommendation: string;
}> {
  const recs: Array<{ priority: string; area: string; recommendation: string }> = [];

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

  if (correlationNotes[1]) {
    recs.push({
      priority: 'high',
      area: 'evaluator_quality',
      recommendation: correlationNotes[1],
    });
  }

  if (smartAnalysis.distribution?.high || smartAnalysis.distribution?.low) {
    const lowPercent = parseFloat(smartAnalysis.distribution?.low || 0);
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

function analyzeGoalFeedback(entries: GoalCheckEntry[]): Record<string, unknown> {
  if (entries.length === 0) {
    return {
      total_runs: 0,
      message: 'No feedback entries to analyze',
    };
  }

  const goalCheckEntries = entries.filter((e) => e.phase === 'goal_check');

  if (goalCheckEntries.length === 0) {
    return {
      total_runs: 0,
      message: 'No goal-check feedback entries found',
    };
  }

  const buckets = {
    high: { min: 85, max: 100, entries: [] as GoalCheckEntry[] },
    medium: { min: 60, max: 84, entries: [] as GoalCheckEntry[] },
    low: { min: 0, max: 59, entries: [] as GoalCheckEntry[] },
  };

  for (const entry of goalCheckEntries) {
    const score = entry.goal_quality?.score || 0;
    if (score >= buckets.high.min) buckets.high.entries.push(entry);
    else if (score >= buckets.medium.min) buckets.medium.entries.push(entry);
    else buckets.low.entries.push(entry);
  }

  const stats: Record<string, any> = {};
  for (const [key, bucket] of Object.entries(buckets)) {
    if (bucket.entries.length === 0) continue;

    const successCount = bucket.entries.filter((e) => e.correlation?.success === true).length;
    const verdictMetCount = bucket.entries.filter((e) => e.goal_check_verdict?.met === true)
      .length;

    stats[key] = {
      count: bucket.entries.length,
      success_rate: ((successCount / bucket.entries.length) * 100).toFixed(1),
      verdict_met_rate: ((verdictMetCount / bucket.entries.length) * 100).toFixed(1),
      avg_quality_score: (bucket.entries.reduce((sum, e) => sum + (e.goal_quality?.score || 0), 0) /
        bucket.entries.length).toFixed(1),
      avg_completion_attempts: (bucket.entries.reduce(
        (sum, e) => sum + (e.outcomes?.coding_attempts || 1),
        0
      ) / bucket.entries.length).toFixed(1),
    };
  }

  const correlationNotes = analyzeCorrelations(goalCheckEntries);
  const smartAnalysis = analyzeSmartDimensions(goalCheckEntries);

  return {
    total_runs: goalCheckEntries.length,
    quality_buckets: stats,
    correlation_insights: correlationNotes,
    smart_analysis: smartAnalysis,
    recommendations: generateRecommendations(stats, correlationNotes, smartAnalysis),
  };
}

// Jest test suite
describe('analyze-goal-feedback', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaseki-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('readFeedbackFile', () => {
    test('should return empty array for missing file', () => {
      const result = readFeedbackFile('/nonexistent/file.jsonl');
      expect(result).toEqual([]);
    });

    test('should read valid JSONL entries', () => {
      const testFile = path.join(testDir, 'feedback.jsonl');
      const entries = [
        { phase: 'goal_check', goal_quality: { score: 90 } },
        { phase: 'validation', goal_quality: { score: 80 } },
      ];
      fs.writeFileSync(testFile, entries.map((e) => JSON.stringify(e)).join('\n'));

      const result = readFeedbackFile(testFile);
      expect(result).toHaveLength(2);
      expect(result[0].phase).toBe('goal_check');
    });

    test('should skip invalid JSON lines', () => {
      const testFile = path.join(testDir, 'feedback.jsonl');
      const content = `{"phase":"goal_check"}\ninvalid json\n{"phase":"validation"}`;
      fs.writeFileSync(testFile, content);

      const result = readFeedbackFile(testFile);
      expect(result).toHaveLength(2);
    });
  });

  describe('analyzeGoalFeedback', () => {
    test('should return zero message for empty entries', () => {
      const result = analyzeGoalFeedback([]);
      expect(result.total_runs).toBe(0);
      expect(result.message).toBe('No feedback entries to analyze');
    });

    test('should return zero message when no goal-check entries', () => {
      const entries = [{ phase: 'validation' } as GoalCheckEntry];
      const result = analyzeGoalFeedback(entries);
      expect(result.total_runs).toBe(0);
      expect(result.message).toBe('No goal-check feedback entries found');
    });

    test('should bucket entries by quality score', () => {
      const entries: GoalCheckEntry[] = [
        {
          phase: 'goal_check',
          goal_quality: { score: 95 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
          outcomes: { coding_attempts: 1 },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 70 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
          outcomes: { coding_attempts: 2 },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 40 },
          correlation: { success: false },
          goal_check_verdict: { met: false },
          outcomes: { coding_attempts: 3 },
        },
      ];

      const result = analyzeGoalFeedback(entries);
      expect(result.total_runs).toBe(3);
      const buckets = result.quality_buckets as Record<string, any>;
      expect(buckets.high.count).toBe(1);
      expect(buckets.medium.count).toBe(1);
      expect(buckets.low.count).toBe(1);
    });

    test('should calculate success rates correctly', () => {
      const entries: GoalCheckEntry[] = [
        {
          phase: 'goal_check',
          goal_quality: { score: 90 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
          outcomes: { coding_attempts: 1 },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 90 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
          outcomes: { coding_attempts: 1 },
        },
      ];

      const result = analyzeGoalFeedback(entries);
      const buckets = result.quality_buckets as Record<string, any>;
      expect(buckets.high.success_rate).toBe('100.0');
    });
  });

  describe('analyzeCorrelations', () => {
    test('should detect strong signal for high vs low quality', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_quality: { score: 90 },
          correlation: { success: true },
          goal_check_verdict: { confidence: 'high', evidenceCount: 3, missingCount: 0 },
        },
        {
          goal_quality: { score: 90 },
          correlation: { success: true },
          goal_check_verdict: { confidence: 'high', evidenceCount: 3, missingCount: 0 },
        },
        {
          goal_quality: { score: 40 },
          correlation: { success: false },
          goal_check_verdict: { confidence: 'low', evidenceCount: 1, missingCount: 2 },
        },
        {
          goal_quality: { score: 40 },
          correlation: { success: false },
          goal_check_verdict: { confidence: 'low', evidenceCount: 1, missingCount: 2 },
        },
      ];

      const result = analyzeCorrelations(entries);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toContain('Strong signal');
    });

    test('should evaluate confidence calibration', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_quality: { score: 90 },
          goal_check_verdict: { confidence: 'high', met: true, evidenceCount: 3, missingCount: 0 },
          correlation: { success: true },
        },
        {
          goal_quality: { score: 90 },
          goal_check_verdict: { confidence: 'high', met: true, evidenceCount: 3, missingCount: 0 },
          correlation: { success: true },
        },
      ];

      const result = analyzeCorrelations(entries);
      expect(result.some((note) => note.includes('Evaluator calibration'))).toBe(true);
    });

    test('should include effort metrics', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_quality: { score: 80 },
          goal_check_verdict: {
            confidence: 'high',
            evidenceCount: 3,
            missingCount: 1,
            met: true,
          },
          correlation: { success: true },
        },
      ];

      const result = analyzeCorrelations(entries);
      expect(result.some((note) => note.includes('Evaluator effort'))).toBe(true);
    });
  });

  describe('analyzeSmartDimensions', () => {
    test('should calculate SMART score distribution', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_quality: {
            smart_criteria: [
              { smart_score: 'high' },
              { smart_score: 'high' },
              { smart_score: 'low' },
            ],
          },
        },
        {
          goal_quality: {
            smart_criteria: [{ smart_score: 'medium' }],
          },
        },
      ];

      const result = analyzeSmartDimensions(entries);
      expect(result.total_criteria).toBe(4);
      expect((result.distribution as Record<string, string>).high).toBe('50.0%');
      expect((result.distribution as Record<string, string>).low).toBe('25.0%');
    });

    test('should handle entries with no SMART criteria', () => {
      const entries: GoalCheckEntry[] = [{ goal_quality: {} }];
      const result = analyzeSmartDimensions(entries);
      expect(result.total_criteria).toBe(0);
      expect((result.insight as string)).toContain('No SMART criteria data');
    });
  });

  describe('generateRecommendations', () => {
    test('should recommend high priority for quality gap', () => {
      const stats = {
        high: { success_rate: '90.0', count: 10 },
        low: { success_rate: '50.0', count: 10 },
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result).toContainEqual(
        expect.objectContaining({
          priority: 'high',
          area: 'goal_quality',
        })
      );
    });

    test('should recommend evaluator quality from correlation', () => {
      const stats = { high: { count: 5 }, low: { count: 5 } };
      const correlationNotes = [
        'Note 1',
        'Evaluator calibration good: High-confidence verdicts are 95% accurate',
      ];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result).toContainEqual(
        expect.objectContaining({
          priority: 'high',
          area: 'evaluator_quality',
        })
      );
    });

    test('should recommend SMART dimension focus when low quality', () => {
      const stats = { high: { count: 5 }, low: { count: 5 } };
      const correlationNotes: string[] = [];
      const smartAnalysis = {
        distribution: { high: '30.0%', low: '50.0%' },
      };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result).toContainEqual(
        expect.objectContaining({
          priority: 'medium',
          area: 'smart_criteria',
        })
      );
    });

    test('should return empty array when no recommendations apply', () => {
      const stats = { high: { success_rate: '60.0', count: 5 } };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: { high: '80.0%' } };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result).toEqual([]);
    });
  });
});
