import type { ClassificationAnswer } from './types/openrouter-decisions';
import type { RunEvaluationFailureDiagnosis } from './jev-workflow-helpers';
import { latestValidationResults } from './validation-results';

type JsonObject = Record<string, unknown>;

export interface RunEvaluationFacts {
  metadata: JsonObject;
  failure: JsonObject;
  goalSetting: JsonObject;
  scouting: JsonObject;
  goalCheck: JsonObject;
  validation: string;
  validationSources: string[];
  changedFiles: string;
  diff: string;
  taskMode: string;
  presentSources: string[];
  stageDurations: Record<string, number>;
  timingManifest?: JsonObject;
  cacheMetrics?: unknown[];
}

export interface RunEvaluationClassification {
  overallAssessment: string;
  reviewerConfidence: string;
  taskCompletionScore: number;
  failureDiagnosis?: RunEvaluationFailureDiagnosis;
}

export interface RunEvaluationMetadata {
  stage: 'run evaluation';
  responseTime: number;
  usage: Record<string, unknown>;
  answers?: Record<string, ClassificationAnswer>;
}

export interface RunEvaluationArtifact extends JsonObject {
  overall_assessment: string;
  reviewer_confidence: string;
  task_completion_score: number;
  summary: string;
  human_review_focus: string[];
  stage_value: Array<{ stage: string; value: string; reason: string }>;
  evidence_sources_inspected: string[];
  contradictions: Array<{ sources: string[]; description: string }>;
  confidence_calibration: { objective_outcome: string; status: 'unassessed'; calibrated: false; reason: string };
  phase_scorecard: Record<string, Record<string, unknown>>;
  efficiency_findings: string[];
  kaseki_improvement_opportunities: Array<{ category: string; priority: string; suggestion: string }>;
  pr_summary: string;
  pr_changes: string[];
  warnings: string[];
  evaluation: RunEvaluationMetadata;
  failure_diagnosis?: { cause: string; recommended_action: string; confidence: number; cause_probabilities: Record<string, number>; action_probabilities: Record<string, number> };
}

type StageName = 'goal-setting' | 'scouting' | 'coding' | 'validation' | 'goal-check' | 'run-evaluation';
type StageValue = 'high' | 'medium' | 'low' | 'unknown';

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function fileCount(value: string): number {
  return new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)).size;
}

function fallbackGoal(facts: RunEvaluationFacts): boolean {
  return facts.metadata.goal_setting_fallback_used === true
    || facts.goalSetting.fallback === true;
}

function fallbackScouting(facts: RunEvaluationFacts): boolean {
  return facts.metadata.scouting_fallback_used === true
    || facts.scouting.fallback === true
    || Boolean(string(facts.scouting.fallback_reason));
}

function validationRows(facts: RunEvaluationFacts): JsonObject[] {
  const phases = facts.metadata.phases && typeof facts.metadata.phases === 'object'
    ? facts.metadata.phases as JsonObject : {};
  const validation = phases.validation && typeof phases.validation === 'object'
    ? phases.validation as JsonObject : {};
  const phaseRows = Array.isArray(validation.results) ? validation.results : [];
  const manifestRows = Array.isArray(facts.timingManifest?.validation_timings) ? facts.timingManifest.validation_timings : [];
  return latestValidationResults(phaseRows, manifestRows) as JsonObject[];
}

function executedValidationRows(facts: RunEvaluationFacts): JsonObject[] {
  return validationRows(facts).filter((row) => row.status !== 'skipped'
    && !String(row.details ?? row.detail ?? '').includes('skipped=missing_npm_script'));
}

function commandsAttempted(facts: RunEvaluationFacts): number {
  const phases = facts.metadata.phases && typeof facts.metadata.phases === 'object'
    ? facts.metadata.phases as JsonObject : {};
  const validation = phases.validation && typeof phases.validation === 'object'
    ? phases.validation as JsonObject : {};
  const attemptedRows = executedValidationRows(facts).length;
  return Math.max(
    number(facts.metadata.validation_commands_attempted) ?? 0,
    number(validation.commands_attempted) ?? 0,
    attemptedRows,
  );
}

