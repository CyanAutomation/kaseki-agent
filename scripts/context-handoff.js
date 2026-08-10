#!/usr/bin/env node
// Deterministic, bounded contract shared by every downstream phase.
import fs from 'node:fs';
import path from 'node:path';

const [resultsDir, phase, completionCondition] = process.argv.slice(2);
if (!resultsDir || !phase || !completionCondition) throw new Error('usage: context-handoff.js RESULTS PHASE COMPLETION_CONDITION');
const read = name => { try { return fs.readFileSync(path.join(resultsDir, name), 'utf8'); } catch { return ''; } };
const json = name => { try { return JSON.parse(read(name)); } catch { return null; } };
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = value => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const unique = (values, limit, chars) => {
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
const strings = (value, hint = '', out = []) => {
  if (typeof value === 'string' && /(objective|require|constraint|criteria|acceptance|must|success|retry|missing)/i.test(hint)) out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, hint, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => strings(v, k, out));
  return out;
};
const task = process.env.TASK_PROMPT_VALUE || '';
const goal = json('goal-setting.json'); const scout = json('scouting.json'); const prior = json('context-handoff.json');
const requirementCandidates = [...task.split(/\n+|;\s+/), ...strings(goal), ...strings(scout), ...(process.env.RETRY_FEEDBACK_VALUE || '').split(/\n+|;\s+/)];
const requirements = unique(requirementCandidates, 20, 6000);
const relevant = Array.isArray(scout?.relevant_files) ? scout.relevant_files : [];
const inspected = relevant.map(item => typeof item === 'string' ? { path: item, facts: [] } : ({
  path: normalize(item?.path), facts: unique([item?.reason, ...(item?.facts || [])], 4, 800),
})).filter(x => x.path).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 40);
const changed = unique(read('changed-files.txt').split(/\r?\n/), 100, 5000).sort();
const validation = unique(read('validation-timings.tsv').split(/\r?\n/).slice(1).map(line => {
  const [command, duration, exitCode] = line.split('\t'); return command ? `${command}: exit ${exitCode || 'unknown'} (${duration || '?'}s)` : '';
}), 30, 4000);
const unresolved = unique([...(prior?.unresolved_questions || []), ...strings(scout, 'unresolved'), ...(process.env.UNRESOLVED_VALUE || '').split('\n')], 12, 2400);
const artifacts = ['goal-setting.json','scouting.json','changed-files.txt','git.diff','validation.log','validation-timings.tsv','pi-summary.json']
  .filter(name => fs.existsSync(path.join(resultsDir, name))).sort().map(name => path.join(resultsDir, name));
const handoff = {
  schema_version: 1,
  phase_completed: phase,
  requirements,
  constraints: unique(requirementCandidates.filter(x => /\b(must|only|never|do not|constraint|budget|bounded)\b/i.test(String(x))), 12, 3000),
  inspected_files: inspected,
  changed_files: changed,
  validation_outcomes: validation,
  unresolved_questions: unresolved,
  next_phase_completion_condition: normalize(completionCondition).slice(0, 1200),
  artifact_paths: artifacts,
  section_budgets_chars: { requirements: 6000, constraints: 3000, inspected_files: 12000, changed_files: 5000, validation_outcomes: 4000, unresolved_questions: 2400, next_phase_completion_condition: 1200 },
};
fs.writeFileSync(path.join(resultsDir, 'context-handoff.json'), `${JSON.stringify(handoff, null, 2)}\n`);
const originalCount = requirementCandidates.filter(normalize).length;
const diagnostics = { phase, artifact: 'context-handoff.json', sections: {}, duplication: { candidates: originalCount, unique: requirements.length, removed: Math.max(0, originalCount - requirements.length), estimate_ratio: originalCount ? Number((1 - requirements.length / originalCount).toFixed(3)) : 0 } };
for (const [name, value] of Object.entries(handoff)) { const chars = JSON.stringify(value).length; diagnostics.sections[name] = { chars, estimated_tokens: Math.ceil(chars / 4) }; }
fs.appendFileSync(path.join(resultsDir, 'prompt-section-diagnostics.jsonl'), `${JSON.stringify(diagnostics)}\n`);
