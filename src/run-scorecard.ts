#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { RunScorecardSchema, type RunScorecard } from './types/run-scorecard';
import { TokenUsageAggregator, type UsageObject } from './pi-event-aggregation/token-usage-aggregator';

export const DEFAULT_RUBRIC_VERSION = '1.0';
const PHASES = ['goal_setting', 'scouting', 'coding', 'validation', 'goal_check', 'run_evaluation'] as const;
const DIMENSIONS = ['goal_quality', 'scouting_quality', 'implementation_quality', 'validation_quality', 'goal_attainment', 'evaluation_quality'] as const;
export interface ScorecardConfig { rubricVersion: string; targets: { elapsedSeconds: number; tokens: number; retries: number } }
export interface ArtifactSnapshot { json: Record<string, unknown>; text: Record<string, string>; summaries: unknown[] }
export interface Evidence { metadata: Record<string, unknown>; status: RunScorecard['lifecycle_status']; elapsedSeconds?: number; tokens?: number; tokenUsage: RunScorecard['token_totals']; phaseTokens: Record<string, RunScorecard['token_totals']>; unknownTokenRequests: number; retries: number; validation: 'passed'|'failed'|'unknown'; quality: 'passed'|'failed'|'unknown'; goalMet?: boolean; changedFiles: number; diffBytes: number; evaluation?: Record<string, unknown>; present: string[] }
export interface Dimension { score: number; weight: number; evidence: string[] }

