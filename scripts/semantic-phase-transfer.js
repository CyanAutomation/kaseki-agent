// Bounded, fail-open semantic routing for scouting facts entering coding context.
import fs from 'node:fs';
import path from 'node:path';

export const PHASE_TRANSFER_QUESTIONS = {
  preserve: 'Keep this scouting fact in the coding handoff at its current fidelity. Use for task-relevant architecture, implementation files, tests, conventions, or facts that may affect a required change.',
  condense: 'Keep the useful part at lower fidelity. Preserve exact paths and reduce supporting explanation to the strongest concise fact.',
  discard: 'Omit only when this fact is clearly unrelated to the current task and safe to leave out of coding context.',
};

const DEFAULT_DISCARD_THRESHOLD = 0.98;
const DEFAULT_CONDENSE_THRESHOLD = 0.7;
const MAX_CANDIDATES = 32;
const MAX_CANDIDATE_CHARS = 700;
const MAX_GOAL_CHARS = 1200;

const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const identity = value => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const list = value => Array.isArray(value) ? value : [];

function uniqueStrings(values, limit, maxChars) {
  const found = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalize(value);
    const key = identity(normalized);
    if (!normalized || found.has(key)) continue;
    found.add(key);
    output.push(normalized.slice(0, maxChars));
    if (output.length >= limit) break;
  }
  return output;
}

function normalizedPath(value) {
  return typeof value === 'string' && value.trim() ? path.normalize(value.trim()).replaceAll('\\', '/') : '';
}

function candidateText(candidate, redact) {
  const parts = candidate.kind === 'inspected_file'
    ? [candidate.path, candidate.value?.reason, ...list(candidate.value?.facts)]
    : candidate.kind === 'test_impact'
      ? [candidate.path, candidate.value?.reason, ...list(candidate.value?.facts)]
      : [candidate.value];
  return String(redact(parts.filter(value => typeof value === 'string').join('\n')) || '')
    .replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_CHARS);
}

function candidateItems(input, redact) {
  const items = [];
  list(input.inspectedFiles).forEach((value, index) => {
    if (value && typeof value.path === 'string' && value.path.trim()) {
      items.push({ id: `file_${index}`, kind: 'inspected_file', path: value.path.trim(), value });
    }
  });
  list(input.implementationBrief?.observations).forEach((value, index) => {
    if (typeof value === 'string' && value.trim()) items.push({ id: `observation_${index}`, kind: 'observation', value });
  });
  list(input.implementationBrief?.plan).forEach((value, index) => {
    if (typeof value === 'string' && value.trim()) items.push({ id: `plan_${index}`, kind: 'plan', value });
  });
  list(input.implementationBrief?.test_impact).forEach((value, index) => {
    if (value && typeof value === 'object') {
      const itemPath = typeof value.path === 'string' ? value.path.trim() : '';
      const reason = typeof value.reason === 'string' ? value.reason : '';
      if (itemPath || reason) items.push({ id: `test_${index}`, kind: 'test_impact', path: itemPath, value });
    } else if (typeof value === 'string' && value.trim()) {
      items.push({ id: `test_${index}`, kind: 'test_impact', value });
    }
  });

  const requiredPaths = new Set(list(input.implementationBrief?.required_files).map(normalizedPath).filter(Boolean));
  const protectedPaths = new Set(list(input.implementationBrief?.protected_files).map(normalizedPath).filter(Boolean));
  const taskText = `${input.goalSummary || ''} ${input.taskPrompt || ''}`;
  const explicitPaths = new Set((taskText.match(/(?:^|\s)((?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:ts|tsx|js|jsx|json|md|sh|go|py|rs|java|yml|yaml))/g) || [])
    .map(value => normalizedPath(value.trim())));

  for (const item of items) {
    const safeText = candidateText(item, redact);
    const pathKey = normalizedPath(item.path);
    item.protected = Boolean(
      (pathKey && (requiredPaths.has(pathKey) || protectedPaths.has(pathKey) || explicitPaths.has(pathKey)))
      || /\b(?:must|required|acceptance criteria|critical requirement|security finding|validation failure|unresolved error|do not modify|must preserve)\b/i.test(safeText),
    );
    item.text = safeText;
  }
  return { items, requiredPaths };
}