function validationStatus(facts: RunEvaluationFacts): 'passed' | 'failed' | 'not_run' | 'unknown' {
  const attempted = commandsAttempted(facts);
  const rows = executedValidationRows(facts);
  if (rows.length > 0) {
    if (rows.some((row) => row.status === 'failed' || (number(row.exit_code) !== undefined && number(row.exit_code) !== 0))) return 'failed';
    if (rows.every((row) => row.status === 'passed' || number(row.exit_code) === 0)) return 'passed';
    return 'unknown';
  }
  if (attempted === 0) return 'not_run';
  const exitCode = number(facts.metadata.validation_exit_code ?? (facts.failure as JsonObject).validation_exit_code);
  if (exitCode !== undefined) return exitCode === 0 ? 'passed' : 'failed';
  if (/(?:^|\s)(?:failed|error|exit code [1-9]\d*)/im.test(facts.validation)) return 'failed';
  if (/(?:^|\s)(?:passed|exit_code=0)(?:\s|$)/im.test(facts.validation)) return 'passed';
  return 'unknown';
}

function isFailedRun(facts: RunEvaluationFacts): boolean {
  const exitCode = number(facts.metadata.exit_code ?? facts.failure.exit_code ?? facts.failure.exitCode);
  return exitCode !== undefined && exitCode !== 0;
}

function stageValueFor(outcome: string, fallback = false): StageValue {
  if (outcome === 'not_reached' || outcome === 'not_run' || outcome === 'missing' || outcome === 'unknown') return 'unknown';
  if (outcome === 'failed' || fallback) return 'low';
  return 'high';
}

function stageReason(stage: string, outcome: string, evidence: string): string {
  return `${stage} ${outcome.replace(/_/g, ' ')}; evidence: ${evidence || 'no durable evidence recorded'}.`;
}

export function buildRunEvaluationEvidenceSources(input: { presentSources: string[]; validationSources: string[] }): string[] {
  const known = new Set(input.presentSources);
  return [...new Set([...input.presentSources, ...input.validationSources])].filter(source => known.has(source));
}

interface RunEvaluationPhase {
  stage: StageName;
  outcome: string;
  fallback?: boolean;
  evidence: string;
}

interface RunEvaluationState {
  changed: number;
  hasDiff: boolean;
  goalFallback: boolean;
  scoutingFallback: boolean;
  validation: ReturnType<typeof validationStatus>;
  goalOutcome: string;
  scoutingOutcome: string;
  codingOutcome: string;
  goalCheckOutcome: string;
  failedRun: boolean;
  incompletePatch: boolean;
  contradictions: RunEvaluationArtifact['contradictions'];
  phases: RunEvaluationPhase[];
}

function artifactOutcome(present: boolean, fallback: boolean): string {
  if (!present) return 'missing';
  return fallback ? 'completed_with_fallback' : 'succeeded';
}

function codingOutcome(facts: RunEvaluationFacts, hasDiff: boolean): string {
  return hasDiff || facts.taskMode === 'inspect' || facts.metadata.no_change_accepted === true
    ? 'succeeded'
    : 'failed';
}

function goalCheckOutcome(goalCheck: JsonObject): string {
  if (typeof goalCheck.met !== 'boolean') return 'not_reached';
  return goalCheck.met ? 'succeeded' : 'failed';
}

function evaluationContradictions(
  facts: RunEvaluationFacts,
  validation: RunEvaluationState['validation'],
  incompletePatch: boolean,
): RunEvaluationArtifact['contradictions'] {
  const contradictions: RunEvaluationArtifact['contradictions'] = [];
  if (incompletePatch) {
    contradictions.push({
      sources: facts.goalCheck.met === true ? ['goal-check.json', 'git.diff'] : ['metadata.json', 'git.diff'],
      description: facts.goalCheck.met === true
        ? 'The goal check passed although patch mode produced no durable diff.'
        : 'Patch mode ended without a durable diff or an accepted no-change outcome.',
    });
  }
  if (validation === 'not_run' && number(facts.metadata.validation_exit_code) === 0) {
    contradictions.push({
      sources: ['metadata.json', ...facts.validationSources],
      description: 'Validation has a zero exit code but no validation commands were recorded; this does not establish a pass.',
    });
  }
  return contradictions;
}