const object = (v: unknown): Record<string, unknown>|undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const number = (v: unknown): number|undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const bool = (v: unknown): boolean|undefined => typeof v === 'boolean' ? v : undefined;
const string = (v: unknown): string|undefined => typeof v === 'string' && v.length > 0 ? v : undefined;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function normalizeConfig(env: NodeJS.ProcessEnv): ScorecardConfig {
  const positive = (name: string, fallback: number) => { const v = Number(env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
  return { rubricVersion: env.KASEKI_SCORECARD_RUBRIC_VERSION?.trim() || DEFAULT_RUBRIC_VERSION, targets: { elapsedSeconds: positive('KASEKI_SCORECARD_TARGET_SECONDS', 1800), tokens: positive('KASEKI_SCORECARD_TARGET_TOKENS', 200000), retries: positive('KASEKI_SCORECARD_TARGET_RETRIES', 2) } };
}

function normalizedUsage(raw: Record<string, unknown>): UsageObject {
  return {
    prompt_tokens: number(raw.prompt_tokens) ?? number(raw.total_input_tokens),
    completion_tokens: number(raw.completion_tokens) ?? number(raw.total_output_tokens),
    input: number(raw.input), output: number(raw.output),
    cacheRead: number(raw.cacheRead) ?? number(raw.total_cache_read_tokens),
    cacheWrite: number(raw.cacheWrite) ?? number(raw.total_cache_creation_tokens),
    prompt_tokens_details: object(raw.prompt_tokens_details) as UsageObject['prompt_tokens_details'],
  };
}
function hasUsage(v: UsageObject): boolean { return [v.prompt_tokens,v.completion_tokens,v.input,v.output,v.cacheRead,v.cacheWrite].some(x => number(x) !== undefined) || v.prompt_tokens_details !== undefined; }
function tokenRecord(summary: ReturnType<TokenUsageAggregator['getSummary']>, unknown: number): RunScorecard['token_totals'] {
  const unavailable = summary.total_tokens === 0;
  return { input_tokens: summary.total_input_tokens, output_tokens: summary.total_output_tokens, cache_read_tokens: summary.total_cache_read_tokens, cache_write_tokens: summary.total_cache_creation_tokens, unknown_tokens: unknown, unavailable, completeness: unavailable ? 'unavailable' : (unknown > 0 ? 'provisional' : 'complete') };
}
function lifecycle(metadata: Record<string, unknown>): RunScorecard['lifecycle_status'] {
  const explicit = metadata.lifecycle_status ?? metadata.status ?? metadata.run_status;
  if (['queued','running','completed','failed','cancelled','timed_out'].includes(String(explicit))) return explicit as RunScorecard['lifecycle_status'];
  const terminal = String(metadata.terminal_state ?? metadata.current_stage ?? '').toLowerCase();
  if (terminal.includes('cancel')) return 'cancelled';
  if (terminal.includes('timed out') || terminal.includes('timeout')) return 'timed_out';
  const exit = number(metadata.exit_code);
  return exit === undefined ? 'running' : exit === 0 ? 'completed' : 'failed';
}

export function collectEvidence(snapshot: ArtifactSnapshot): Evidence {
  const metadata = object(snapshot.json['metadata.json']) ?? {};
  const timing = object(snapshot.json['timings-manifest.json']) ?? {};
  const perf = object(snapshot.json['performance-metrics.json']) ?? {};
  const goal = object(snapshot.json['goal-check.json']) ?? {};
  const evaluation = object(snapshot.json['run-evaluation.json']);
  const stageRows = Array.isArray(timing.stage_timings) ? timing.stage_timings : [];
  const stageElapsed = stageRows.reduce((n, row) => n + (number(object(row)?.elapsed_seconds) ?? 0), 0);
  const elapsed = number(perf.elapsed_seconds) ?? number(metadata.total_duration_seconds) ?? number(metadata.duration_seconds) ?? (stageElapsed || undefined);
  const validationRows = [...(Array.isArray(timing.validation_timings) ? timing.validation_timings : []), ...(Array.isArray(timing.pre_validation_timings) ? timing.pre_validation_timings : [])];
  const validation = validationRows.length ? (validationRows.every(r => (number(object(r)?.exit_code) ?? 0) === 0) ? 'passed' : 'failed') : statusFrom(metadata, ['validation_exit_code','validation_exit','validation_status']);
  const quality = statusFrom(metadata, ['quality_exit_code','quality_exit','quality_status'], object(metadata.phases)?.quality_gates);
  const aggregator = new TokenUsageAggregator(); const identities = new Set<string>(); let unknown = 0;
  snapshot.summaries.forEach((raw, index) => {
    const summary = object(raw); if (!summary) return;
    const phase = canonicalPhase(String(summary.phase ?? summary.stage ?? 'coding'));
    const identity = `${phase}:${String(summary.request_id ?? summary.response_id ?? summary.id ?? index)}`;
    if (identities.has(identity)) return; identities.add(identity);
    const rawUsage = object(summary.usage) ?? object(summary.token_usage) ?? summary;
    const usage = normalizedUsage(rawUsage);
    if (!hasUsage(usage)) { unknown += 1; return; }
    aggregator.setCurrentPhase(phase); aggregator.recordUsage(String(summary.model ?? summary.selected_model ?? 'unknown'), usage);
  });
  const totals = aggregator.getSummary(); const phaseStats = aggregator.getPhaseStats(); const phaseTokens: Evidence['phaseTokens'] = {};
  for (const [phase, usage] of Object.entries(phaseStats)) phaseTokens[phase] = { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cache_read_tokens: usage.cache_read_tokens, cache_write_tokens: usage.cache_creation_tokens, unknown_tokens: 0, unavailable: false, completeness: 'complete' };
  const retryText = Object.entries(snapshot.text).filter(([k]) => /attempt|retry|restoration/.test(k)).map(([,v]) => v).join('\n');
  return { metadata, status: lifecycle(metadata), elapsedSeconds: elapsed, tokens: totals.total_tokens || undefined, tokenUsage: tokenRecord(totals, unknown), phaseTokens, unknownTokenRequests: unknown, retries: Math.max(Object.keys(snapshot.json).filter(k => /attempt|retry|restoration/.test(k)).length, (retryText.match(/retry|attempt/gi) ?? []).length), validation, quality, goalMet: bool(goal.met) ?? bool(metadata.goal_check_met), changedFiles: (snapshot.text['changed-files.txt'] ?? '').split(/\r?\n/).filter(Boolean).length, diffBytes: Buffer.byteLength(snapshot.text['git.diff'] ?? ''), evaluation, present: [...Object.keys(snapshot.json), ...Object.keys(snapshot.text)] };
}
function canonicalPhase(value: string): typeof PHASES[number] { const normalized=value.toLowerCase().replace(/[- ]/g,'_'); return (PHASES as readonly string[]).includes(normalized) ? normalized as typeof PHASES[number] : 'coding'; }
function statusFrom(metadata: Record<string, unknown>, keys: string[], nested?: unknown): 'passed'|'failed'|'unknown' { const values=[...keys.map(k=>metadata[k]),object(nested)?.exit_code]; for (const v of values) { if (v === 0 || v === true || v === 'passed' || v === 'success') return 'passed'; if (typeof v === 'number' || v === false || v === 'failed') return 'failed'; } return 'unknown'; }
const efficiency = (actual: number|undefined, target: number) => actual === undefined ? 50 : clamp(100 * Math.min(1, target / Math.max(1, actual)));

export function scoreDimensions(e: Evidence, c: ScorecardConfig): Record<string, Dimension> {
  const completion = e.goalMet === true ? 100 : e.goalMet === false ? 0 : e.status === 'completed' ? 70 : 30;
  const validation = e.validation === 'passed' ? 100 : e.validation === 'failed' ? 0 : 50;
  const quality = e.quality === 'passed' ? 100 : e.quality === 'failed' ? 0 : 50;
  const efficient = clamp((efficiency(e.elapsedSeconds,c.targets.elapsedSeconds)+efficiency(e.tokens,c.targets.tokens)+efficiency(e.retries,c.targets.retries))/3);
  return { completion:{score:completion,weight:.25,evidence:['goal-check and lifecycle']}, correctness:{score:validation,weight:.25,evidence:['validation result']}, quality:{score:quality,weight:.2,evidence:['quality gate result']}, efficiency:{score:efficient,weight:.3,evidence:['time, tokens, and retries']} };
}
export function weightDimensions(d: Record<string, Dimension>): number { return clamp(Object.values(d).reduce((n,x)=>n+x.score*x.weight,0) / Object.values(d).reduce((n,x)=>n+x.weight,0)); }
export function assignGrade(score: number): RunScorecard['grade'] { return score >= 90?'A':score>=80?'B':score>=70?'C':score>=60?'D':'F'; }
export function calculateCoverage(e: Evidence) { const fields: Array<[string,boolean]>=[['metadata',e.present.includes('metadata.json')],['timings',e.elapsedSeconds!==undefined],['tokens',e.tokens!==undefined],['validation',e.validation!=='unknown'],['quality gates',e.quality!=='unknown'],['goal check',e.goalMet!==undefined],['changes',e.present.includes('changed-files.txt')||e.present.includes('git.diff')],['evaluation',!!e.evaluation]]; const missing=fields.filter(([,v])=>!v).map(([k])=>k); return {ratio:Number(((fields.length-missing.length)/fields.length).toFixed(3)),observed:fields.length-missing.length,possible:fields.length,missing}; }

export function buildScorecard(e: Evidence, c: ScorecardConfig, now=new Date()): RunScorecard {
  const legacy=scoreDimensions(e,c); const score=weightDimensions(legacy); const coverage=calculateCoverage(e); const started=string(e.metadata.started_at) ?? now.toISOString(); const ended=string(e.metadata.ended_at) ?? (['completed','failed','cancelled','timed_out'].includes(e.status) ? now.toISOString() : null);
  const phases = Object.fromEntries(PHASES.map(phase => { const usage=e.phaseTokens[phase] ?? {input_tokens:0,output_tokens:0,cache_read_tokens:0,cache_write_tokens:0,unknown_tokens:0,unavailable:true,completeness:'unavailable' as const}; return [phase,{phase,enabled:true,outcome:e.status==='running'?'not_started':phase==='validation'&&e.validation==='failed'?'failed':'succeeded',started_at:null,ended_at:null,duration_ms:null,token_usage:usage,measurements:{},completeness:usage.unavailable?'provisional':'complete',confidence:usage.unavailable?50:100,evidence:[],warnings:[]}]; })) as unknown as RunScorecard['phases'];
  const baseScores=[legacy.completion.score,70,legacy.quality.score,legacy.correctness.score,legacy.completion.score,e.evaluation?80:50]; const weights=[.2,.1,.25,.2,.2,.05];
  const dimensions: RunScorecard['dimensions']=DIMENSIONS.map((id,i)=>({id,weight:weights[i],effective_weight:weights[i],raw_measurements:{source_score:baseScores[i]},normalized_score:baseScores[i],weighted_points:baseScores[i]*weights[i],status:'complete',rationale:`Score derived from available ${id.replace(/_/g,' ')} evidence.`,evidence:[],warnings:[]}));
  const card: RunScorecard={schema_version:'1.0',rubric_version:c.rubricVersion,run_id:string(e.metadata.instance) ?? string(e.metadata.run_id) ?? 'unknown-run',started_at:started,ended_at:ended,scored_at:now.toISOString(),lifecycle_status:e.status,overall_score:score,grade:assignGrade(score),evidence_coverage:{required:coverage.possible,available:coverage.observed,ratio:coverage.ratio,missing_critical:[...(e.diffBytes||e.changedFiles?[]:['diff' as const]),...(e.validation==='unknown'?['validation_result' as const]:[])]},completeness:coverage.ratio===1?'complete':'provisional',confidence:{score:clamp(coverage.ratio*100*(e.unknownTokenRequests?.9:1)),rationale:`${coverage.observed} of ${coverage.possible} evidence categories are available.`},dimensions,phases,token_totals:e.tokenUsage,timing_totals:{wall_clock_ms:(e.elapsedSeconds??0)*1000,phase_duration_ms:{goal_setting:null,scouting:null,coding:null,validation:null,goal_check:null,run_evaluation:null},completeness:e.elapsedSeconds===undefined?'unavailable':'complete'},scoring_config:{rubric_version:c.rubricVersion,dimension_weights:Object.fromEntries(DIMENSIONS.map((id,i)=>[id,weights[i]])),grade_bands:[['A',90,100],['B',80,89],['C',70,79],['D',60,69],['F',0,59]].map(([grade,minimum_score,maximum_score])=>({grade,minimum_score,maximum_score})) as RunScorecard['scoring_config']['grade_bands'],normalization_rules:{efficiency:{function:'inverse_target_ratio',expression:'min(100, target / actual * 100)',parameters:{token_target:c.targets.tokens,time_target_seconds:c.targets.elapsedSeconds}}},task_size:'custom',selected_targets:{token_budget:Math.round(c.targets.tokens),wall_clock_ms:c.targets.elapsedSeconds*1000,changed_lines:null,rationale:'Configured scorecard targets.'},caps:{missing_diff:80,missing_validation:70,missing_diff_and_validation:60},enabled_phase_reliability_penalty_points:0,disabled_phase_policy:'reweight_eligible_dimensions'},warnings:coverage.missing.map(x=>`Missing evidence: ${x}`)};
  return RunScorecardSchema.parse(card);
}

export function readArtifactSnapshot(dir: string): ArtifactSnapshot { const json:Record<string,unknown>={},text:Record<string,string>={}; for(const name of ['metadata.json','timings-manifest.json','all-phase-summaries.json','performance-metrics.json','goal-setting.json','scouting.json','goal-check.json','run-evaluation.json','quality-gates.json','validation-status.json','restoration.json','retry-diagnostics.json']) try{json[name]=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')) as unknown;}catch{/* optional */} for(const name of ['stage-timings.tsv','validation-timings.tsv','pre-validation-timings.tsv','quality-gate-timings.tsv','changed-files.txt','git.diff','provider-attempts.jsonl','restoration.jsonl']) try{text[name]=fs.readFileSync(path.join(dir,name),'utf8');}catch{/* optional */} const consolidated=object(json['all-phase-summaries.json']); const summaries=Array.isArray(consolidated?.phases)?[...consolidated.phases]:[]; if(!summaries.length) for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('-summary.json'))) try{summaries.push(JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')));}catch{/* optional */} return {json,text,summaries}; }
export function writeAtomic(file:string,value:unknown):void { const temp=`${file}.tmp-${process.pid}`; try { fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o644}); fs.renameSync(temp,file); } catch(error) { try{fs.unlinkSync(temp);}catch{/* absent */} throw error; } }
export function main():void { const dir=process.env.KASEKI_RESULTS_DIR??process.argv[2]; if(!dir) throw new Error('KASEKI_RESULTS_DIR or results directory argument is required'); const snapshot=readArtifactSnapshot(dir); if(!snapshot.json['metadata.json']&&!snapshot.text['stage-timings.tsv']) throw new Error('insufficient metadata or timing evidence'); writeAtomic(path.join(dir,'run-scorecard.json'),buildScorecard(collectEvidence(snapshot),normalizeConfig(process.env))); }
if(process.argv[1]&&/^run-scorecard\.(?:js|ts)$/.test(path.basename(process.argv[1]))){try{main();}catch(error){console.error(JSON.stringify({level:'warning',code:'scorecard_generation_failed',message:error instanceof Error?error.message:String(error)}));process.exitCode=1;}}
