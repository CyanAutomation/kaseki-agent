import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { classifyWithJev, DEFAULT_JEV_MODEL } from './jev-classifier';
import { collectValidationEvidence } from './validation-evidence';
import { buildRunEvaluationArtifact, buildRunEvaluationEvidenceSources } from './jev-run-evaluation-artifact';
import { buildGoalCheckOutcome, buildGoalCheckQuestions, buildGoalCriterionAssessments, buildRunEvaluationQuestions, compactGoalSettingForEvaluation, failureDiagnosisFromAnswers, goalCheckUnmetThreshold, mapJevScoreToCompletion, selectCriterionEvidenceSources } from './jev-workflow-helpers';
import { redactJevEvidence } from './jev-evidence-redaction';
import { normalizeSuccessCriteria, validateGoalContract } from '../scripts/lib/goal-contract.cjs';
import { aggregateStageDurations } from './stage-timings';
import {
  buildValidationRecoveryArtifact,
  buildValidationRecoveryQuestions,
  decideValidationRetry,
  parseRetrySafeCommands,
  prepareValidationFailureState,
  resolveValidationRecoveryMode,
} from './validation-recovery';

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
  const value = Number.parseFloat(process.env.KASEKI_GOAL_CHECK_CONFIDENCE_THRESHOLD || '0.8');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
}

function validationRetryConfidenceThreshold(): number {
  const value = Number.parseFloat(process.env.KASEKI_VALIDATION_RETRY_CONFIDENCE_THRESHOLD || '0.9');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.9;
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
      evaluation: { stage: 'goal check', response_time_ms: 0, usage: {}, attempt },
    };
  }
  const questions = buildGoalCheckQuestions(effectiveCriteria);
  const result = await classifyWithJev(state, questions, {
    model: process.env.KASEKI_DECISION_MODEL || DEFAULT_JEV_MODEL,
    timeoutMs: Number.parseInt(process.env.KASEKI_GOAL_CHECK_DECISION_TIMEOUT_MS || '15000', 10),
  });
  const threshold = confidenceThreshold();
  const missing: string[] = [];
  const assessments = buildGoalCriterionAssessments(effectiveCriteria, result.answers, threshold);
  let outcome = buildGoalCheckOutcome(assessments);
  for (const assessment of assessments) {
    if (assessment.status === 'unmet' || assessment.status === 'uncertain' || assessment.status === 'unknown') {
      const reason = assessment.status === 'unknown'
        ? assessment.applicability === 'unknown' ? `applicability of "${assessment.applies_when}" is unknown` : 'Evaluation did not provide enough evidence'
        : assessment.status === 'uncertain'
          ? `noul=${assessment.probability?.toFixed(2)} is between the unmet boundary ${goalCheckUnmetThreshold(threshold).toFixed(2)} and pass threshold ${threshold.toFixed(2)}; direct evidence is inconclusive`
          : `noul=${assessment.probability?.toFixed(2)} is at or below the unmet boundary ${goalCheckUnmetThreshold(threshold).toFixed(2)}`;
      missing.push(`${assessment.criterion} (${reason})`);
    }
  }
  const outcomePolicy = contract.outcomePolicy ?? (process.env.KASEKI_TASK_MODE === 'inspect' ? 'change_or_noop' : 'change_required');
  const contradictions: Array<{ sources: string[]; description: string }> = [];
  if (process.env.KASEKI_TASK_MODE !== 'inspect' && outcomePolicy === 'change_required' && !String(state.diff).trim()) {
    outcome = 'unmet';
    missing.push('patch-mode task produced no git diff');
    contradictions.push({ sources: ['goal-setting.json', 'git.diff'], description: 'The goal contract requires a code change but the durable diff is empty.' });
  }
  const summary = outcome === 'met'
    ? 'Evaluation found all applicable success criteria satisfied with sufficient confidence.'
    : outcome === 'unmet'
      ? 'Evaluation found one or more success criteria that evidence indicates are unmet.'
      : 'Evaluation could not establish with sufficient confidence whether all applicable success criteria are satisfied.';
  return {
    met: outcome === 'met',
    outcome,
    review_required: outcome === 'uncertain',
    retryable: true,
    confidence: outcome === 'met' ? 'high' : 'medium',
    summary,
    evidence,
    missing,
    criteria_assessment: assessments.map((assessment) => ({
      ...assessment,
      evidence_sources: selectCriterionEvidenceSources(assessment, evidence),
    })),
    retry_prompt: outcome === 'met' ? '' : outcome === 'unmet'
      ? `Address the criteria with concrete evidence of what remains incomplete: ${missing.join('; ')}`
      : `Review these criteria against the final repository and validation evidence. Do not make changes solely to raise Evaluation confidence; identify direct evidence or document what remains unknown: ${missing.join('; ')}`,
    validation_notes: [String(state.validation).trim() ? `validation evidence available from: ${validationSources.join(', ')}` : 'validation evidence was unavailable'],
    evidence_sources_inspected: evidence,
    contradictions,
    contract_validation: { valid: true, outcome_policy: outcomePolicy, warnings: contract.warnings },
    confidence_calibration: { outcome, justification: `Goal-check pass threshold=${threshold}; unmet boundary=${goalCheckUnmetThreshold(threshold).toFixed(2)}; ${missing.length} criteria require attention.` },
    evaluation: { stage: 'goal check', response_time_ms: result.responseTime, usage: result.usage, attempt },
  };
}

