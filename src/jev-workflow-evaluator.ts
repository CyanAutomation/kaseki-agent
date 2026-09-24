import * as fs from 'node:fs';
import * as path from 'node:path';
import { classifyWithJev, DEFAULT_JEV_MODEL } from './jev-classifier';
import { collectValidationEvidence } from './validation-evidence';
import { buildRunEvaluationArtifact, buildRunEvaluationEvidenceSources } from './jev-run-evaluation-artifact';
import { buildGoalCheckQuestions, buildGoalCriterionAssessments, buildRunEvaluationQuestions, compactGoalSettingForEvaluation, failureDiagnosisFromAnswers, mapJevScoreToCompletion } from './jev-workflow-helpers';
import { redactJevEvidence } from './jev-evidence-redaction';
import { normalizeSuccessCriteria, validateGoalContract } from '../scripts/lib/goal-contract.cjs';
import { aggregateStageDurations } from './stage-timings';

type JsonObject = Record<string, unknown>;

function readText(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJson(file: string): JsonObject {
  try {
    const value = JSON.parse(readText(file));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  } catch { return {}; }
}

function readJsonValue(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

function bounded(value: unknown, maxChars: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return { truncated: true, preview: serialized.slice(0, maxChars) };
}

function evidenceState(resultsDir: string): JsonObject {
  const goal = readJson(path.join(resultsDir, 'goal-setting.json'));
  const scouting = readJson(path.join(resultsDir, 'scouting.json'));
  const validation = collectValidationEvidence(resultsDir);
  const presentSources = [
    'metadata.json', 'failure.json', 'goal-setting.json', 'scouting.json', 'goal-check.json',
    'changed-files.txt', 'git.diff', 'validation.log', 'validation-timings.tsv',
    'pre-validation.log', 'pre-validation-timings.tsv', 'validation-results.json', 'timings-manifest.json', 'stage-timings.tsv',
  ].filter((name) => {
    try { return fs.statSync(path.join(resultsDir, name)).isFile(); } catch { return false; }
  });
  const cacheMetrics = readJsonValue(path.join(resultsDir, 'cache-metrics.json'));
  const timingsManifest = readJson(path.join(resultsDir, 'timings-manifest.json'));
  const compactedGoal = compactGoalSettingForEvaluation(redactJevEvidence(goal) as JsonObject, 8000);
  return {
    goal_setting: compactedGoal.goal_setting,
    goal_setting_compaction: {
      compacted: compactedGoal.compacted,
      target_chars: compactedGoal.target_chars,
      actual_chars: compactedGoal.actual_chars,
      target_exceeded: compactedGoal.target_exceeded,
      omitted_fields: compactedGoal.omitted_fields,
    },
    scouting: bounded(redactJevEvidence(scouting), 8000),
    metadata: redactJevEvidence(readJson(path.join(resultsDir, 'metadata.json'))),
    failure: redactJevEvidence(readJson(path.join(resultsDir, 'failure.json'))),
    changed_files: redactJevEvidence(readText(path.join(resultsDir, 'changed-files.txt')).slice(0, 12000)),
    diff: redactJevEvidence(readText(path.join(resultsDir, 'git.diff')).slice(0, 24000)),
    validation: redactJevEvidence(validation.text),
    validation_sources: validation.sources,
    timings_manifest: timingsManifest,
    present_sources: presentSources,
    stage_durations: aggregateStageDurations(readText(path.join(resultsDir, 'stage-timings.tsv'))),
    cache_metrics: Array.isArray(cacheMetrics) ? cacheMetrics : [],
    task_mode: process.env.KASEKI_TASK_MODE || 'patch',
  };
}

function confidenceThreshold(): number {
  const value = Number.parseFloat(process.env.KASEKI_JEV_CONFIDENCE || '0.8');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
}

function questionId(index: number): string { return `criterion_${index + 1}`; }

async function runGoalCheck(resultsDir: string, attempt: number): Promise<JsonObject> {
  const state = evidenceState(resultsDir);
  const goal = state.goal_setting as JsonObject;
  const contract = Object.keys(goal).length > 0
    ? validateGoalContract(goal)
    : { valid: true, outcomePolicy: undefined, criteria: [], errors: [], warnings: ['goal-setting artifact is unavailable'] };
  const criteria = normalizeSuccessCriteria(goal.success_criteria);
  const effectiveCriteria = criteria.length > 0
    ? criteria
    : [{ id: questionId(0), criterion: 'Does the available evidence show that the requested task was completed?' }];
  const validationSources = Array.isArray(state.validation_sources) ? state.validation_sources as string[] : [];
  const presentSources = Array.isArray(state.present_sources) ? state.present_sources as string[] : [];
  const evidence = buildRunEvaluationEvidenceSources({ presentSources, validationSources });
  if (!contract.valid) {
    const contradictions = contract.errors.map((description) => ({ sources: ['goal-setting.json'], description }));
    return {
      met: false,
      retryable: false,
      confidence: 'low',
      summary: 'Goal-setting produced an invalid or contradictory goal contract; coding retry was suppressed.',
      evidence,
      missing: contract.errors,
      criteria_assessment: [],
      retry_prompt: '',
      validation_notes: ['Goal contract validation failed before semantic classification.'],
      evidence_sources_inspected: evidence,
      contradictions,
      contract_validation: { valid: false, outcome_policy: contract.outcomePolicy ?? null, errors: contract.errors },
      confidence_calibration: { outcome: 'unmet', justification: 'The goal contract must be corrected before its criteria can be assessed.' },
      classifier: { provider: 'deterministic-contract-check', model: 'local', response_time_ms: 0, usage: {}, attempt },
    };
  }
  const questions = buildGoalCheckQuestions(effectiveCriteria);
  const result = await classifyWithJev(state, questions, {
    model: process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL,
    timeoutMs: Number.parseInt(process.env.KASEKI_JEV_GOAL_CHECK_TIMEOUT_MS || '15000', 10),
  });
  const threshold = confidenceThreshold();
  const missing: string[] = [];
  const assessments = buildGoalCriterionAssessments(effectiveCriteria, result.answers, threshold);
  let allMet = assessments.every((assessment) => assessment.met);
  for (const assessment of assessments) {
    if (assessment.status === 'unmet' || assessment.status === 'unknown') {
      const reason = assessment.status === 'unknown'
        ? assessment.applicability === 'unknown' ? `applicability of "${assessment.applies_when}" is unknown` : 'evidence was insufficient'
        : `noul=${assessment.probability?.toFixed(2)}, threshold=${threshold.toFixed(2)}`;
      missing.push(`${assessment.criterion} (${reason})`);
    }
  }
  const outcomePolicy = contract.outcomePolicy ?? (process.env.KASEKI_TASK_MODE === 'inspect' ? 'change_or_noop' : 'change_required');
  const contradictions: Array<{ sources: string[]; description: string }> = [];
  if (process.env.KASEKI_TASK_MODE !== 'inspect' && outcomePolicy === 'change_required' && !String(state.diff).trim()) {
    allMet = false;
    missing.push('patch-mode task produced no git diff');
    contradictions.push({ sources: ['goal-setting.json', 'git.diff'], description: 'The goal contract requires a code change but the durable diff is empty.' });
  }
  const summary = allMet ? 'JEV classified all applicable success criteria as satisfied with sufficient confidence.' : 'JEV found one or more unmet, unknown, or low-confidence success criteria.';
  return {
    met: allMet,
    retryable: true,
    confidence: missing.length === 0 ? 'high' : 'medium',
    summary,
    evidence,
    missing,
    criteria_assessment: assessments,
    retry_prompt: allMet ? '' : `Address the unmet criteria and produce evidence for: ${missing.join('; ')}`,
    validation_notes: [String(state.validation).trim() ? `validation evidence available from: ${validationSources.join(', ')}` : 'validation evidence was unavailable'],
    evidence_sources_inspected: evidence,
    contradictions,
    contract_validation: { valid: true, outcome_policy: outcomePolicy, warnings: contract.warnings },
    confidence_calibration: { outcome: allMet ? 'met' : 'unmet', justification: `JEV confidence threshold=${threshold}; ${missing.length} criteria require attention.` },
    classifier: { provider: 'openrouter-decisions', model: result.model, response_time_ms: result.responseTime, usage: result.usage, attempt },
  };
}

async function runEvaluation(resultsDir: string): Promise<JsonObject> {
  const state = evidenceState(resultsDir);
  const goalCheck = readJson(path.join(resultsDir, 'goal-check.json'));
  const validation = String(state.validation).trim();
  const diff = String(state.diff).trim();
  const stateForJev = { ...state, goal_check: goalCheck, validation_present: Boolean(validation), diff_present: Boolean(diff) };
  const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata as JsonObject : {};
  const failure = state.failure && typeof state.failure === 'object' ? state.failure as JsonObject : {};
  const runExit = Number(metadata.exit_code ?? failure.exit_code ?? failure.exitCode);
  const validationExit = Number(metadata.validation_exit_code ?? failure.validation_exit_code);
  const hasFailureEvidence = (Number.isFinite(runExit) && runExit !== 0)
    || (Number.isFinite(validationExit) && validationExit !== 0)
    || /(?:^|\s)(?:failed|error|exit code [1-9]\d*)/im.test(validation);
  const result = await classifyWithJev(stateForJev, buildRunEvaluationQuestions(hasFailureEvidence), { model: process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL, timeoutMs: Number.parseInt(process.env.KASEKI_JEV_RUN_EVALUATION_TIMEOUT_MS || '15000', 10) });
  const answer = (name: string): string | number => {
    const value = result.answers[name];
    return value?.type === 'choice' ? value.choice : value?.type === 'score' ? value.score : value?.type === 'noul' ? value.noul : 'unknown';
  };
  const failureDiagnosis = failureDiagnosisFromAnswers(result.answers);
  const fact = {
    metadata,
    failure,
    goalSetting: (state.goal_setting && typeof state.goal_setting === 'object' ? state.goal_setting : {}) as JsonObject,
    scouting: (state.scouting && typeof state.scouting === 'object' ? state.scouting : {}) as JsonObject,
    goalCheck,
    validation: String(state.validation ?? ''),
    validationSources: Array.isArray(state.validation_sources) ? state.validation_sources as string[] : [],
    changedFiles: String(state.changed_files ?? ''),
    diff: String(state.diff ?? ''),
    taskMode: String(state.task_mode ?? 'patch'),
    presentSources: Array.isArray(state.present_sources) ? state.present_sources as string[] : [],
    stageDurations: (state.stage_durations && typeof state.stage_durations === 'object' ? state.stage_durations : {}) as Record<string, number>,
    timingManifest: (state.timings_manifest && typeof state.timings_manifest === 'object' ? state.timings_manifest : {}) as JsonObject,
    cacheMetrics: Array.isArray(state.cache_metrics) ? state.cache_metrics : [],
  };
  const assessment = answer('overall_assessment');
  const confidence = answer('reviewer_confidence');
  const completion = answer('task_completion_score');
  return buildRunEvaluationArtifact(fact, {
    overallAssessment: typeof assessment === 'string' ? assessment : 'unknown',
    reviewerConfidence: typeof confidence === 'string' ? confidence : 'low',
    taskCompletionScore: typeof completion === 'number' ? mapJevScoreToCompletion(completion) : 1,
    failureDiagnosis,
  }, { provider: 'openrouter-decisions', model: result.model, responseTime: result.responseTime, usage: result.usage, answers: result.answers });
}

async function main(): Promise<void> {
  const [mode, resultsDir, attemptText] = process.argv.slice(2);
  if (!mode || !resultsDir) throw new Error('usage: jev-workflow-evaluator <goal-check|run-evaluation> <results-dir> [attempt]');
  const artifact = mode === 'goal-check' ? await runGoalCheck(resultsDir, Number(attemptText || 1)) : await runEvaluation(resultsDir);
  const output = path.join(resultsDir, mode === 'goal-check' ? 'goal-check.json' : 'run-evaluation.json');
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
