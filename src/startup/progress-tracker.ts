/**
 * Progress Tracker
 *
 * Tracks startup progress with phases, steps, events, and milestones
 * Provides completion percentages and summary statistics
 */

export interface ProgressPhaseConfig {
  [phaseName: string]: number; // Phase name to expected step count
}

export interface EventCounts {
  [phaseName: string]: Record<string, number>;
}

export interface ProgressSummary {
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  totalEvents: number;
  phaseProgress: Record<string, number>;
}

/**
 * Tracks startup progress across multiple phases
 */
export class ProgressTracker {
  private phases: ProgressPhaseConfig;
  private completedByPhase: Record<string, number> = {};
  private eventCounts: EventCounts = {};
  private milestones: Set<string> = new Set();
  private totalSteps: number;

  constructor(phases: ProgressPhaseConfig) {
    this.phases = phases;
    this.totalSteps = Object.values(phases).reduce((a, b) => a + b, 0);

    // Initialize tracking
    for (const phase of Object.keys(phases)) {
      this.completedByPhase[phase] = 0;
      this.eventCounts[phase] = {};
    }
  }

  /**
   * Mark one step as completed in a phase
   */
  completeStep(phase: string): void {
    if (phase in this.completedByPhase) {
      this.completedByPhase[phase]++;
    }
  }

  /**
   * Record an event in a phase (for categorization)
   */
  recordEvent(phase: string, eventType: string): void {
    if (phase in this.eventCounts) {
      this.eventCounts[phase][eventType] = (this.eventCounts[phase][eventType] || 0) + 1;
    }
  }

  /**
   * Mark a milestone as reached
   */
  reachMilestone(milestone: string): void {
    this.milestones.add(milestone);
  }

  /**
   * Get total number of phases
   */
  getTotalPhases(): number {
    return Object.keys(this.phases).length;
  }

  /**
   * Get total number of expected steps
   */
  getTotalSteps(): number {
    return this.totalSteps;
  }

  /**
   * Get total completed steps across all phases
   */
  getCompletedSteps(): number {
    return Object.values(this.completedByPhase).reduce((a, b) => a + b, 0);
  }

  /**
   * Get overall progress percentage (0-100)
   */
  getProgress(): number {
    if (this.totalSteps === 0) return 0;
    return Math.min(100, Math.round((this.getCompletedSteps() / this.totalSteps) * 100));
  }

  /**
   * Get progress percentage for a specific phase
   */
  getPhaseProgress(phase: string): number {
    const expectedSteps = this.phases[phase];
    if (!expectedSteps || expectedSteps === 0) return 0;

    const completed = this.completedByPhase[phase] || 0;
    return Math.min(100, Math.round((completed / expectedSteps) * 100));
  }

  /**
   * Get event counts by phase
   */
  getEventCounts(): EventCounts {
    return this.eventCounts;
  }

  /**
   * Get reached milestones
   */
  getMilestones(): string[] {
    return Array.from(this.milestones);
  }

  /**
   * Get comprehensive progress summary
   */
  getSummary(): ProgressSummary {
    const phaseProgress: Record<string, number> = {};
    for (const phase of Object.keys(this.phases)) {
      phaseProgress[phase] = this.getPhaseProgress(phase);
    }

    const totalEvents = Object.values(this.eventCounts)
      .flatMap(events => Object.values(events))
      .reduce((a, b) => a + b, 0);

    return {
      completedSteps: this.getCompletedSteps(),
      totalSteps: this.getTotalSteps(),
      progressPercent: this.getProgress(),
      totalEvents,
      phaseProgress,
    };
  }
}