async function runEvaluation(resultsDir: string): Promise<JsonObject> {
  const state = evidenceState(resultsDir);
  const goalCheck = readJson(path.join(resultsDir, 'goal-check.json'));
  const validation = String(state.validation).trim();
  const diff = String(state.diff).trim();
  const stateForEvaluation = { ...state, goal_check: goalCheck, validation_present: Boolean(validation), diff_present: Boolean(diff) };
  const metadata = state.metadata && typeof state.metadata === 'object' ? state.metadata as JsonObject : {};
  const failure = state.failure && typeof state.failure === 'object' ? state.failure as JsonObject : {};
  const runExit = Number(metadata.exit_code ?? failure.exit_code ?? failure.exitCode);
  const validationExit = Number(metadata.validation_exit_code ?? failure.validation_exit_code);
  const hasFailureEvidence = (Number.isFinite(runExit) && runExit !== 0)
    || (Number.isFinite(validationExit) && validationExit !== 0)
    || /(?:^|\s)(?:failed|error|exit code [1-9]\d*)/im.test(validation);
  const result = await classifyWithJev(stateForEvaluation, buildRunEvaluationQuestions(hasFailureEvidence), { model: process.env.KASEKI_DECISION_MODEL || DEFAULT_JEV_MODEL, timeoutMs: Number.parseInt(process.env.KASEKI_RUN_EVALUATION_DECISION_TIMEOUT_MS || '15000', 10) });
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
  }, { stage: 'run evaluation', responseTime: result.responseTime, usage: result.usage, answers: result.answers });
}

async function runValidationRecovery(resultsDir: string): Promise<JsonObject> {
  const mode = resolveValidationRecoveryMode(process.env.KASEKI_VALIDATION_RECOVERY_MODE);
  const command = process.env.KASEKI_FAILED_VALIDATION_COMMAND || '';
  const parsedExit = Number.parseInt(process.env.KASEKI_FAILED_VALIDATION_EXIT_CODE || '', 10);
  const exitCode = Number.isInteger(parsedExit) ? parsedExit : 1;
  const safeCommands = parseRetrySafeCommands(process.env.KASEKI_VALIDATION_RETRY_SAFE_COMMANDS);
  const attempts = readText(path.join(resultsDir, 'validation-recovery-attempts.txt')).split(/\r?\n/).filter(Boolean);
  const fingerprint = createHash('sha256').update(command).digest('hex');
  const base = {
    mode,
    command,
    exitCode,
  };
  if (mode === 'off') {
    return buildValidationRecoveryArtifact({
      ...base,
      decision: { shouldRetry: false, reason: 'disabled', confidence: 0 },
      status: 'skipped',
    }) as unknown as JsonObject;
  }

  const state = prepareValidationFailureState({
    command,
    exitCode,
    output: readText(path.join(resultsDir, 'validation-recovery-output.tmp')),
  });
  try {
    const result = await classifyWithJev(state, buildValidationRecoveryQuestions(), {
      model: process.env.KASEKI_DECISION_MODEL || DEFAULT_JEV_MODEL,
      timeoutMs: Number.parseInt(process.env.KASEKI_VALIDATION_RECOVERY_DECISION_TIMEOUT_MS || '15000', 10),
    });
    const decision = decideValidationRetry({
      mode,
      command,
      safeCommands,
      answers: result.answers,
      confidenceThreshold: validationRetryConfidenceThreshold(),
      alreadyRetried: attempts.includes(fingerprint),
    });
    return buildValidationRecoveryArtifact({ ...base, decision }) as unknown as JsonObject;
  } catch {
    return buildValidationRecoveryArtifact({
      ...base,
      decision: { shouldRetry: false, reason: 'classification_unavailable', confidence: 0 },
      status: 'unavailable',
    }) as unknown as JsonObject;
  }
}

function recordValidationRecoveryRetryResult(resultsDir: string, exitCode: number): void {
  const output = path.join(resultsDir, 'validation-recovery.json');
  const artifact = readJson(output);
  artifact.retry_attempted = true;
  artifact.retry_result = exitCode === 0 ? 'passed' : 'failed';
  artifact.retry_authorized = false;
  artifact.reason = exitCode === 0 ? 'retry_passed' : 'retry_failed';
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
}

async function main(): Promise<void> {
  const [mode, resultsDir, attemptText] = process.argv.slice(2);
  if (!mode || !resultsDir) throw new Error('usage: evaluation-workflow <goal-check|run-evaluation|validation-recovery|record-validation-retry-result> <results-dir> [attempt|exit-code]');
  if (mode === 'record-validation-retry-result') {
    recordValidationRecoveryRetryResult(resultsDir, Number.parseInt(attemptText || '1', 10));
    return;
  }
  const artifact = mode === 'goal-check'
    ? await runGoalCheck(resultsDir, Number(attemptText || 1))
    : mode === 'run-evaluation'
      ? await runEvaluation(resultsDir)
      : mode === 'validation-recovery'
        ? await runValidationRecovery(resultsDir)
        : undefined;
  if (!artifact) throw new Error('unsupported evaluation stage');
  const outputName = mode === 'goal-check' ? 'goal-check.json' : mode === 'run-evaluation' ? 'run-evaluation.json' : 'validation-recovery.json';
  fs.writeFileSync(path.join(resultsDir, outputName), JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
