/**
 * Tests for Progress Tracker
 *
 * Focus on semantic behavior: initialization works, progress calculation is correct, milestones track.
 */

import { ProgressTracker } from './progress-tracker';

describe('Progress Tracker', () => {
  it('should calculate progress correctly for different phase maps', () => {
    // Test basic single-phase calculation
    const tracker1 = new ProgressTracker({ bootstrap: 5 });
    tracker1.completeStep('bootstrap');
    expect(tracker1.getProgress()).toBe(20); // 1/5 = 20%

    // Test multi-phase calculation
    const tracker2 = new ProgressTracker({ bootstrap: 10 });
    for (let i = 0; i < 5; i++) {
      tracker2.completeStep('bootstrap');
    }
    expect(tracker2.getProgress()).toBe(50); // 5/10 = 50%

    // Test multiple phases
    const tracker3 = new ProgressTracker({ bootstrap: 10, preflight: 5 });
    for (let i = 0; i < 10; i++) {
      const phases = ['bootstrap', 'preflight'];
      tracker3.completeStep(phases[i % 2]);
    }
    expect(tracker3.getProgress()).toBe(67); // 10/15 ≈ 67% (rounded)
  });

  it('should initialize with zero progress and track key metrics', () => {
    const tracker = new ProgressTracker({
      bootstrap: 5,
      preflight: 7,
      validation: 3,
    });

    expect(tracker.getTotalPhases()).toBe(3);
    expect(tracker.getTotalSteps()).toBe(15);
    expect(tracker.getProgress()).toBe(0);
    expect(tracker.getCompletedSteps()).toBe(0);
  });

  it('should track milestones and events', () => {
    const tracker = new ProgressTracker({ bootstrap: 5 });

    tracker.reachMilestone('bootstrap-started');
    tracker.recordEvent('bootstrap', 'component-init');
    tracker.recordEvent('bootstrap', 'component-init');

    expect(tracker.getMilestones()).toContain('bootstrap-started');
    const events = tracker.getEventCounts();
    expect(events.bootstrap?.['component-init']).toBe(2);
  });
});