function evaluationPhases(input: {
  facts: RunEvaluationFacts;
  goalOutcome: string;
  scoutingOutcome: string;
  codingOutcome: string;
  validation: RunEvaluationState['validation'];
  goalCheckOutcome: string;
  goalFallback: boolean;
  scoutingFallback: boolean;
}): RunEvaluationPhase[] {
  const { facts, goalOutcome, scoutingOutcome, codingOutcome, validation, goalCheckOutcome, goalFallback, scoutingFallback } = input;
  return [
    { stage: 'goal-setting', outcome: goalOutcome, fallback: goalFallback, evidence: facts.presentSources.includes('goal-setting.json') ? 'goal-setting.json' : '' },
    { stage: 'scouting', outcome: scoutingOutcome, fallback: scoutingFallback, evidence: facts.presentSources.includes('scouting.json') ? 'scouting.json' : '' },
    { stage: 'coding', outcome: codingOutcome, evidence: facts.presentSources.filter(source => ['git.diff', 'changed-files.txt'].includes(source)).join(', ') },
    { stage: 'validation', outcome: validation, evidence: facts.validationSources.join(', ') },
    { stage: 'goal-check', outcome: goalCheckOutcome, evidence: facts.presentSources.includes('goal-check.json') ? 'goal-check.json' : '' },
    { stage: 'run-evaluation', outcome: 'succeeded', evidence: 'run evaluation result' },
  ];
}

function resolveRunEvaluationState(facts: RunEvaluationFacts): RunEvaluationState {
  const changed = fileCount(facts.changedFiles);
  const hasDiff = Boolean(facts.diff.trim());
  const goalFallback = fallbackGoal(facts);
  const scoutingFallback = fallbackScouting(facts);
  const validation = validationStatus(facts);
  const goalOutcome = artifactOutcome(Object.keys(facts.goalSetting).length > 0, goalFallback);
  const scoutingOutcome = artifactOutcome(Object.keys(facts.scouting).length > 0, scoutingFallback);
  const coding = codingOutcome(facts, hasDiff);
  const goalCheck = goalCheckOutcome(facts.goalCheck);
  const failedRun = isFailedRun(facts);
  const incompletePatch = facts.taskMode === 'patch' && !hasDiff && facts.metadata.no_change_accepted !== true;
  const contradictions = evaluationContradictions(facts, validation, incompletePatch);
  const phases = evaluationPhases({
    facts,
    goalOutcome,
    scoutingOutcome,
    codingOutcome: coding,
    validation,
    goalCheckOutcome: goalCheck,
    goalFallback,
    scoutingFallback,
  });

  return {
    changed,
    hasDiff,
    goalFallback,
    scoutingFallback,
    validation,
    goalOutcome,
    scoutingOutcome,
    codingOutcome: coding,
    goalCheckOutcome: goalCheck,
    failedRun,
    incompletePatch,
    contradictions,
    phases,
  };
}

function buildPhaseScorecard(facts: RunEvaluationFacts, state: RunEvaluationState): Record<string, Record<string, unknown>> {
  return Object.fromEntries(state.phases.map(phase => [phase.stage, {
    outcome: phase.stage !== 'validation'
      ? phase.outcome
      : phase.outcome === 'passed' ? 'succeeded' : phase.outcome === 'failed' ? 'failed' : phase.outcome === 'not_run' ? 'not_run' : 'unknown',
    score: phase.fallback ? 35 : phase.outcome === 'succeeded' ? 100 : phase.outcome === 'failed' ? 0 : 50,
    elapsed_seconds: number(facts.stageDurations[phase.stage]),
    evidence: phase.evidence ? [phase.evidence] : [],
    ...(phase.fallback ? { fallback: true } : {}),
    ...(phase.stage === 'validation' ? { commands_attempted: commandsAttempted(facts) } : {}),
    ...(phase.stage === 'coding' ? { changed_files: state.changed, diff_present: state.hasDiff } : {}),
    ...(phase.stage === 'scouting' ? { relevant_files_identified: Array.isArray(facts.scouting.relevant_files) ? facts.scouting.relevant_files.length : 0 } : {}),
  }]));
}

