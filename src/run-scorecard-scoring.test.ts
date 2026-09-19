import { assignGrade, calculateCoverage } from './run-scorecard-scoring';
import type { Evidence } from './run-scorecard-evidence-types';

describe('run-scorecard-scoring', () => {
  describe('assignGrade', () => {
    it('returns A for scores >= 90', () => {
      expect(assignGrade(90)).toBe('A');
      expect(assignGrade(95)).toBe('A');
      expect(assignGrade(100)).toBe('A');
    });

    it('returns B for scores 80-89', () => {
      expect(assignGrade(80)).toBe('B');
      expect(assignGrade(85)).toBe('B');
      expect(assignGrade(89)).toBe('B');
    });

    it('returns C for scores 70-79', () => {
      expect(assignGrade(70)).toBe('C');
      expect(assignGrade(75)).toBe('C');
      expect(assignGrade(79)).toBe('C');
    });

    it('returns D for scores 60-69', () => {
      expect(assignGrade(60)).toBe('D');
      expect(assignGrade(65)).toBe('D');
      expect(assignGrade(69)).toBe('D');
    });

    it('returns F for scores < 60', () => {
      expect(assignGrade(59)).toBe('F');
      expect(assignGrade(50)).toBe('F');
      expect(assignGrade(0)).toBe('F');
    });

    it('handles edge cases at grade boundaries', () => {
      expect(assignGrade(89.9)).toBe('B');
      expect(assignGrade(90.0)).toBe('A');
      expect(assignGrade(59.9)).toBe('F');
      expect(assignGrade(60.0)).toBe('D');
    });

    it('handles negative scores (grades F)', () => {
      expect(assignGrade(-10)).toBe('F');
      expect(assignGrade(-100)).toBe('F');
    });

    it('handles scores > 100 (grades A)', () => {
      expect(assignGrade(101)).toBe('A');
      expect(assignGrade(200)).toBe('A');
    });
  });

  describe('calculateCoverage', () => {
    const minimalEvidence: Evidence = {
      metadata: {},
      status: 'completed',
      tokenUsage: { input: 0, output: 0, cache_creation: 0, cache_read: 0, completeness: 'complete' },
      phaseTokens: {},
      unknownTokenRequests: 0,
      retries: 0,
      phaseRetries: {},
      phaseDurationsMs: {},
      phaseReached: {},
      phaseFailures: {},
      validation: 'unknown',
      quality: 'unknown',
      goalCheckAvailable: false,
      goalCheckFailed: false,
      noChangeAccepted: false,
      changedFiles: 0,
      diffBytes: 0,
      evaluatorAvailable: false,
      present: [],
    };

    it('reports all 8 fields as possible', () => {
      const coverage = calculateCoverage(minimalEvidence);
      expect(coverage.possible).toBe(8);
    });

    it('counts observed fields when present', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json', 'changed-files.txt'],
        elapsedSeconds: 10,
        tokens: 1000,
        validation: 'passed',
        quality: 'passed',
        goalCheckAvailable: true,
        evaluation: { met: true },
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.observed).toBe(8);
      expect(coverage.ratio).toBe(1);
    });

    it('handles partial evidence availability', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json'],
        elapsedSeconds: 5,
        tokens: 500,
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.observed).toBe(3); // metadata, timings, tokens
      expect(coverage.possible).toBe(8);
      expect(coverage.ratio).toBeCloseTo(0.375, 2);
    });

    it('includes missing fields in missing array', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json'],
        validation: 'passed',
        quality: 'passed',
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.missing).toContain('timings');
      expect(coverage.missing).toContain('tokens');
      expect(coverage.missing).toContain('goal check');
      expect(coverage.missing).toContain('changes');
      expect(coverage.missing).toContain('evaluation');
    });

    it('counts git.diff as changes evidence', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['git.diff'],
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.missing).not.toContain('changes');
    });

    it('handles multiple validation/quality states', () => {
      const passed: Evidence = {
        ...minimalEvidence,
        validation: 'passed',
        quality: 'passed',
      };
      const failed: Evidence = {
        ...minimalEvidence,
        validation: 'failed',
        quality: 'failed',
      };
      const unknown: Evidence = minimalEvidence;

      expect(calculateCoverage(passed).missing).not.toContain('validation');
      expect(calculateCoverage(passed).missing).not.toContain('quality gates');
      expect(calculateCoverage(failed).missing).not.toContain('validation');
      expect(calculateCoverage(failed).missing).not.toContain('quality gates');
      expect(calculateCoverage(unknown).missing).toContain('validation');
      expect(calculateCoverage(unknown).missing).toContain('quality gates');
    });

    it('ratio is capped at 1.0', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json', 'changed-files.txt'],
        elapsedSeconds: 10,
        tokens: 1000,
        validation: 'passed',
        quality: 'passed',
        goalCheckAvailable: true,
        evaluation: { met: true },
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.ratio).toBeLessThanOrEqual(1);
    });

    it('ratio precision is to 3 decimal places', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json'],
        elapsedSeconds: 10,
        tokens: 1000,
      };
      const coverage = calculateCoverage(evidence);
      // 3 out of 8 = 0.375
      expect(coverage.ratio.toString()).toMatch(/^\d+\.\d{3}$/);
    });

    it('handles all evidence categories present', () => {
      const fullEvidence: Evidence = {
        ...minimalEvidence,
        present: ['metadata.json', 'changed-files.txt', 'git.diff'],
        elapsedSeconds: 100,
        tokens: 5000,
        validation: 'passed',
        quality: 'passed',
        goalCheckAvailable: true,
        evaluation: { score: 95 },
      };
      const coverage = calculateCoverage(fullEvidence);
      expect(coverage.observed).toBe(8);
      expect(coverage.missing).toHaveLength(0);
      expect(coverage.ratio).toBe(1);
    });

    it('counts tokens as present when defined, even if 0', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        tokens: 0,
      };
      const coverage = calculateCoverage(evidence);
      // tokens is defined (even at 0), so it counts as present
      expect(coverage.missing).not.toContain('tokens');
    });

    it('counts tokens as missing when undefined', () => {
      const evidence: Evidence = {
        ...minimalEvidence,
        tokens: undefined,
      };
      const coverage = calculateCoverage(evidence);
      expect(coverage.missing).toContain('tokens');
    });
  });
});
