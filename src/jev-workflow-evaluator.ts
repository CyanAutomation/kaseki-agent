import * as fs from 'node:fs';
import * as path from 'node:path';
import { answerIsTrue, classifyWithJev, DEFAULT_JEV_MODEL } from './jev-classifier';

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

function redact(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonObject).map(([key, item]) => [key, /secret|token|password|credential|api.?key/i.test(key) ? '[REDACTED_SECRET]' : redact(item)]));
  return value;
}

function bounded(value: unknown, maxChars: number): unknown {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return { truncated: true, preview: serialized.slice(0, maxChars) };
}

function evidenceState(resultsDir: string): JsonObject {
  const goal = readJson(path.join(resultsDir, 'goal-setting.json'));
  const scouting = readJson(path.join(resultsDir, 'scouting.json'));
  return {
    goal_setting: bounded(redact(goal), 8000),
    scouting: bounded(redact(scouting), 8000),
    changed_files: redact(readText(path.join(resultsDir, 'changed-files.txt')).slice(0, 12000)),
    diff: redact(readText(path.join(resultsDir, 'git.diff')).slice(0, 24000)),
    validation: redact(readText(path.join(resultsDir, 'validation.log')).slice(-12000)),
    task_mode: process.env.KASEKI_TASK_MODE || 'patch',
  };
}

function criteriaFrom(goal: JsonObject): string[] {
  const criteria = Array.isArray(goal.success_criteria) ? goal.success_criteria : [];
  return criteria.map((criterion) => typeof criterion === 'string' ? criterion : JSON.stringify(criterion));
}

function confidenceThreshold(): number {
  const value = Number.parseFloat(process.env.KASEKI_JEV_CONFIDENCE || '0.8');
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.8;
}

function questionId(index: number): string { return `criterion_${index + 1}`; }

async function runGoalCheck(resultsDir: string, attempt: number): Promise<JsonObject> {
  const state = evidenceState(resultsDir);
  const criteria = criteriaFrom(state.goal_setting as JsonObject);
  const effectiveCriteria = criteria.length > 0 ? criteria : ['Does the available evidence show that the requested task was completed?'];
  const questions = Object.fromEntries(effectiveCriteria.map((criterion, index) => [questionId(index), {
    type: 'noul' as const,
    instructions: `Is this success criterion satisfied by the supplied repository and validation evidence? Criterion: ${criterion}`,
  }]));
  const result = await classifyWithJev(state, questions, {
    model: process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL,
    timeoutMs: Number.parseInt(process.env.KASEKI_JEV_GOAL_CHECK_TIMEOUT_MS || '5000', 10),
  });
  const threshold = confidenceThreshold();
  const missing: string[] = [];
  const evidence: string[] = ['goal-setting.json', 'scouting.json', 'changed-files.txt', 'git.diff', 'validation.log'];
  let allMet = true;
  for (const [id, answer] of Object.entries(result.answers)) {
    const match = id.match(/^criterion_(\d+)$/);
    const index = match ? Number(match[1]) - 1 : -1;
    const criterion = index >= 0 && index < effectiveCriteria.length ? effectiveCriteria[index] : id;
    if (!answerIsTrue(answer, threshold)) {
      allMet = false;
      missing.push(`${criterion} (noul=${answer?.type === 'noul' ? answer.noul.toFixed(2) : 'invalid'}, threshold=${threshold.toFixed(2)})`);
    }
  }
  if (process.env.KASEKI_TASK_MODE === 'patch' && !String(state.diff).trim()) {
    allMet = false;
    missing.push('patch-mode task produced no git diff');
  }
  const summary = allMet ? 'JEV classified all success criteria as satisfied with sufficient confidence.' : 'JEV found one or more unmet or low-confidence success criteria.';
  return {
    met: allMet,
    confidence: missing.length === 0 ? 'high' : 'medium',
    summary,
    evidence,
    missing,
    retry_prompt: allMet ? '' : `Address the unmet criteria and produce evidence for: ${missing.join('; ')}`,
    validation_notes: [String(state.validation).trim() ? 'validation.log contained final validation evidence' : 'validation evidence was unavailable'],
    evidence_sources_inspected: evidence,
    contradictions: [],
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
  const result = await classifyWithJev(stateForJev, {
    overall_assessment: { type: 'choice', instructions: 'What is the overall quality of this completed coding run?', criteria: { excellent: 'Strong evidence and low review risk', good: 'Acceptable evidence with limited review risk', mixed: 'Material uncertainty or mixed signals', poor: 'Major evidence or process problems' } },
    reviewer_confidence: { type: 'choice', instructions: 'How much can a reviewer trust this run without exhaustive manual review?', criteria: { high: 'Validation and evidence strongly support the result', medium: 'Some manual review is advisable', low: 'Manual review is required' } },
    task_completion_score: { type: 'score', instructions: 'How completely did the run satisfy its objective?', criteria: ['Largely unrealized', 'Major requirements unmet', 'Partially complete', 'Nearly complete', 'All requirements verified'] },
  }, { model: process.env.KASEKI_CLASSIFICATION_MODEL || DEFAULT_JEV_MODEL, timeoutMs: Number.parseInt(process.env.KASEKI_JEV_RUN_EVALUATION_TIMEOUT_MS || '5000', 10) });
  const answer = (name: string): string | number => {
    const value = result.answers[name];
    return value?.type === 'choice' ? value.choice : value?.type === 'score' ? value.score : value?.type === 'noul' ? value.noul : 'unknown';
  };
  return {
    overall_assessment: answer('overall_assessment'),
    reviewer_confidence: answer('reviewer_confidence'),
    task_completion_score: answer('task_completion_score'),
    summary: 'Structured run evaluation was produced by JEV from persisted run evidence.',
    human_review_focus: answer('reviewer_confidence') === 'low' ? ['Review the diff, validation evidence, and goal-check criteria manually.'] : [],
    stage_value: [],
    evidence_sources_inspected: ['goal-check.json', 'changed-files.txt', 'git.diff', 'validation.log'],
    contradictions: [],
    confidence_calibration: { objective_outcome: goalCheck.met === true ? 'met' : 'unmet', calibrated: true, reason: 'JEV classified structured evidence; deterministic scorecard caps remain authoritative.' },
    phase_scorecard: {},
    efficiency_findings: [],
    kaseki_improvement_opportunities: [],
    pr_summary: 'JEV evaluated task completion and reviewer confidence from the persisted run artifacts.',
    warnings: [],
    classifier: { provider: 'openrouter-decisions', model: result.model, response_time_ms: result.responseTime, usage: result.usage },
  };
}

async function main(): Promise<void> {
  const [mode, resultsDir, attemptText] = process.argv.slice(2);
  if (!mode || !resultsDir) throw new Error('usage: jev-workflow-evaluator <goal-check|run-evaluation> <results-dir> [attempt]');
  const artifact = mode === 'goal-check' ? await runGoalCheck(resultsDir, Number(attemptText || 1)) : await runEvaluation(resultsDir);
  const output = path.join(resultsDir, mode === 'goal-check' ? 'goal-check.json' : 'run-evaluation.json');
  fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