function buildReviewGuidance(facts: RunEvaluationFacts, state: RunEvaluationState): {
  humanReviewFocus: string[];
  opportunities: RunEvaluationArtifact['kaseki_improvement_opportunities'];
} {
  const humanReviewFocus: string[] = [];
  const opportunities: RunEvaluationArtifact['kaseki_improvement_opportunities'] = [];

  if (state.goalOutcome === 'missing') humanReviewFocus.push('Review the task objective because no goal-setting artifact was retained.');
  if (state.scoutingOutcome === 'missing') humanReviewFocus.push('Review repository coverage because no scouting artifact was retained.');
  if (state.goalCheckOutcome === 'not_reached') humanReviewFocus.push('Manually confirm the success criteria because no goal-check verdict is available.');
  if (state.goalCheckOutcome === 'failed') humanReviewFocus.push('Review unmet goal-check criteria and confirm the patch addresses them.');
  if (state.goalFallback) {
    humanReviewFocus.push('Review the task criteria because goal-setting used a fallback artifact.');
    opportunities.push({ category: 'goal_setting', priority: 'medium', suggestion: 'Improve goal-setting artifact recovery so task-specific success criteria survive evaluator failures.' });
  }
  if (state.scoutingFallback) {
    humanReviewFocus.push('Review changed-file coverage because the scouting fallback was used.');
    opportunities.push({ category: 'scouting', priority: 'high', suggestion: 'Reduce scouting handoff fallback frequency and retain the original agent findings when schema recovery is needed.' });
  }
  if (state.validation === 'not_run') {
    humanReviewFocus.push('Validation was not run; manually inspect the patch and run the relevant checks.');
    opportunities.push({ category: 'validation', priority: 'high', suggestion: 'Run at least one relevant validation command and preserve its final output and exit status.' });
  } else if (state.validation === 'failed') {
    humanReviewFocus.push('Review the failing validation output before accepting the patch.');
  }
  if (state.incompletePatch) {
    humanReviewFocus.push('Confirm whether a code change was required; patch mode produced no durable diff.');
    opportunities.push({ category: 'implementation', priority: 'high', suggestion: 'Ensure patch-mode tasks produce a durable diff or record an explicit, accepted no-change outcome.' });
  }
  if (state.failedRun && facts.failure.worker_error_type === 'metadata_write_invalid') {
    humanReviewFocus.push('Review stderr.log and the worker failure details because metadata serialization failed.');
    opportunities.push({ category: 'metadata', priority: 'high', suggestion: 'Keep run metadata JSON-safe and preserve the primary worker failure when writing fallback metadata.' });
  }

  return { humanReviewFocus, opportunities };
}

function collectEfficiencyFindings(facts: RunEvaluationFacts): {
  findings: string[];
  opportunities: RunEvaluationArtifact['kaseki_improvement_opportunities'];
} {
  const findings: string[] = [];
  const opportunities: RunEvaluationArtifact['kaseki_improvement_opportunities'] = [];
  for (const rawMetric of facts.cacheMetrics ?? []) {
    if (!rawMetric || typeof rawMetric !== 'object') continue;
    const metric = rawMetric as JsonObject;
    const name = string(metric.name);
    const elapsed = number(metric.elapsed_seconds);
    if (name === 'fresh_install' && elapsed !== undefined && elapsed >= 30) {
      findings.push(`Cold dependency installation took ${elapsed}s; improve cache hit rate or image seeding.`);
      opportunities.push({ category: 'dependency_cache', priority: elapsed >= 120 ? 'high' : 'medium', suggestion: 'Increase workspace or image dependency-cache hits to reduce fresh npm installs.' });
    } else if (/(?:workspace|image)_cache_restored/.test(name) && elapsed !== undefined && elapsed >= 30) {
      findings.push(`Dependency cache restoration took ${elapsed}s; inspect restore mode and filesystem copy cost.`);
      opportunities.push({ category: 'dependency_cache', priority: 'medium', suggestion: 'Tune cache restore mode and storage placement for faster dependency restores.' });
    }
  }
  return { findings, opportunities };
}

function adjustedClassification(
  classification: RunEvaluationClassification,
  state: RunEvaluationState,
  humanReviewFocus: string[],
): { assessment: string; reviewerConfidence: string; completionScore: number } {
  return {
    assessment: state.failedRun || state.incompletePatch ? 'poor' : classification.overallAssessment,
    reviewerConfidence: state.failedRun || state.incompletePatch || humanReviewFocus.length > 0
      ? 'low'
      : classification.reviewerConfidence,
    completionScore: state.failedRun || state.incompletePatch
      ? Math.min(2, classification.taskCompletionScore)
      : classification.taskCompletionScore,
  };
}

function runValidationSummary(facts: RunEvaluationFacts, state: RunEvaluationState): string {
  if (state.validation === 'not_run') return 'validation was not run';
  return `${commandsAttempted(facts)} validation commands ${state.validation}`;
}