function makeQuestion() {
  return {
    type: 'choice',
    instructions: 'Route one bounded scouting fact from the prior scouting phase into the coding phase. Use only this fact and the bounded goal. Preserve task requirements, critical evidence, and uncertainty. Prefer condense to discard when the fact may help implementation or verification.',
    criteria: PHASE_TRANSFER_QUESTIONS,
  };
}

function interpretAnswer(answer, thresholds) {
  if (!answer || answer.type !== 'choice' || !Object.hasOwn(PHASE_TRANSFER_QUESTIONS, answer.choice)) return null;
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) return null;
  const values = ['preserve', 'condense', 'discard'].map(key => probabilities[key]);
  if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.03) return null;
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return null;
  if (answer.choice === 'discard' && probabilities.discard >= thresholds.discard) return 'discard';
  if (answer.choice === 'condense' && probabilities.condense >= thresholds.condense) return 'condense';
  return 'preserve';
}

function condenseCandidate(candidate) {
  const clone = JSON.parse(JSON.stringify(candidate.value));
  if (candidate.kind === 'inspected_file') {
    clone.reason = normalize(clone.reason).slice(0, 240);
    clone.facts = uniqueStrings(list(clone.facts), 2, 180);
    return clone;
  }
  if (candidate.kind === 'test_impact' && clone && typeof clone === 'object') {
    if (typeof clone.reason === 'string') clone.reason = normalize(clone.reason).slice(0, 240);
    if (Array.isArray(clone.facts)) clone.facts = uniqueStrings(clone.facts, 2, 180);
    return clone;
  }
  const text = normalize(candidate.value);
  const sentence = text.split(/(?<=[.!?])\s+/u)[0] || text;
  return sentence.slice(0, 240);
}

function applySelections(input, items, selections) {
  const included = items.filter(item => selections.get(item.id) !== 'discard');
  const selectedValue = item => selections.get(item.id) === 'condense' ? condenseCandidate(item) : item.value;
  const files = new Map(); const observations = []; const plan = []; const testImpact = [];
  for (const item of included) {
    const value = selectedValue(item);
    if (item.kind === 'inspected_file') files.set(item.path, { ...value, path: item.path });
    else if (item.kind === 'observation') observations.push(value);
    else if (item.kind === 'plan') plan.push(value);
    else if (item.kind === 'test_impact') testImpact.push(value);
  }
  return {
    inspectedFiles: input.inspectedFiles.filter(item => !items.some(candidate => candidate.kind === 'inspected_file' && candidate.path === item.path && selections.get(candidate.id) === 'discard'))
      .map(item => files.get(item.path) || item),
    implementationBrief: {
      ...input.implementationBrief,
      observations: items.some(item => item.kind === 'observation') ? observations : input.implementationBrief.observations,
      plan: items.some(item => item.kind === 'plan') ? plan : input.implementationBrief.plan,
      test_impact: items.some(item => item.kind === 'test_impact') ? testImpact : input.implementationBrief.test_impact,
    },
  };
}

function appendTelemetry(filePath, event) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fd = fs.openSync(filePath, 'a', 0o600);
    try { fs.writeSync(fd, `${JSON.stringify(event)}\n`); } finally { fs.closeSync(fd); }
  } catch { /* Context routing telemetry must not affect handoff behavior. */ }
}

