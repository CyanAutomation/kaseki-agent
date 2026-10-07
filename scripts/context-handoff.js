#!/usr/bin/env node
// Deterministic, bounded contract shared by every downstream phase.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = value => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const unique = (values, limit, chars) => {
  const seen = new Set(); let used = 0; const output = [];
  for (const raw of values) {
    const value = normalize(raw); const identity = key(value);
    if (!identity || seen.has(identity)) continue;
    const clipped = value.slice(0, Math.min(600, chars - used));
    if (!clipped || used + clipped.length > chars) break;
    seen.add(identity); output.push(clipped); used += clipped.length;
    if (output.length === limit) break;
  }
  return output;
};

export const strings = (value, matches, hint = '', inherited = false, out = []) => {
  const selected = inherited || matches(hint);
  if (typeof value === 'string' && selected) out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, matches, hint, selected, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => strings(v, matches, k, selected, out));
  return out;
};

const requirementField = name => /^(objective|requirements?|constraints?|criteria|success_criteria|acceptance(?:_criteria)?|must|retry|missing|anti_patterns?)$/i.test(name);
const constraintField = name => /^(constraints?|anti_patterns?|boundaries|do_not_modify|out_of_scope)$/i.test(name);
const unresolvedField = name => /^(unresolved(?:_questions?)?|open_questions?|unknowns?)$/i.test(name);
const arrayStrings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];

export const buildContextHandoff = async (resultsDir, phase, completionCondition, environment = process.env, dependencies = {}) => {
  if (!resultsDir || !phase || !completionCondition) throw new Error('usage: context-handoff.js RESULTS PHASE COMPLETION_CONDITION');
  const read = name => { try { return fs.readFileSync(path.join(resultsDir, name), 'utf8'); } catch { return ''; } };
  const json = name => { try { return JSON.parse(read(name)); } catch { return null; } };
  const task = environment.TASK_PROMPT_VALUE || '';
  const goal = json('goal-setting.json'); const scout = json('scouting.json'); const prior = json('context-handoff.json');
  const requirementCandidates = [...task.split(/\n+|;\s+/), ...strings(goal, requirementField), ...strings(scout, requirementField), ...(environment.RETRY_FEEDBACK_VALUE || '').split(/\n+|;\s+/)];
  const requirements = unique(requirementCandidates, 20, 6000);
  const constraintCandidates = [...strings(goal, constraintField), ...strings(scout, constraintField), ...requirementCandidates.filter(x => /\b(must|only|never|do not|constraint|budget|bounded)\b/i.test(String(x)))];
  const relevant = Array.isArray(scout?.relevant_files) ? scout.relevant_files : [];
  const inspected = relevant.map(item => typeof item === 'string' ? { path: item, facts: [] } : ({
    path: normalize(item?.path), facts: unique([item?.reason, ...(item?.facts || [])], 4, 800),
  })).filter(x => x.path).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40);
  const changed = unique(read('changed-files.txt').split(/\r?\n/), 100, 5000).sort();
  const validation = unique(read('validation-timings.tsv').split(/\r?\n/).slice(1).map(line => {
    const [command, duration, exitCode] = line.split('\t'); return command ? `${command}: exit ${exitCode || 'unknown'} (${duration || '?'}s)` : '';
  }), 30, 4000);
  const unresolved = unique([...(prior?.unresolved_questions || []), ...strings(scout, unresolvedField), ...(environment.UNRESOLVED_VALUE || '').split('\n')], 12, 2400);
  const critical = scout?.critical_change_expectations || scout?.criticalChangeExpectations || {};
  const transferEnabled = phase === 'scouting'
    && dependencies.enabled !== false
    && environment.KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED !== '0'
    && environment.KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED !== '0';
  const threshold = (name, fallback) => {
    const value = Number.parseFloat(environment[name] || '');
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
  };
  const testImpact = Array.isArray(scout?.test_impact) ? scout.test_impact.slice(0, 20).map(item => typeof item === 'string' ? item : ({
    path: normalize(item?.path), reason: normalize(item?.reason),
  })).filter(item => typeof item === 'string' ? item : item.path || item.reason) : [];
  // Preserve the evidence needed to act without asking the coding agent to
  // reread large scouting artefacts. This is deliberately semantic rather
  // than file-type based: the scout decides the task's relevant paths.
  const implementationBrief = {
    observations: unique(arrayStrings(scout?.observations), 6, 1600),
    plan: unique(arrayStrings(scout?.plan), 6, 1800),
    required_files: unique(arrayStrings(critical.required_files || critical.requiredFiles), 12, 1200),
    protected_files: unique(arrayStrings(critical.no_change_files || critical.noChangeFiles), 20, 1800),
    ...(transferEnabled ? { test_impact: testImpact } : {}),
  };
  let transfer;
  if (phase === 'scouting') {
    try {
      transfer = await (await import('./semantic-phase-transfer.js')).routeScoutingContext({
        inspectedFiles: inspected,
        implementationBrief: { ...implementationBrief, test_impact: testImpact },
        goalSummary: normalize(goal?.upgraded_goal || goal?.objective || goal?.goal || ''),
        taskPrompt: task,
      }, {
        ...dependencies,
        enabled: transferEnabled,
        phaseFrom: phase,
        discardThreshold: threshold('KASEKI_SEMANTIC_CONTEXT_DISCARD_THRESHOLD', 0.98),
        condenseThreshold: threshold('KASEKI_SEMANTIC_CONTEXT_CONDENSE_THRESHOLD', 0.7),
        telemetryPath: dependencies.telemetryPath || path.join(resultsDir, 'caveman-routing.jsonl'),
      });
    } catch { /* Any semantic-routing failure leaves the complete handoff intact. */ }
  }
  const transferredInspected = transferEnabled ? transfer?.inspectedFiles || inspected : inspected;
  const transferredBrief = transferEnabled ? transfer?.implementationBrief || implementationBrief : implementationBrief;
  const artifacts = ['goal-setting.json','scouting.json','goal-check.json','changed-files.txt','git.diff','validation.log','pre-validation-timings.tsv','validation-timings.tsv','stage-timings.tsv','progress.jsonl','dependency-cache.log','metadata.json','pi-summary.json']
    .filter(name => fs.existsSync(path.join(resultsDir, name))).sort().map(name => path.join(resultsDir, name));
  const handoff = {
    schema_version: 1, phase_completed: phase, requirements,
    constraints: unique(constraintCandidates, 12, 3000), implementation_brief: transferredBrief, inspected_files: transferredInspected,
    changed_files: changed, validation_outcomes: validation, unresolved_questions: unresolved,
    next_phase_completion_condition: normalize(completionCondition).slice(0, 1200), artifact_paths: artifacts,
    section_budgets_chars: { requirements: 6000, constraints: 3000, implementation_brief: 6400, inspected_files: 12000, changed_files: 5000, validation_outcomes: 4000, unresolved_questions: 2400, next_phase_completion_condition: 1200 },
    ...(transferEnabled && transfer ? { semantic_transfer: {
      status: transfer.metrics.status,
      candidate_count: transfer.metrics.candidateCount,
      evaluated_items: transfer.metrics.evaluatedItems,
      protected_items: transfer.metrics.protectedItems,
      preserved_items: transfer.metrics.preservedItems,
      condensed_items: transfer.metrics.condensedItems,
      discarded_items: transfer.metrics.discardedItems,
      jev_requests: transfer.metrics.jevRequests,
      jev_failures: transfer.metrics.jevFailures,
      estimated_input_tokens: transfer.metrics.estimatedInputTokens,
      estimated_output_tokens: transfer.metrics.estimatedOutputTokens,
      estimated_tokens_saved: transfer.metrics.estimatedTokensSaved,
      latency_ms: transfer.metrics.latencyMs,
    } } : {}),
  };
  fs.writeFileSync(path.join(resultsDir, 'context-handoff.json'), `${JSON.stringify(handoff, null, 2)}\n`);
  const originalCount = requirementCandidates.filter(normalize).length;
  const diagnostics = { phase, artifact: 'context-handoff.json', sections: {}, duplication: { candidates: originalCount, unique: requirements.length, removed: Math.max(0, originalCount - requirements.length), estimate_ratio: originalCount ? Number((1 - requirements.length / originalCount).toFixed(3)) : 0 } };
  for (const [name, value] of Object.entries(handoff)) { const chars = JSON.stringify(value).length; diagnostics.sections[name] = { chars, estimated_tokens: Math.ceil(chars / 4) }; }
  fs.appendFileSync(path.join(resultsDir, 'prompt-section-diagnostics.jsonl'), `${JSON.stringify(diagnostics)}\n`);
  return handoff;
};

