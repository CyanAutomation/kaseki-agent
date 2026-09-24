import type { ClassificationAnswer } from './types/openrouter-decisions';
import type { RunEvaluationFailureDiagnosis } from './jev-workflow-helpers';

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
  cacheMetrics?: unknown[];
}

export interface RunEvaluationClassification {
  overallAssessment: string;
  reviewerConfidence: string;
  taskCompletionScore: number;
  failureDiagnosis?: RunEvaluationFailureDiagnosis;
}

export interface RunEvaluationClassifierMetadata {
  provider: string;
  model: string;
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
  classifier: RunEvaluationClassifierMetadata;
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
    || /fallback goal.setting artifact/i.test(string(facts.goalSetting.reasoning))
    || facts.goalSetting.confidence === 'low' && !Array.isArray(facts.goalSetting.success_criteria);
}

function fallbackScouting(facts: RunEvaluationFacts): boolean {
  return facts.metadata.scouting_fallback_used === true
    || facts.scouting.fallback === true
    || Boolean(string(facts.scouting.fallback_reason));
}

function commandsAttempted(facts: RunEvaluationFacts): number {
  const phases = facts.metadata.phases && typeof facts.metadata.phases === 'object'
    ? facts.metadata.phases as JsonObject : {};
  const validation = phases.validation && typeof phases.validation === 'object'
    ? phases.validation as JsonObject : {};
  return number(facts.metadata.validation_commands_attempted ?? validation.commands_attempted) ?? 0;
}

function validationStatus(facts: RunEvaluationFacts): 'passed' | 'failed' | 'not_run' {
  const attempted = commandsAttempted(facts);
  if (attempted === 0) return 'not_run';
  const exitCode = number(facts.metadata.validation_exit_code ?? (facts.failure as JsonObject).validation_exit_code);
  if (exitCode !== undefined) return exitCode === 0 ? 'passed' : 'failed';
  return /(?:^|\s)(?:failed|error|exit code [1-9]\d*)/im.test(facts.validation) ? 'failed' : 'passed';
}

function isFailedRun(facts: RunEvaluationFacts): boolean {
  const exitCode = number(facts.metadata.exit_code ?? facts.failure.exit_code ?? facts.failure.exitCode);
  return exitCode !== undefined && exitCode !== 0;
}