export async function routeScoutingContext(input, options = {}) {
  const enabled = options.enabled === true;
  const redact = typeof options.redact === 'function' ? options.redact : value => value;
  const { items } = candidateItems(input, redact);
  const protectedItems = items.filter(item => item.protected);
  const candidates = items.filter(item => !item.protected).slice(0, MAX_CANDIDATES);
  const overflow = items.filter(item => !item.protected).slice(MAX_CANDIDATES);
  const thresholds = {
    discard: Number.isFinite(options.discardThreshold) && options.discardThreshold >= 0 && options.discardThreshold <= 1
      ? options.discardThreshold
      : DEFAULT_DISCARD_THRESHOLD,
    condense: Number.isFinite(options.condenseThreshold) && options.condenseThreshold >= 0 && options.condenseThreshold <= 1
      ? options.condenseThreshold
      : DEFAULT_CONDENSE_THRESHOLD,
  };
  const selections = new Map(items.map(item => [item.id, 'preserve']));
  const state = {
    phase_from: options.phaseFrom || 'scouting',
    phase_to: 'coding',
    goal_summary: String(redact(input.goalSummary || '') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GOAL_CHARS),
    candidates: candidates.map(({ id, kind, path: itemPath, text }) => ({ id, kind, ...(itemPath ? { path: itemPath.slice(0, 256) } : {}), text })),
  };
  let attempted = false; let failed = false; let latencyMs = 0;
  if (enabled && candidates.length && typeof options.classify === 'function') {
    attempted = true;
    const started = performance.now();
    try {
      const questions = Object.fromEntries(candidates.map(candidate => [candidate.id, makeQuestion()]));
      const result = await options.classify(state, questions);
      latencyMs = Math.round(performance.now() - started);
      const candidateSelections = new Map();
      for (const candidate of candidates) {
        const route = interpretAnswer(result?.answers?.[candidate.id], thresholds);
        if (!route) throw new Error('JEV returned an invalid phase-transfer answer');
        candidateSelections.set(candidate.id, route);
      }
      for (const [id, route] of candidateSelections) selections.set(id, route);
    } catch {
      failed = true;
      latencyMs = Math.round(performance.now() - started);
    }
  } else if (enabled && candidates.length) failed = typeof options.classify !== 'function';

  // Protected candidates and candidates beyond the bounded request cap remain intact.
  for (const candidate of [...protectedItems, ...overflow]) selections.set(candidate.id, 'preserve');
  const output = applySelections(input, items, selections);
  const beforeChars = JSON.stringify({ inspectedFiles: input.inspectedFiles, implementationBrief: input.implementationBrief }).length;
  const afterChars = JSON.stringify(output).length;
  const metrics = {
    status: !enabled ? 'disabled' : failed ? 'unavailable' : candidates.length ? 'completed' : 'no_candidates',
    candidateCount: items.length,
    evaluatedItems: attempted && !failed ? candidates.length : 0,
    protectedItems: protectedItems.length,
    preservedItems: [...selections.values()].filter(value => value === 'preserve').length,
    condensedItems: [...selections.values()].filter(value => value === 'condense').length,
    discardedItems: [...selections.values()].filter(value => value === 'discard').length,
    jevRequests: attempted ? 1 : 0,
    jevFailures: failed ? 1 : 0,
    estimatedInputTokens: Math.ceil(beforeChars / 4),
    estimatedOutputTokens: Math.ceil(afterChars / 4),
    estimatedTokensSaved: Math.max(0, Math.ceil(beforeChars / 4) - Math.ceil(afterChars / 4)),
    latencyMs,
  };
  appendTelemetry(options.telemetryPath, {
    timestamp: new Date().toISOString(),
    event_type: 'phase_transfer',
    phase_from: options.phaseFrom || 'scouting',
    phase_to: 'coding',
    status: metrics.status,
    candidate_count: metrics.candidateCount,
    evaluated_items: metrics.evaluatedItems,
    protected_items: metrics.protectedItems,
    preserved_items: metrics.preservedItems,
    condensed_items: metrics.condensedItems,
    discarded_items: metrics.discardedItems,
    jev_requests: metrics.jevRequests,
    jev_failures: metrics.jevFailures,
    estimated_input_tokens: metrics.estimatedInputTokens,
    estimated_output_tokens: metrics.estimatedOutputTokens,
    estimated_tokens_saved: metrics.estimatedTokensSaved,
    latency_ms: metrics.latencyMs,
  });
  return { ...output, metrics };
}
