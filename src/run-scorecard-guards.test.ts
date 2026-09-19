/**
 * Unit tests for run-scorecard-guards.ts
 * Direct test coverage for type guard utility functions
 * These guards are used by 12+ files; direct tests reduce fragility in consumers
 */

import { describe, expect, it } from '@jest/globals';
import { object, number, bool, stagePhase } from './run-scorecard-guards';

describe('run-scorecard-guards', () => {
  describe('object() guard', () => {
    it('accepts plain objects', () => {
      expect(object({ key: 'value' })).toEqual({ key: 'value' });
      expect(object({})).toEqual({});
      expect(object({ nested: { deep: true } })).toEqual({ nested: { deep: true } });
    });

    it('accepts objects with various value types', () => {
      const obj = { str: 'text', num: 42, bool: true, nil: null, undef: undefined };
      expect(object(obj)).toEqual(obj);
    });

    it('rejects null', () => {
      expect(object(null)).toBeUndefined();
    });

    it('rejects arrays', () => {
      expect(object([])).toBeUndefined();
      expect(object([1, 2, 3])).toBeUndefined();
      expect(object(['a', 'b'])).toBeUndefined();
    });

    it('rejects primitives', () => {
      expect(object(42)).toBeUndefined();
      expect(object('string')).toBeUndefined();
      expect(object(true)).toBeUndefined();
      expect(object(false)).toBeUndefined();
      expect(object(undefined)).toBeUndefined();
    });

    it('rejects functions and symbols', () => {
      expect(object(() => {})).toBeUndefined();
      expect(object(Symbol('test'))).toBeUndefined();
    });

    it('handles edge case: Date objects (are objects but not plain)', () => {
      const date = new Date();
      // Date is an object, so it passes the guard
      expect(object(date)).toEqual(date);
    });

    it('handles edge case: classes and custom objects', () => {
      class CustomClass {
        value = 42;
      }
      const instance = new CustomClass();
      expect(object(instance)).toEqual(instance);
    });
  });

  describe('number() guard', () => {
    it('accepts valid finite numbers', () => {
      expect(number(0)).toBe(0);
      expect(number(1)).toBe(1);
      expect(number(-1)).toBe(-1);
      expect(number(42.5)).toBe(42.5);
      expect(number(-99.99)).toBe(-99.99);
      expect(number(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
      expect(number(Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    });

    it('rejects infinity', () => {
      expect(number(Infinity)).toBeUndefined();
      expect(number(-Infinity)).toBeUndefined();
    });

    it('rejects NaN', () => {
      expect(number(NaN)).toBeUndefined();
    });

    it('rejects non-numeric types', () => {
      expect(number('42')).toBeUndefined();
      expect(number(null)).toBeUndefined();
      expect(number(undefined)).toBeUndefined();
      expect(number(true)).toBeUndefined();
      expect(number(false)).toBeUndefined();
      expect(number([42])).toBeUndefined();
      expect(number({ value: 42 })).toBeUndefined();
    });

    it('uses Number.isFinite() for validation', () => {
      // Verify the guard uses isFinite
      expect(number(Number.POSITIVE_INFINITY)).toBeUndefined();
      expect(number(Number.NEGATIVE_INFINITY)).toBeUndefined();
    });
  });

  describe('bool() guard', () => {
    it('accepts true and false', () => {
      expect(bool(true)).toBe(true);
      expect(bool(false)).toBe(false);
    });

    it('rejects truthy non-boolean values', () => {
      expect(bool(1)).toBeUndefined();
      expect(bool('true')).toBeUndefined();
      expect(bool({})).toBeUndefined();
      expect(bool([])).toBeUndefined();
    });

    it('rejects falsy non-boolean values', () => {
      expect(bool(0)).toBeUndefined();
      expect(bool('')).toBeUndefined();
      expect(bool(null)).toBeUndefined();
      expect(bool(undefined)).toBeUndefined();
      expect(bool(NaN)).toBeUndefined();
    });

    it('rejects number-like booleans', () => {
      // In JavaScript, 1 is truthy but not boolean
      expect(bool(1 === 1)).toBe(true); // Result of comparison is boolean
      expect(bool(1)).toBeUndefined(); // Raw number is not boolean
    });
  });

  describe('stagePhase() guard', () => {
    it('recognizes goal_setting patterns', () => {
      expect(stagePhase('Goal Setting')).toBe('goal_setting');
      expect(stagePhase('goal setting')).toBe('goal_setting');
      expect(stagePhase('GOAL SETTING')).toBe('goal_setting');
      expect(stagePhase('goal-setting')).toBe('goal_setting');
      expect(stagePhase('goal.setting')).toBe('goal_setting');
    });

    it('recognizes scouting patterns', () => {
      expect(stagePhase('Scouting')).toBe('scouting');
      expect(stagePhase('scouting')).toBe('scouting');
      expect(stagePhase('SCOUTING')).toBe('scouting');
      expect(stagePhase('scouting phase')).toBe('scouting');
    });

    it('recognizes coding patterns', () => {
      expect(stagePhase('Coding')).toBe('coding');
      expect(stagePhase('coding')).toBe('coding');
      expect(stagePhase('CODING')).toBe('coding');
      expect(stagePhase('Pi Coding Agent')).toBe('coding');
      expect(stagePhase('pi coding')).toBe('coding');
    });

    it('recognizes goal_check patterns', () => {
      expect(stagePhase('Goal Check')).toBe('goal_check');
      expect(stagePhase('goal check')).toBe('goal_check');
      expect(stagePhase('GOAL CHECK')).toBe('goal_check');
      expect(stagePhase('goal-check')).toBe('goal_check');
    });

    it('recognizes run_evaluation patterns', () => {
      expect(stagePhase('Run Evaluation')).toBe('run_evaluation');
      expect(stagePhase('run evaluation')).toBe('run_evaluation');
      expect(stagePhase('RUN EVALUATION')).toBe('run_evaluation');
      expect(stagePhase('run.evaluation')).toBe('run_evaluation');
    });

    it('recognizes validation patterns', () => {
      expect(stagePhase('Validation')).toBe('validation');
      expect(stagePhase('validation')).toBe('validation');
      expect(stagePhase('VALIDATION')).toBe('validation');
      expect(stagePhase('validation phase')).toBe('validation');
    });

    it('returns undefined for non-matching strings', () => {
      expect(stagePhase('unknown')).toBeUndefined();
      expect(stagePhase('build')).toBeUndefined();
      expect(stagePhase('test')).toBeUndefined();
      expect(stagePhase('deploy')).toBeUndefined();
    });

    it('returns undefined for empty strings and null-like values', () => {
      expect(stagePhase('')).toBeUndefined();
      expect(stagePhase(null)).toBeUndefined();
      expect(stagePhase(undefined)).toBeUndefined();
    });

    it('handles whitespace and case-insensitivity', () => {
      expect(stagePhase('  Goal Setting  ')).toBe('goal_setting');
      expect(stagePhase('GOAL SETTING')).toBe('goal_setting');
      expect(stagePhase('\tScouting\n')).toBe('scouting');
    });

    it('prioritizes first matching pattern when multiple might apply', () => {
      // 'coding' pattern should match before 'validation'
      // Test to ensure deterministic behavior
      expect(stagePhase('coding validation')).toBe('coding');
    });

    it('converts non-string input to string before matching', () => {
      expect(stagePhase(42)).toBeUndefined();
      expect(stagePhase({ stage: 'Goal Setting' })).toBeUndefined();
    });

    it('handles mixed patterns with separators', () => {
      expect(stagePhase('goal/setting')).toBe('goal_setting');
      expect(stagePhase('run-evaluation')).toBe('run_evaluation');
      expect(stagePhase('goal_check')).toBe('goal_check');
    });
  });

  describe('Integration scenarios (guards used together)', () => {
    it('handles object with number and boolean fields', () => {
      const data = object({
        count: 42,
        enabled: true,
        stage: 'Goal Setting',
      });
      expect(data).toBeDefined();
      expect(number(data?.count)).toBe(42);
      expect(bool(data?.enabled)).toBe(true);
      expect(stagePhase(data?.stage)).toBe('goal_setting');
    });

    it('handles missing nested values gracefully', () => {
      const data = object({ metadata: null, count: 'not-a-number' });
      expect(object(data?.metadata)).toBeUndefined();
      expect(number(data?.count)).toBeUndefined();
    });

    it('safely extracts from loosely-typed artifacts', () => {
      const artifact: unknown = {
        exit_code: 0,
        is_success: true,
        stage: 'Validation',
        description: 'not a number',
      };

      const obj = object(artifact);
      expect(obj).toBeDefined();
      expect(number(obj?.exit_code)).toBe(0);
      expect(bool(obj?.is_success)).toBe(true);
      expect(stagePhase(obj?.stage)).toBe('validation');
      expect(number(obj?.description)).toBeUndefined();
    });
  });

  describe('Consumer compatibility (patterns used by 12+ files)', () => {
    it('supports the pattern used by run-scorecard-evidence-status.ts', () => {
      // Pattern: metadata[key] -> number() -> statusFrom()
      const metadata = { exit_code: 0, run_status: 'completed' };
      expect(number(metadata.exit_code)).toBe(0);
      expect(object({ exit_code: 0 })).toBeDefined();
    });

    it('supports the pattern used by evidence collectors', () => {
      // Pattern: snapshot.json['file.json'] -> object() -> check properties
      const snapshot = {
        json: {
          'metadata.json': { count: 5, enabled: true },
          'missing.json': undefined,
        },
      };
      const meta = object(snapshot.json['metadata.json']);
      expect(meta).toBeDefined();
      expect(number(meta?.count)).toBe(5);
      expect(bool(meta?.enabled)).toBe(true);
      const missing = object(snapshot.json['missing.json']);
      expect(missing).toBeUndefined();
    });

    it('supports the pattern used by phase detection', () => {
      // Pattern: stage string -> stagePhase() -> phase key lookup
      const stages = ['Goal Setting', 'Scouting', 'Pi Coding Agent', 'Validation'];
      const phases = stages.map(stagePhase).filter(Boolean);
      expect(phases).toEqual(['goal_setting', 'scouting', 'coding', 'validation']);
    });
  });
});