function stageValueFor(outcome: string, fallback = false): StageValue {
  if (outcome === 'not_reached' || outcome === 'not_run' || outcome === 'missing') return 'unknown';
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

export function buildRunEvaluationArtifact(
  facts: RunEvaluationFacts,
  classification: RunEvaluationClassification,
  classifier: RunEvaluationClassifierMetadata,
): RunEvaluationArtifact {
  const changed = fileCount(facts.changedFiles);
  const hasDiff = Boolean(facts.diff.trim());
  const goalFallback = fallbackGoal(facts);
  const scoutingFallback = fallbackScouting(facts);
  const validation = validationStatus(facts);
  const goalOutcome = Object.keys(facts.goalSetting).length === 0 ? 'missing' : goalFallback ? 'completed_with_fallback' : 'succeeded';
  const scoutingOutcome = Object.keys(facts.scouting).length === 0 ? 'missing' : scoutingFallback ? 'completed_with_fallback' : 'succeeded';
  const codingOutcome = hasDiff ? 'succeeded' : facts.taskMode === 'inspect' || facts.metadata.no_change_accepted === true ? 'succeeded' : 'failed';
  const goalCheckOutcome = typeof facts.goalCheck.met === 'boolean' ? facts.goalCheck.met ? 'succeeded' : 'failed' : 'not_reached';
  const evaluationOutcome = 'succeeded';
  const failedRun = isFailedRun(facts);
  const incompletePatch = facts.taskMode === 'patch' && !hasDiff && facts.metadata.no_change_accepted !== true;
  const contradictions: Array<{ sources: string[]; description: string }> = [];
  if (facts.taskMode === 'patch' && !hasDiff && facts.metadata.no_change_accepted !== true) {
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

  const phases: Array<{ stage: StageName; outcome: string; fallback?: boolean; evidence: string }> = [
    { stage: 'goal-setting', outcome: goalOutcome, fallback: goalFallback, evidence: facts.presentSources.includes('goal-setting.json') ? 'goal-setting.json' : '' },
    { stage: 'scouting', outcome: scoutingOutcome, fallback: scoutingFallback, evidence: facts.presentSources.includes('scouting.json') ? 'scouting.json' : '' },
    { stage: 'coding', outcome: codingOutcome, evidence: facts.presentSources.filter(source => ['git.diff', 'changed-files.txt'].includes(source)).join(', ') },
    { stage: 'validation', outcome: validation, evidence: facts.validationSources.join(', ') },
    { stage: 'goal-check', outcome: goalCheckOutcome, evidence: facts.presentSources.includes('goal-check.json') ? 'goal-check.json' : '' },
    { stage: 'run-evaluation', outcome: evaluationOutcome, evidence: 'JEV classifier response' },
  ];

  const phaseScorecard = Object.fromEntries(phases.map(phase => [phase.stage, {
    outcome: phase.stage === 'validation'
      ? phase.outcome === 'passed' ? 'succeeded' : phase.outcome === 'failed' ? 'failed' : 'not_run'
      : phase.outcome,
    score: phase.fallback ? 35 : phase.outcome === 'succeeded' ? 100 : phase.outcome === 'failed' ? 0 : 50,
    elapsed_seconds: number(facts.stageDurations[phase.stage]),
    evidence: phase.evidence ? [phase.evidence] : [],
    ...(phase.fallback ? { fallback: true } : {}),
    ...(phase.stage === 'validation' ? { commands_attempted: commandsAttempted(facts) } : {}),
    ...(phase.stage === 'coding' ? { changed_files: changed, diff_present: hasDiff } : {}),
    ...(phase.stage === 'scouting' ? { relevant_files_identified: Array.isArray(facts.scouting.relevant_files) ? facts.scouting.relevant_files.length : 0 } : {}),
  }]));

  const stageValue = phases.map(phase => ({
    stage: phase.stage,
    value: stageValueFor(phase.outcome, phase.fallback),
    reason: stageReason(phase.stage, phase.outcome, phase.evidence),
  }));

  const humanReviewFocus: string[] = [];
  const opportunities: Array<{ category: string; priority: string; suggestion: string }> = [];
  if (goalOutcome === 'missing') humanReviewFocus.push('Review the task objective because no goal-setting artifact was retained.');
  if (scoutingOutcome === 'missing') humanReviewFocus.push('Review repository coverage because no scouting artifact was retained.');
  if (goalCheckOutcome === 'not_reached') humanReviewFocus.push('Manually confirm the success criteria because no goal-check verdict is available.');
  if (goalCheckOutcome === 'failed') humanReviewFocus.push('Review unmet goal-check criteria and confirm the patch addresses them.');
  if (goalFallback) {
    humanReviewFocus.push('Review the task criteria because goal-setting used a fallback artifact.');
    opportunities.push({ category: 'goal_setting', priority: 'medium', suggestion: 'Improve goal-setting artifact recovery so task-specific success criteria survive evaluator failures.' });
  }
  if (scoutingFallback) {
    humanReviewFocus.push('Review changed-file coverage because the scouting fallback was used.');
    opportunities.push({ category: 'scouting', priority: 'high', suggestion: 'Reduce scouting handoff fallback frequency and retain the original agent findings when schema recovery is needed.' });
  }
  if (validation === 'not_run') {
    humanReviewFocus.push('Validation was not run; manually inspect the patch and run the relevant checks.');
    opportunities.push({ category: 'validation', priority: 'high', suggestion: 'Run at least one relevant validation command and preserve its final output and exit status.' });
  } else if (validation === 'failed') {
    humanReviewFocus.push('Review the failing validation output before accepting the patch.');
  }
  if (facts.taskMode === 'patch' && !hasDiff) {
    humanReviewFocus.push('Confirm whether a code change was required; patch mode produced no durable diff.');
    opportunities.push({ category: 'implementation', priority: 'high', suggestion: 'Ensure patch-mode tasks produce a durable diff or record an explicit, accepted no-change outcome.' });
  }
  if (failedRun && facts.failure.worker_error_type === 'metadata_write_invalid') {
    humanReviewFocus.push('Review stderr.log and the worker failure details because metadata serialization failed.');
    opportunities.push({ category: 'metadata', priority: 'high', suggestion: 'Keep run metadata JSON-safe and preserve the primary worker failure when writing fallback metadata.' });
  }
  const efficiencyFindings: string[] = [];
  for (const rawMetric of facts.cacheMetrics ?? []) {
    if (!rawMetric || typeof rawMetric !== 'object') continue;
    const metric = rawMetric as JsonObject;
    const name = string(metric.name);
    const elapsed = number(metric.elapsed_seconds);
    if (name === 'fresh_install' && elapsed !== undefined && elapsed >= 30) {
      efficiencyFindings.push(`Cold dependency installation took ${elapsed}s; improve cache hit rate or image seeding.`);
      opportunities.push({ category: 'dependency_cache', priority: elapsed >= 120 ? 'high' : 'medium', suggestion: 'Increase workspace or image dependency-cache hits to reduce fresh npm installs.' });
    } else if (/(?:workspace|image)_cache_restored/.test(name) && elapsed !== undefined && elapsed >= 30) {
      efficiencyFindings.push(`Dependency cache restoration took ${elapsed}s; inspect restore mode and filesystem copy cost.`);
      opportunities.push({ category: 'dependency_cache', priority: 'medium', suggestion: 'Tune cache restore mode and storage placement for faster dependency restores.' });
    }
  }
  if (failedRun && humanReviewFocus.length === 0) humanReviewFocus.push('Review the failed phase and its durable diagnostics before accepting this run.');

  const assessment = failedRun || incompletePatch ? 'poor' : classification.overallAssessment;
  const reviewerConfidence = failedRun || incompletePatch || humanReviewFocus.length > 0 ? 'low' : classification.reviewerConfidence;
  const completionScore = failedRun || incompletePatch ? Math.min(2, classification.taskCompletionScore) : classification.taskCompletionScore;
  const evidenceSources = buildRunEvaluationEvidenceSources({ presentSources: facts.presentSources, validationSources: facts.validationSources });
  const validationSummary = validation === 'not_run'
    ? 'validation was not run'
    : `${commandsAttempted(facts)} validation commands ${validation}`;
  const changeSummary = `${changed} changed ${changed === 1 ? 'file' : 'files'}`;
  const summary = `Run assessed ${assessment}; ${validationSummary}; ${changeSummary}${failedRun ? `; run failed with exit code ${facts.metadata.exit_code ?? facts.failure.exit_code ?? facts.failure.exitCode}` : incompletePatch ? '; patch mode produced no accepted change' : ''}.`;
  const prSummary = `${changeSummary}${hasDiff ? ' with a persisted diff' : ' with no persisted diff'}; ${validationSummary}; goal check ${goalCheckOutcome.replace(/_/g, ' ')}.`;
  const warnings = [
    ...(goalFallback ? ['Goal-setting used a fallback artifact.'] : []),
    ...(scoutingFallback ? ['Scouting used a fallback handoff.'] : []),
    ...(validation === 'not_run' ? ['No validation commands were executed.'] : []),
    ...(incompletePatch ? ['Patch mode produced no durable diff and no accepted no-change outcome.'] : []),
    ...(failedRun ? ['The run lifecycle ended in failure; evaluator completion is capped at 2/5.'] : []),
  ];

  return {
    overall_assessment: assessment,
    reviewer_confidence: reviewerConfidence,
    task_completion_score: completionScore,
    summary,
    human_review_focus: humanReviewFocus,
    stage_value: stageValue,
    evidence_sources_inspected: evidenceSources,
    contradictions,
    confidence_calibration: {
      objective_outcome: facts.goalCheck.met === true ? 'met' : facts.goalCheck.met === false ? 'unmet' : 'unknown',
      status: 'unassessed',
      calibrated: false,
      reason: `No labeled outcome data is supplied for statistical calibration. Evidence completeness is assessed separately; ${validationSummary}.`,
    },
    phase_scorecard: phaseScorecard,
    efficiency_findings: efficiencyFindings,
    kaseki_improvement_opportunities: opportunities,
    pr_summary: prSummary,
    pr_changes: [],
    warnings,
    classifier,
    ...(classification.failureDiagnosis ? { failure_diagnosis: {
      cause: classification.failureDiagnosis.cause,
      recommended_action: classification.failureDiagnosis.recommendedAction,
      confidence: classification.failureDiagnosis.confidence,
      cause_probabilities: classification.failureDiagnosis.causeProbabilities,
      action_probabilities: classification.failureDiagnosis.actionProbabilities,
    } } : {}),
  };
}
