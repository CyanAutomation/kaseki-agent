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
  });
});
