/**
 * Tests for analyze-goal-feedback.js
 *
 * Coverage targets:
 * - readFeedbackFile: happy path, missing file, parse errors, malformed JSONL
 * - analyzeGoalFeedback: empty entries, quality bucketing (high/medium/low), success rates
 * - analyzeCorrelations: quality-to-success signal, evaluator calibration, evidence counting
 * - analyzeSmartDimensions: SMART score distribution, edge cases
 * - generateRecommendations: high/medium priority recommendations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Dynamically require the actual script (CommonJS)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = require('./analyze-goal-feedback.js');

const {
  readFeedbackFile,
  analyzeGoalFeedback,
  analyzeCorrelations,
  analyzeSmartDimensions,
  generateRecommendations,
} = script;

// Type definitions for test clarity
interface SmartCriterion {
  smart_score?: 'high' | 'medium' | 'low';
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
    confidence?: 'high' | 'medium' | 'low';
    evidenceCount?: number;
    missingCount?: number;
  };
  outcomes?: {
    coding_attempts?: number;
  };
}

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

  // ===== readFeedbackFile Tests =====
  describe('readFeedbackFile', () => {
    test('should return empty array for missing file', () => {
      const result = readFeedbackFile(path.join(testDir, 'nonexistent.jsonl'));
      expect(result).toEqual([]);
    });

    test('should read valid JSONL entries from file', () => {
      const testFile = path.join(testDir, 'feedback.jsonl');
      const entries: GoalCheckEntry[] = [
        { phase: 'goal_check', goal_quality: { score: 90 } },
        { phase: 'validation', goal_quality: { score: 80 } },
      ];
      fs.writeFileSync(testFile, entries.map((e) => JSON.stringify(e)).join('\n'));

      const result = readFeedbackFile(testFile);
      expect(result).toHaveLength(2);
      expect(result[0].phase).toBe('goal_check');
      expect(result[1].goal_quality?.score).toBe(80);
    });

    test('should skip malformed JSON lines', () => {
      const testFile = path.join(testDir, 'feedback.jsonl');
      const content = `{"phase":"goal_check","goal_quality":{"score":90}}
invalid json line
{"phase":"validation","goal_quality":{"score":80}}
{broken:json}
{"phase":"goal_check","goal_quality":{"score":85}}`;
      fs.writeFileSync(testFile, content);

      const result = readFeedbackFile(testFile);
      expect(result).toHaveLength(3);
      expect(result[0].goal_quality?.score).toBe(90);
      expect(result[1].goal_quality?.score).toBe(80);
      expect(result[2].goal_quality?.score).toBe(85);
    });

    test('should handle empty file', () => {
      const testFile = path.join(testDir, 'empty.jsonl');
      fs.writeFileSync(testFile, '');

      const result = readFeedbackFile(testFile);
      expect(result).toEqual([]);
    });

    test('should handle file with only whitespace', () => {
      const testFile = path.join(testDir, 'whitespace.jsonl');
      fs.writeFileSync(testFile, '\n\n  \n\t\n');

      const result = readFeedbackFile(testFile);
      expect(result).toEqual([]);
    });
  });

  // ===== analyzeGoalFeedback Tests =====
  describe('analyzeGoalFeedback', () => {
    test('should return message for empty entries', () => {
      const result = analyzeGoalFeedback([]);
      expect(result.total_runs).toBe(0);
      expect(result.message).toBe('No feedback entries to analyze');
    });

    test('should return message if no goal_check phase entries', () => {
      const entries: GoalCheckEntry[] = [
        { phase: 'validation', goal_quality: { score: 90 } },
        { phase: 'execution', goal_quality: { score: 80 } },
      ];

      const result = analyzeGoalFeedback(entries);
      expect(result.total_runs).toBe(0);
      expect(result.message).toBe('No goal-check feedback entries found');
    });

    test('should bucket entries by quality score (high/medium/low)', () => {
      const entries: GoalCheckEntry[] = [
        {
          phase: 'goal_check',
          goal_quality: { score: 95 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 75 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 50 },
          correlation: { success: false },
          goal_check_verdict: { met: false },
        },
      ];

      const result = analyzeGoalFeedback(entries);
      expect(result.total_runs).toBe(3);
      expect(result.quality_buckets?.high?.count).toBe(1);
      expect(result.quality_buckets?.medium?.count).toBe(1);
      expect(result.quality_buckets?.low?.count).toBe(1);
    });

    test('should calculate success rate per bucket', () => {
      const entries: GoalCheckEntry[] = [
        { phase: 'goal_check', goal_quality: { score: 90 }, correlation: { success: true } },
        { phase: 'goal_check', goal_quality: { score: 88 }, correlation: { success: true } },
        { phase: 'goal_check', goal_quality: { score: 50 }, correlation: { success: false } },
      ];

      const result = analyzeGoalFeedback(entries);
      expect(result.quality_buckets?.high?.success_rate).toBe('100.0');
      expect(result.quality_buckets?.low?.success_rate).toBe('0.0');
    });

    test('should calculate average quality score per bucket', () => {
      const entries: GoalCheckEntry[] = [
        { phase: 'goal_check', goal_quality: { score: 90 } },
        { phase: 'goal_check', goal_quality: { score: 87 } },
        { phase: 'goal_check', goal_quality: { score: 50 } },
      ];

      const result = analyzeGoalFeedback(entries);
      const highAvg = parseFloat((result.quality_buckets?.high?.avg_quality_score as string) || '0');
      expect(highAvg).toBeGreaterThan(87); // Average of 90 and 87
    });
  });

  // ===== analyzeCorrelations Tests =====
  describe('analyzeCorrelations', () => {
    test('should detect high-quality goal success signal', () => {
      const entries: GoalCheckEntry[] = [
        { goal_quality: { score: 90 }, correlation: { success: true } },
        { goal_quality: { score: 88 }, correlation: { success: true } },
        { goal_quality: { score: 50 }, correlation: { success: false } },
        { goal_quality: { score: 40 }, correlation: { success: false } },
      ];

      const result = analyzeCorrelations(entries);
      const signalNote = result.find((n: string) => n.includes('Strong signal'));
      expect(signalNote).toBeDefined();
      expect(signalNote).toMatch(/High-quality goals/);
    });

    test('should measure evaluator calibration accuracy', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_check_verdict: { confidence: 'high', met: true },
          correlation: { success: true },
        },
        {
          goal_check_verdict: { confidence: 'high', met: false },
          correlation: { success: false },
        },
        {
          goal_check_verdict: { confidence: 'high', met: true },
          correlation: { success: true },
        },
      ];

      const result = analyzeCorrelations(entries);
      const calibrationNote = result.find((n: string) => n.includes('calibration'));
      expect(calibrationNote).toBeDefined();
      expect(calibrationNote).toMatch(/\d+% accurate/);
    });

    test('should compute average evidence and missing item counts', () => {
      const entries: GoalCheckEntry[] = [
        { goal_check_verdict: { evidenceCount: 5, missingCount: 2 } },
        { goal_check_verdict: { evidenceCount: 7, missingCount: 1 } },
        { goal_check_verdict: { evidenceCount: 3, missingCount: 3 } },
      ];

      const result = analyzeCorrelations(entries);
      const effortNote = result.find((n: string) => n.includes('Evaluator effort'));
      expect(effortNote).toBeDefined();
      expect(effortNote).toMatch(/avg \d+\.\d evidence items/);
      expect(effortNote).toMatch(/\d+\.\d missing items/);
    });

    test('should return notes array for empty entries', () => {
      const entries: GoalCheckEntry[] = [];
      const result = analyzeCorrelations(entries);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0); // Should have effort note with zeros
    });
  });

  // ===== analyzeSmartDimensions Tests =====
  describe('analyzeSmartDimensions', () => {
    test('should distribute SMART scores (high/medium/low percentages)', () => {
      const entries: GoalCheckEntry[] = [
        {
          goal_quality: {
            smart_criteria: [
              { smart_score: 'high' },
              { smart_score: 'high' },
              { smart_score: 'medium' },
            ],
          },
        },
        {
          goal_quality: {
            smart_criteria: [{ smart_score: 'low' }, { smart_score: 'high' }],
          },
        },
      ];

      const result = analyzeSmartDimensions(entries);
      expect(result.total_criteria).toBe(5);
      expect(result.distribution?.high).toBe('60.0%');
      expect(result.distribution?.medium).toBe('20.0%');
      expect(result.distribution?.low).toBe('20.0%');
    });

    test('should handle entries with no SMART criteria', () => {
      const entries: GoalCheckEntry[] = [
        { goal_quality: { smart_criteria: [] } },
        { goal_quality: {} },
        {},
      ];

      const result = analyzeSmartDimensions(entries);
      expect(result.total_criteria).toBe(0);
      expect(result.insight).toBe('No SMART criteria data');
    });

    test('should provide insight summary', () => {
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
      ];

      const result = analyzeSmartDimensions(entries);
      expect(result.insight).toMatch(/\d+ high-quality.*\d+ low-quality/);
    });
  });

  // ===== generateRecommendations Tests =====
  describe('generateRecommendations', () => {
    test('should generate high-priority goal quality recommendation when strong signal', () => {
      const stats = {
        high: { count: 50, success_rate: '85.0' },
        low: { count: 50, success_rate: '45.0' },
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      const qualityRec = result.find((r: any) => r.area === 'goal_quality');
      expect(qualityRec?.priority).toBe('high');
      expect(qualityRec?.recommendation).toMatch(/Invest in goal-setting phase/);
    });

    test('should generate high-priority evaluator quality recommendation', () => {
      const stats = {};
      const correlationNotes: string[] = [
        'Some insight',
        'Evaluator calibration good: High-confidence verdicts are 90% accurate',
      ];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      const evaluatorRec = result.find((r: any) => r.area === 'evaluator_quality');
      expect(evaluatorRec?.priority).toBe('high');
      expect(evaluatorRec?.recommendation).toMatch(/calibration/);
    });

    test('should generate medium-priority SMART criteria recommendation when >20% low', () => {
      const stats = {};
      const correlationNotes: string[] = [];
      const smartAnalysis = {
        distribution: { high: '50.0%', low: '30.0%', medium: '20.0%' },
      };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      const smartRec = result.find((r: any) => r.area === 'smart_criteria');
      expect(smartRec?.priority).toBe('medium');
      expect(smartRec?.recommendation).toMatch(/measurability and specificity/);
    });

    test('should return empty array when no recommendations triggered', () => {
      const stats = {
        high: { count: 0 },
        low: { count: 0 },
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = {
        distribution: { high: '100.0%', low: '0.0%' },
      };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result).toEqual([]);
    });

    test('should not generate goal quality recommendation when high/low counts missing', () => {
      const stats = {
        high: undefined,
        low: undefined,
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result.find((r: any) => r.area === 'goal_quality')).toBeUndefined();
    });

    test('should not generate goal quality recommendation when success difference is small', () => {
      const stats = {
        high: { count: 20, success_rate: '70.0' },
        low: { count: 20, success_rate: '60.0' }, // Only 10% difference, threshold is 20%
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result.find((r: any) => r.area === 'goal_quality')).toBeUndefined();
    });

    test('should not generate SMART criteria recommendation when low < 20%', () => {
      const stats = {};
      const correlationNotes: string[] = [];
      const smartAnalysis = {
        distribution: { high: '60.0%', low: '15.0%', medium: '25.0%' },
      };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(result.find((r: any) => r.area === 'smart_criteria')).toBeUndefined();
    });
  });

  // ===== Integration Tests =====
  describe('analyzeGoalFeedback integration', () => {
    test('should produce complete analysis with recommendations for realistic dataset', () => {
      const entries: GoalCheckEntry[] = [
        // High-quality, successful runs
        {
          phase: 'goal_check',
          goal_quality: { score: 95, smart_criteria: [{ smart_score: 'high' }, { smart_score: 'high' }] },
          correlation: { success: true },
          goal_check_verdict: { met: true, confidence: 'high', evidenceCount: 8, missingCount: 0 },
          outcomes: { coding_attempts: 1 },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 88, smart_criteria: [{ smart_score: 'high' }, { smart_score: 'medium' }] },
          correlation: { success: true },
          goal_check_verdict: { met: true, confidence: 'high', evidenceCount: 7, missingCount: 1 },
          outcomes: { coding_attempts: 1 },
        },
        // Medium-quality, mixed results
        {
          phase: 'goal_check',
          goal_quality: { score: 72, smart_criteria: [{ smart_score: 'medium' }, { smart_score: 'low' }] },
          correlation: { success: true },
          goal_check_verdict: { met: true, confidence: 'medium', evidenceCount: 5, missingCount: 2 },
          outcomes: { coding_attempts: 2 },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 68, smart_criteria: [{ smart_score: 'medium' }] },
          correlation: { success: false },
          goal_check_verdict: { met: false, confidence: 'medium', evidenceCount: 4, missingCount: 3 },
          outcomes: { coding_attempts: 3 },
        },
        // Low-quality, failing runs
        {
          phase: 'goal_check',
          goal_quality: { score: 45, smart_criteria: [{ smart_score: 'low' }] },
          correlation: { success: false },
          goal_check_verdict: { met: false, confidence: 'low', evidenceCount: 2, missingCount: 5 },
          outcomes: { coding_attempts: 4 },
        },
      ];

      const result = analyzeGoalFeedback(entries);

      expect(result.total_runs).toBe(5);
      expect(result.quality_buckets?.high?.count).toBe(2);
      expect(result.quality_buckets?.medium?.count).toBe(2);
      expect(result.quality_buckets?.low?.count).toBe(1);

      expect(result.correlation_insights).toBeDefined();
      expect(result.correlation_insights.length).toBeGreaterThan(0);

      expect(result.smart_analysis?.total_criteria).toBe(8);
      expect(result.smart_analysis?.distribution).toBeDefined();

      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });


    test('should read representative feedback, skip malformed records, and produce a stable analysis contract', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const testFile = path.join(testDir, 'representative-feedback.jsonl');
      const feedbackLines = [
        {
          phase: 'goal_check',
          goal_quality: {
            score: 92,
            smart_criteria: [{ smart_score: 'high' }, { smart_score: 'high' }],
          },
          correlation: { success: true },
          goal_check_verdict: { met: true, confidence: 'high', evidenceCount: 6, missingCount: 0 },
          outcomes: { coding_attempts: 1 },
        },
        '{malformed feedback entry',
        {
          phase: 'goal_check',
          goal_quality: {
            score: 87,
            smart_criteria: [{ smart_score: 'high' }, { smart_score: 'medium' }],
          },
          correlation: { success: true },
          goal_check_verdict: { met: true, confidence: 'high', evidenceCount: 5, missingCount: 1 },
          outcomes: { coding_attempts: 2 },
        },
        {
          phase: 'goal_check',
          goal_quality: {
            score: 42,
            smart_criteria: [{ smart_score: 'low' }, { smart_score: 'low' }],
          },
          correlation: { success: false },
          goal_check_verdict: { met: false, confidence: 'high', evidenceCount: 2, missingCount: 4 },
          outcomes: { coding_attempts: 4 },
        },
        {
          phase: 'run_evaluation',
          goal_quality: { score: 100, smart_criteria: [{ smart_score: 'high' }] },
          correlation: { success: true },
        },
      ];
      fs.writeFileSync(
        testFile,
        feedbackLines.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n')
      );

      try {
        const parsedEntries = readFeedbackFile(testFile);
        const analysis = analyzeGoalFeedback(parsedEntries);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toMatch(/^Failed to parse feedback entry:/);
        expect(parsedEntries).toHaveLength(4);
        expect(Object.keys(analysis)).toEqual([
          'total_runs',
          'quality_buckets',
          'correlation_insights',
          'smart_analysis',
          'recommendations',
        ]);
        expect(Object.keys(analysis.quality_buckets)).toEqual(['high', 'low']);
        expect(Object.keys(analysis.quality_buckets.high)).toEqual([
          'count',
          'success_rate',
          'verdict_met_rate',
          'avg_quality_score',
          'avg_completion_attempts',
        ]);
        expect(Object.keys(analysis.smart_analysis)).toEqual(['total_criteria', 'distribution', 'insight']);

        expect(analysis).toEqual(
          expect.objectContaining({
            total_runs: 3,
            quality_buckets: {
              high: {
                count: 2,
                success_rate: '100.0',
                verdict_met_rate: '100.0',
                avg_quality_score: '89.5',
                avg_completion_attempts: '1.5',
              },
              low: {
                count: 1,
                success_rate: '0.0',
                verdict_met_rate: '0.0',
                avg_quality_score: '42.0',
                avg_completion_attempts: '4.0',
              },
            },
            smart_analysis: {
              total_criteria: 6,
              distribution: { high: '50.0%', medium: '16.7%', low: '33.3%' },
              insight: '3 high-quality SMART criteria, 2 low-quality',
            },
          })
        );
        expect(analysis.correlation_insights).toEqual([
          'Strong signal: High-quality goals (≥85) have 100% success vs 0% for low-quality (<60)',
          'Evaluator calibration good: High-confidence verdicts are 100% accurate',
          'Evaluator effort: avg 4.3 evidence items, 1.7 missing items per verdict',
        ]);
        expect(analysis.recommendations.map((rec: any) => `${rec.priority}:${rec.area}`)).toEqual([
          'high:goal_quality',
          'high:evaluator_quality',
          'medium:smart_criteria',
        ]);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test('should calculate correct success rates across quality buckets', () => {
      const entries: GoalCheckEntry[] = [
        // High bucket: 3 attempts, 2 successes = 66.7%
        { phase: 'goal_check', goal_quality: { score: 90 }, correlation: { success: true } },
        { phase: 'goal_check', goal_quality: { score: 87 }, correlation: { success: true } },
        { phase: 'goal_check', goal_quality: { score: 85 }, correlation: { success: false } },
        // Low bucket: 2 attempts, 0 successes = 0%
        { phase: 'goal_check', goal_quality: { score: 50 }, correlation: { success: false } },
        { phase: 'goal_check', goal_quality: { score: 30 }, correlation: { success: false } },
      ];

      const result = analyzeGoalFeedback(entries);

      const highSuccessRate = parseFloat((result.quality_buckets?.high?.success_rate as string) || '0');
      const lowSuccessRate = parseFloat((result.quality_buckets?.low?.success_rate as string) || '0');

      expect(highSuccessRate).toBeCloseTo(66.7, 0);
      expect(lowSuccessRate).toBe(0);
    });

    test('should handle verdicts that sometimes match correlation', () => {
      const entries: GoalCheckEntry[] = [
        {
          phase: 'goal_check',
          goal_quality: { score: 85 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 85 },
          correlation: { success: true },
          goal_check_verdict: { met: true },
        },
        {
          phase: 'goal_check',
          goal_quality: { score: 85 },
          correlation: { success: false },
          goal_check_verdict: { met: true }, // Verdict wrong!
        },
      ];

      const result = analyzeCorrelations(entries);
      const verdictNote = result.find((n: string) => n.includes('verdict_met_rate'));
      expect(verdictNote).toBeUndefined(); // Only reports when > 0.85 accuracy
    });

    test('should accumulate attempt counts across buckets', () => {
      const entries: GoalCheckEntry[] = [
        { phase: 'goal_check', goal_quality: { score: 90 }, outcomes: { coding_attempts: 1 } },
        { phase: 'goal_check', goal_quality: { score: 88 }, outcomes: { coding_attempts: 2 } },
        { phase: 'goal_check', goal_quality: { score: 50 }, outcomes: { coding_attempts: 5 } },
      ];

      const result = analyzeGoalFeedback(entries);

      const highAttempts = parseFloat((result.quality_buckets?.high?.avg_completion_attempts as string) || '0');
      const lowAttempts = parseFloat((result.quality_buckets?.low?.avg_completion_attempts as string) || '0');

      expect(highAttempts).toBeCloseTo(1.5, 0); // (1+2)/2
      expect(lowAttempts).toBe(5);
    });
  });

  // ===== Edge Cases =====
  describe('edge cases and error handling', () => {
    test('readFeedbackFile should handle large files gracefully', () => {
      const testFile = path.join(testDir, 'large.jsonl');
      const representativeScores = [95, 88, 85, 72, 60, 84, 59, 42, 0, 30];
      // 1,000 records is the meaningful threshold here: it exercises four-digit
      // JSONL parsing and bucket aggregation at a scale large enough to catch
      // truncation or off-by-one issues while keeping this as a fast unit test.
      const recordCount = 1000;
      const entries: GoalCheckEntry[] = Array.from({ length: recordCount }, (_, index) => {
        const score = representativeScores[index % representativeScores.length];
        return {
          phase: 'goal_check',
          goal_quality: {
            score,
            smart_criteria: [{ smart_score: score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low' }],
          },
          correlation: { success: score >= 60 },
          goal_check_verdict: {
            met: score >= 60,
            confidence: score >= 85 ? 'high' : score >= 60 ? 'medium' : 'low',
            evidenceCount: (index % 5) + 1,
            missingCount: index % 3,
          },
          outcomes: { coding_attempts: (index % 4) + 1 },
        };
      });
      fs.writeFileSync(testFile, entries.map((e) => JSON.stringify(e)).join('\n'));

      const result = readFeedbackFile(testFile);
      const analysis = analyzeGoalFeedback(result);

      expect(result).toHaveLength(recordCount);
      expect(result[0]).toEqual(entries[0]);
      expect(result[recordCount - 1]).toEqual(entries[recordCount - 1]);
      expect(result[0].goal_quality?.score).toBe(95);
      expect(result[recordCount - 1].goal_quality?.score).toBe(30);
      expect(result[0].goal_quality?.smart_criteria?.[0].smart_score).toBe('high');
      expect(result[recordCount - 1].goal_quality?.smart_criteria?.[0].smart_score).toBe('low');

      expect(analysis.total_runs).toBe(recordCount);
      expect(analysis.quality_buckets?.high).toEqual(
        expect.objectContaining({ count: 300, success_rate: '100.0', avg_quality_score: '89.3' })
      );
      expect(analysis.quality_buckets?.medium).toEqual(
        expect.objectContaining({ count: 300, success_rate: '100.0', avg_quality_score: '72.0' })
      );
      expect(analysis.quality_buckets?.low).toEqual(
        expect.objectContaining({ count: 400, success_rate: '0.0', avg_quality_score: '32.8' })
      );
      expect(analysis.smart_analysis).toEqual(
        expect.objectContaining({
          total_criteria: recordCount,
          distribution: { high: '30.0%', medium: '30.0%', low: '40.0%' },
        })
      );
    });

    test('analyzeGoalFeedback should handle undefined fields gracefully', () => {
      const entries: GoalCheckEntry[] = [
        { phase: 'goal_check' }, // Missing goal_quality
        { phase: 'goal_check', goal_quality: {} }, // Empty goal_quality
        { phase: 'goal_check', goal_quality: { score: 75 }, correlation: {} }, // Missing correlation.success
      ];

      const result = analyzeGoalFeedback(entries);
      expect(result.total_runs).toBe(3);
      expect(result.quality_buckets?.low?.count).toBeGreaterThan(0); // Score defaults to 0
    });

    test('analyzeCorrelations should handle zero-division gracefully', () => {
      const entries: GoalCheckEntry[] = []; // Empty array
      const result = analyzeCorrelations(entries);
      expect(result).toEqual(expect.any(Array));
      expect(result[result.length - 1]).toMatch(/Evaluator effort/); // Last note shows effort with zeros
    });

    test('generateRecommendations should handle undefined stats fields', () => {
      const stats = {
        high: undefined,
        medium: { count: 10, success_rate: '50.0' },
      };
      const correlationNotes: string[] = [];
      const smartAnalysis = { distribution: {} };

      const result = generateRecommendations(stats, correlationNotes, smartAnalysis);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
