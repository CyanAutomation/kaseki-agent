/**
 * Tests for Progress Tracker
 * 
 * Tracks startup event counts and completion percentages
 */

import { ProgressTracker } from './progress-tracker';

describe('Progress Tracker', () => {
  describe('initialization', () => {
    it('should initialize with zero progress', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 5,
        'preflight': 7,
        'validation': 3,
      });

      expect(tracker.getTotalPhases()).toBe(3);
      expect(tracker.getTotalSteps()).toBe(15);
      expect(tracker.getProgress()).toBe(0);
    });
  });

  describe('progress tracking', () => {
    it('should increment completed steps', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 5,
        'preflight': 7,
      });

      tracker.completeStep('bootstrap');
      expect(tracker.getCompletedSteps()).toBe(1);

      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      expect(tracker.getCompletedSteps()).toBe(3);
    });

    it('should calculate progress percentage', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 10,
      });

      tracker.completeStep('bootstrap');
      expect(tracker.getProgress()).toBe(10);

      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      expect(tracker.getProgress()).toBe(50);

      for (let i = 0; i < 5; i++) {
        tracker.completeStep('bootstrap');
      }
      expect(tracker.getProgress()).toBe(100);
    });

    it('should track per-phase progress', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 5,
        'preflight': 5,
      });

      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');

      expect(tracker.getPhaseProgress('bootstrap')).toBe(60);
      expect(tracker.getPhaseProgress('preflight')).toBe(0);
    });
  });

  describe('event tracking', () => {
    it('should count events per category', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 5,
      });

      tracker.recordEvent('bootstrap', 'component-init');
      tracker.recordEvent('bootstrap', 'component-init');
      tracker.recordEvent('bootstrap', 'dependency-loaded');

      const events = tracker.getEventCounts();
      expect(events['bootstrap']).toEqual({
        'component-init': 2,
        'dependency-loaded': 1,
      });
    });

    it('should provide summary statistics', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 2,
        'preflight': 2,
      });

      tracker.completeStep('bootstrap');
      tracker.completeStep('bootstrap');
      tracker.recordEvent('bootstrap', 'event');
      tracker.recordEvent('bootstrap', 'event');

      const summary = tracker.getSummary();

      expect(summary.completedSteps).toBe(2);
      expect(summary.totalSteps).toBe(4);
      expect(summary.progressPercent).toBe(50);
      expect(summary.totalEvents).toBe(2);
    });
  });

  describe('milestone tracking', () => {
    it('should track milestone completion', () => {
      const tracker = new ProgressTracker({
        'bootstrap': 5,
      });

      tracker.reachMilestone('bootstrap-started');
      expect(tracker.getMilestones()).toContain('bootstrap-started');

      tracker.reachMilestone('services-initialized');
      expect(tracker.getMilestones()).toContain('services-initialized');
    });
  });
});