function buildRunSummaries(
  facts: RunEvaluationFacts,
  state: RunEvaluationState,
  assessment: string,
): { summary: string } {
  const validationSummary = runValidationSummary(facts, state);
  const changeSummary = `${state.changed} changed ${state.changed === 1 ? 'file' : 'files'}`;
  const failureSummary = state.failedRun
    ? `; run failed with exit code ${facts.metadata.exit_code ?? facts.failure.exit_code ?? facts.failure.exitCode}`
    : state.incompletePatch ? '; patch mode produced no accepted change' : '';
  return {
    summary: `Run assessed ${assessment}; ${validationSummary}; ${changeSummary}${failureSummary}.`,
  };
}

function buildWarnings(state: RunEvaluationState, humanReviewFocus: string[]): string[] {
  if (state.failedRun && humanReviewFocus.length === 0) {
    humanReviewFocus.push('Review the failed phase and its durable diagnostics before accepting this run.');
  }
  return [
    ...(state.goalFallback ? ['Goal-setting used a fallback artifact.'] : []),
    ...(state.scoutingFallback ? ['Scouting used a fallback handoff.'] : []),
    ...(state.validation === 'not_run' ? ['No validation commands were executed.'] : []),
    ...(state.incompletePatch ? ['Patch mode produced no durable diff and no accepted no-change outcome.'] : []),
    ...(state.failedRun ? ['The run lifecycle ended in failure; evaluator completion is capped at 2/5.'] : []),
  ];
}

function confidenceCalibration(facts: RunEvaluationFacts, validationSummary: string): RunEvaluationArtifact['confidence_calibration'] {
  const objectiveOutcome = facts.goalCheck.met === true ? 'met' : facts.goalCheck.met === false ? 'unmet' : 'unknown';
  return {
    objective_outcome: objectiveOutcome,
    status: 'unassessed',
    calibrated: false,
    reason: `No labeled outcome data is supplied for statistical calibration. Evidence completeness is assessed separately; ${validationSummary}.`,
  };
}

function failureDiagnosis(
  classification: RunEvaluationClassification,
): RunEvaluationArtifact['failure_diagnosis'] {
  if (!classification.failureDiagnosis) return undefined;
  return {
    cause: classification.failureDiagnosis.cause,
    recommended_action: classification.failureDiagnosis.recommendedAction,
    confidence: classification.failureDiagnosis.confidence,
    cause_probabilities: classification.failureDiagnosis.causeProbabilities,
    action_probabilities: classification.failureDiagnosis.actionProbabilities,
  };
}

export function buildRunEvaluationArtifact(
  facts: RunEvaluationFacts,
  classification: RunEvaluationClassification,
  evaluation: RunEvaluationMetadata,
): RunEvaluationArtifact {
  const state = resolveRunEvaluationState(facts);
  const phaseScorecard = buildPhaseScorecard(facts, state);
  const stageValue = state.phases.map(phase => ({
    stage: phase.stage,
    value: stageValueFor(phase.outcome, phase.fallback),
    reason: stageReason(phase.stage, phase.outcome, phase.evidence),
  }));

  const { humanReviewFocus, opportunities } = buildReviewGuidance(facts, state);
  const efficiency = collectEfficiencyFindings(facts);
  opportunities.push(...efficiency.opportunities);
  const warnings = buildWarnings(state, humanReviewFocus);
  const { assessment, reviewerConfidence, completionScore } = adjustedClassification(classification, state, humanReviewFocus);
  const evidenceSources = buildRunEvaluationEvidenceSources({ presentSources: facts.presentSources, validationSources: facts.validationSources });
  const validationSummary = runValidationSummary(facts, state);
  const summaries = buildRunSummaries(facts, state, assessment);
  const diagnosis = failureDiagnosis(classification);

  return {
    overall_assessment: assessment,
    reviewer_confidence: reviewerConfidence,
    task_completion_score: completionScore,
    summary: summaries.summary,
    human_review_focus: humanReviewFocus,
    stage_value: stageValue,
    evidence_sources_inspected: evidenceSources,
    contradictions: state.contradictions,
    confidence_calibration: confidenceCalibration(facts, validationSummary),
    phase_scorecard: phaseScorecard,
    efficiency_findings: efficiency.findings,
    kaseki_improvement_opportunities: opportunities,
    // The typed evaluator classifies run quality but does not generate change
    // prose. The coding agent writes reviewer-ready prose to agent-review.md;
    // leave these fields empty rather than mislabeling run telemetry as a PR
    // description when that artifact is missing.
    pr_summary: '',
    pr_changes: [],
    warnings,
    evaluation,
    ...(diagnosis ? { failure_diagnosis: diagnosis } : {}),
  };
}
