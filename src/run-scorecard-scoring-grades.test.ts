import { assignGrade } from './run-scorecard-scoring-grades';

describe('run-scorecard-scoring-grades', () => {
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

    it('handles boundary conditions precisely', () => {
      expect(assignGrade(89.9)).toBe('B');
      expect(assignGrade(90.0)).toBe('A');
      expect(assignGrade(79.9)).toBe('C');
      expect(assignGrade(80.0)).toBe('B');
    });

    it('handles negative and out-of-range scores', () => {
      expect(assignGrade(-10)).toBe('F');
      expect(assignGrade(101)).toBe('A');
      expect(assignGrade(1000)).toBe('A');
    });
  });
});
