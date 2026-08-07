#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TokenUsageAggregator, UsageObject } from './pi-event-aggregation/token-usage-aggregator';

export const DEFAULT_RUBRIC_VERSION = '1.0';
export interface ScorecardConfig { rubricVersion: string; targets: { elapsedSeconds: number; tokens: number; retries: number } }
export interface ArtifactSnapshot { json: Record<string, unknown>; text: Record<string, string>; summaries: unknown[] }
export interface Evidence { status: string; elapsedSeconds?: number; tokens?: number; unknownTokenRequests: number; retries: number; validation: 'passed'|'failed'|'unknown'; quality: 'passed'|'failed'|'unknown'; goalMet?: boolean; changedFiles: number; diffBytes: number; evaluation?: Record<string, unknown>; present: string[] }
export interface Dimension { score: number; weight: number; evidence: string[] }
export interface RunScorecard { schema_version: 1; rubric_version: string; generated_at: string; status: string; score: number; grade: string; confidence: number; coverage: { ratio: number; observed: number; possible: number; missing: string[] }; dimensions: Record<string, Dimension>; usage: { total_tokens: number|null; unknown_requests: number; semantics: string }; evidence: Evidence; targets: ScorecardConfig['targets'] }

const object = (v: unknown): Record<string, unknown>|undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const number = (v: unknown): number|undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean|undefined => typeof v === 'boolean' ? v : undefined;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function normalizeConfig(env: NodeJS.ProcessEnv): ScorecardConfig {
  const positive = (name: string, fallback: number) => { const v = Number(env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
  return { rubricVersion: env.KASEKI_SCORECARD_RUBRIC_VERSION?.trim() || DEFAULT_RUBRIC_VERSION, targets: { elapsedSeconds: positive('KASEKI_SCORECARD_TARGET_SECONDS', 1800), tokens: positive('KASEKI_SCORECARD_TARGET_TOKENS', 200000), retries: positive('KASEKI_SCORECARD_TARGET_RETRIES', 2) } };
}

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const goal = object(snapshot.json['goal-check.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']);
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const stageElapsed = stageRows.reduce((n, row) => n + (number(object(row)?.elapsed_seconds) ?? 0), 0);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.elapsed_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const validationRows = [...(Array.isArray(timing.validation_timings) ? timing.validation_timings : []), ...(Array.isArray(timing.pre_validation_timings) ? timing.pre_validation_timings : [])];
  const validation = validationRows.length ? (validationRows.every(r => (number(object(r)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed') : statusFrom(metadata, ['validation_exit', 'validation_status']);
  const quality = statusFrom(metadata, ['quality_exit', 'quality_status']);
  const aggregator = new TokenUsageAggregator();
  const identities = new Set<string>();
  let unknown = 0;
  snapshot.summaries.forEach((raw, index) => {
    const summary = object(raw); if (!summary) return;
    const phase = String(summary.phase ?? summary.stage ?? 'unknown');
    const request = String(summary.request_id ?? summary.response_id ?? summary.id ?? index);
    const identity = `${phase}:${request}`;
    if (identities.has(identity)) return;
    identities.add(identity);
    const usage = object(summary.usage) ?? object(summary.token_usage) ?? (hasUsage(summary) ? summary : undefined);
    if (!usage || !hasUsage(usage)) { unknown += 1; return; }
    aggregator.setCurrentPhase(phase);
    aggregator.recordUsage(String(summary.model ?? summary.selected_model ?? 'unknown'), usage as UsageObject);
  });
  const total = aggregator.getSummary().total_tokens;
  const changed = (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length;
  const status = String(metadata.status ?? metadata.run_status ?? (bool(goal.met) ? 'completed' : 'unknown'));
  const retryText = Object.entries(snapshot.text).filter(([k]) => /attempt|retry|restoration/.test(k)).map(([,v]) => v).join('\n');
  const retryJson = Object.entries(snapshot.json).filter(([k]) => /attempt|retry|restoration/.test(k)).length;
  return { status, elapsedSeconds: elapsed, tokens: total || undefined, unknownTokenRequests: unknown, retries: Math.max(retryJson, (retryText.match(/retry|attempt/gi) ?? []).length), validation, quality, goalMet: bool(goal.met), changedFiles: changed, diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)] };
}

function hasUsage(v: Record<string, unknown>): boolean { return ['prompt_tokens','completion_tokens','input','output','cacheRead','cacheWrite'].some(k => number(v[k]) !== undefined) || object(v.prompt_tokens_details) !== undefined; }
function statusFrom(metadata: Record<string, unknown>, keys: string[]): 'passed'|'failed'|'unknown' { for (const k of keys) { const v=metadata[k]; if (v === 0 || v === true || v === 'passed' || v === 'success') return 'passed'; if (typeof v === 'number' || v === false || v === 'failed') return 'failed'; } return 'unknown'; }
const efficiency = (actual: number|undefined, target: number) => actual === undefined ? 50 : clamp(100 * Math.min(1, target / Math.max(1, actual)));

/** Qualitative evaluator input is deliberately limited to the documented 1-5 numeric mappings below. */
export function scoreDimensions(e: Evidence, c: ScorecardConfig): Record<string, Dimension> {
  const evalScore = (keys: string[]) => { for (const key of keys) { const v=number(e.evaluation?.[key]); if (v !== undefined && v >= 1 && v <= 5) return v * 20; } return undefined; };
  const completionObjective = e.goalMet === true ? 100 : e.goalMet === false ? 0 : (e.status === 'completed' || e.status === 'success' ? 70 : 30);
  const completionQualitative = evalScore(['task_completion_score']);
  const validation = e.validation === 'passed' ? 100 : e.validation === 'failed' ? 0 : 50;
  const qualityQualitative = evalScore(['code_quality_score','quality_score']);
  return {
    completion: { score: clamp(completionObjective * .8 + (completionQualitative ?? completionObjective) * .2), weight: .4, evidence: ['goal-check.met/run status', 'run-evaluation.task_completion_score (20%)'] },
    correctness: { score: validation, weight: .25, evidence: ['validation timing/status artifacts'] },
    quality: { score: clamp((e.quality === 'passed' ? 100 : e.quality === 'failed' ? 0 : 50) * .8 + (qualityQualitative ?? 50) * .2), weight: .15, evidence: ['quality-gate status', 'run-evaluation code_quality_score (20%)'] },
    efficiency: { score: clamp((efficiency(e.elapsedSeconds,c.targets.elapsedSeconds)+efficiency(e.tokens,c.targets.tokens)+efficiency(e.retries,c.targets.retries))/3), weight: .2, evidence: ['elapsed time, token usage, retries'] },
  };
}
export function weightDimensions(d: Record<string, Dimension>): number { return clamp(Object.values(d).reduce((n,x)=>n+x.score*x.weight,0) / Object.values(d).reduce((n,x)=>n+x.weight,0)); }
export function assignGrade(score: number): string { return score >= 90?'A':score>=80?'B':score>=70?'C':score>=60?'D':'F'; }
export function calculateCoverage(e: Evidence): RunScorecard['coverage'] { const fields: Array<[string,boolean]>=[['metadata',e.present.includes('metadata.json')],['timings',e.elapsedSeconds!==undefined],['tokens',e.tokens!==undefined],['validation',e.validation!=='unknown'],['quality gates',e.quality!=='unknown'],['goal check',e.goalMet!==undefined],['changes',e.present.includes('changed-files.txt')||e.present.includes('git.diff')],['evaluation',!!e.evaluation]]; const missing=fields.filter(([,v])=>!v).map(([k])=>k); return {ratio:Number(((fields.length-missing.length)/fields.length).toFixed(3)),observed:fields.length-missing.length,possible:fields.length,missing}; }
export function buildScorecard(e: Evidence, c: ScorecardConfig, now=new Date()): RunScorecard { const dimensions=scoreDimensions(e,c); const score=weightDimensions(dimensions); const coverage=calculateCoverage(e); return {schema_version:1,rubric_version:c.rubricVersion,generated_at:now.toISOString(),status:e.status,score,grade:assignGrade(score),confidence:clamp(coverage.ratio*100*(e.unknownTokenRequests?0.9:1)),coverage,dimensions,usage:{total_tokens:e.tokens??null,unknown_requests:e.unknownTokenRequests,semantics:'TokenUsageAggregator (input + output + cache creation + cache read)'},evidence:e,targets:c.targets}; }

export function readArtifactSnapshot(dir: string): ArtifactSnapshot {
  const json: Record<string, unknown>={}, text: Record<string,string>={};
  const jsonNames=['metadata.json','timings-manifest.json','all-phase-summaries.json','performance-metrics.json','goal-setting.json','scouting.json','goal-check.json','run-evaluation.json','quality-gates.json','validation-status.json','restoration.json','retry-diagnostics.json'];
  for (const name of jsonNames) try { json[name]=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')) as unknown; } catch { /* optional/malformed evidence remains uncovered */ }
  for (const name of ['stage-timings.tsv','validation-timings.tsv','pre-validation-timings.tsv','quality-gate-timings.tsv','changed-files.txt','git.diff','provider-attempts.jsonl','restoration.jsonl']) try { text[name]=fs.readFileSync(path.join(dir,name),'utf8'); } catch { /* optional */ }
  const consolidated=object(json['all-phase-summaries.json']);
  const summaries=Array.isArray(consolidated?.phases) ? consolidated.phases : [];
  if (!summaries.length) for (const name of fs.readdirSync(dir).filter(n=>n.endsWith('-summary.json'))) try { summaries.push(JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))); } catch { /* optional */ }
  return {json,text,summaries};
}
export function writeAtomic(file: string, value: unknown): void { const temp=`${file}.tmp-${process.pid}`; fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o644}); fs.renameSync(temp,file); }
export function main(): void { const dir=process.env.KASEKI_RESULTS_DIR ?? process.argv[2]; if (!dir) throw new Error('KASEKI_RESULTS_DIR or results directory argument is required'); const snapshot=readArtifactSnapshot(dir); if (!snapshot.json['metadata.json'] && !snapshot.text['stage-timings.tsv']) throw new Error('insufficient metadata or timing evidence'); writeAtomic(path.join(dir,'run-scorecard.json'),buildScorecard(collectEvidence(snapshot),normalizeConfig(process.env))); }
if (process.argv[1] && /^run-scorecard\.(?:js|ts)$/.test(path.basename(process.argv[1]))) { try { main(); } catch (error) { console.error(JSON.stringify({level:'warning',code:'scorecard_generation_failed',message:error instanceof Error?error.message:String(error)})); process.exitCode=1; } }