async function runCli() {
  if (!process.argv[1] || path.basename(process.argv[1]) !== 'context-handoff.js') return;
  const appRoot = [process.env.KASEKI_APP_ROOT, process.cwd(), '/app']
    .find(root => root && fs.existsSync(path.join(root, 'dist/jev-classifier.js')))
    || process.env.KASEKI_APP_ROOT || process.cwd();
  let dependencies = {};
  if (process.argv[3] === 'scouting'
    && process.env.KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED !== '0'
    && process.env.KASEKI_SEMANTIC_PHASE_TRANSFER_ENABLED !== '0') {
    try {
      const [classifier, redaction] = await Promise.all([
        import(pathToFileURL(path.join(appRoot, 'dist/jev-classifier.js')).href),
        import(pathToFileURL(path.join(appRoot, 'dist/jev-evidence-redaction.js')).href),
      ]);
      const timeout = Number.parseInt(process.env.KASEKI_CAVEMAN_ROUTER_TIMEOUT_MS || '1200', 10);
      dependencies = {
        classify: (state, questions) => classifier.classifyWithJev(state, questions, {
          timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 1200,
          maxRetries: 0,
        }),
        redact: redaction.redactJevEvidence,
      };
    } catch { /* Missing classifier modules leave all scouting facts in the handoff. */ }
  }
  await buildContextHandoff(...process.argv.slice(2), process.env, dependencies);
}

void runCli();
