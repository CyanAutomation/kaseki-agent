import type { AggregateBucket, RunEfficiencyEvidence } from './types';

export function emptyAggregate(taskClass: string, model: string): AggregateBucket {
  return { taskClass, model, samples: 0, phases: {} };
}

export function updateAggregate(bucket: AggregateBucket, run: RunEfficiencyEvidence): AggregateBucket {
  const next: AggregateBucket = JSON.parse(JSON.stringify(bucket)) as AggregateBucket;
  next.samples += 1;
  for (const phase of run.phases) {
    const current = next.phases[phase.phase] ?? { samples: 0, usefulSamples: 0, repairSamples: 0, tokens: 0, elapsedMs: 0, calls: 0, estimatedCostUsd: 0 };
    current.samples += 1;
    current.tokens += Math.max(0, phase.tokens);
    current.elapsedMs += Math.max(0, phase.elapsedMs);
    current.calls += Math.max(0, phase.calls ?? 1);
    current.estimatedCostUsd += Math.max(0, phase.estimatedCostUsd ?? 0);
    const useful = (phase.usefulChanges ?? 0) > 0 || (phase.requirementsCompleted ?? 0) > 0;
    if (useful) current.usefulSamples += 1;
    if (phase.phase === 'goal-check' && run.goalCheckRepairRequired) current.repairSamples += 1;
    next.phases[phase.phase] = current;
  }
  return next;
}
