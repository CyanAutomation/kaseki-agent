#!/usr/bin/env node
import fs from 'node:fs';
import { RunScorecardSchema, type RunScorecard } from './types/run-scorecard';

const PHASE_ORDER: Array<keyof RunScorecard['phases']> = ['scouting', 'goal_setting', 'coding', 'validation', 'goal_check', 'run_evaluation'];
const DIMENSION_LABELS: Record<string, string> = {
  goal_quality: 'Goal quality', scouting_quality: 'Scouting quality', implementation_quality: 'Implementation quality',
  validation_quality: 'Validation quality', goal_attainment: 'Goal attainment', evaluation_quality: 'Evaluation quality',
};
const PHASE_LABELS: Record<string, string> = {
  scouting: 'Scouting', goal_setting: 'Analysis / goal setting', coding: 'Coding', validation: 'Validation', goal_check: 'Goal check', run_evaluation: 'Run evaluation',
};
const MAX_ITEM_LENGTH = 180;
const MAX_ITEMS = 3;

/** Sanitize bounded, single-line artifact text for safe Markdown display. */
export function sanitizeScorecardText(value: unknown, limit = MAX_ITEM_LENGTH): string {
  const clean = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/gi, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/gi, '[redacted]')
    .replace(/(?:api|access|auth|bearer|github|openai|secret|token|password|credential)[_-]?(?:key|token|secret|password)?\s*[=:]\s*\S+/gi, '[redacted]')
    .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(0, limit - 3))}...`;
}
const cell = (value: unknown): string => sanitizeScorecardText(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const number = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);
const tokens = (usage: RunScorecard['token_totals']): number => usage.input_tokens + usage.output_tokens + usage.cache_read_tokens + usage.cache_write_tokens;
const duration = (milliseconds: number | null): string => milliseconds === null ? 'unavailable' : `${number(milliseconds / 1000)}s`;
const metrics = (values: Record<string, string | number | boolean | null>): string => Object.entries(values)
  .filter(([key]) => !/(?:prompt|secret|credential|raw|response|evidence|prose)/i.test(key))
  .sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_ITEMS)
  .map(([key, value]) => `${key.replace(/_/g, ' ')}=${value ?? 'unavailable'}`).join(', ') || 'None';

/** Render the canonical, reviewer-safe Markdown representation used by PR and API consumers. */
export function formatRunScorecardMarkdown(input: unknown): string {
  const parsed = RunScorecardSchema.safeParse(input);
  if (!parsed.success) return '> **Scorecard unavailable:** `run-scorecard.json` is missing or malformed.';
  const card = parsed.data;
  const dimensions = [...card.dimensions].sort((a, b) => {
    const ai = Object.keys(DIMENSION_LABELS).indexOf(a.id); const bi = Object.keys(DIMENSION_LABELS).indexOf(b.id);
    return ai - bi;
  });
  const strengths = dimensions.filter(d => d.normalized_score >= 80).slice(0, MAX_ITEMS).map(d => `${DIMENSION_LABELS[d.id]} (${number(d.normalized_score)})`);
  const penalties = dimensions.filter(d => d.normalized_score < 80).sort((a, b) => a.normalized_score - b.normalized_score).slice(0, MAX_ITEMS).map(d => `${DIMENSION_LABELS[d.id]} (${number(d.normalized_score)})`);
  const warnings = [...card.warnings, ...dimensions.flatMap(d => d.warnings)].map(w => sanitizeScorecardText(w)).filter(Boolean).slice(0, MAX_ITEMS);
  const lines = [
    `- **Overall:** ${number(card.overall_score)}/100 (${card.grade})`,
    `- **Rubric:** ${cell(card.rubric_version)}`,
    `- **Evidence coverage:** ${card.evidence_coverage.available}/${card.evidence_coverage.required} (${number(card.evidence_coverage.ratio * 100)}%)`,
    '', '| Dimension | Weight | Score | Weighted points | Status |', '| --- | ---: | ---: | ---: | --- |',
    ...dimensions.map(d => `| ${cell(DIMENSION_LABELS[d.id])} | ${number(d.effective_weight * 100)}% | ${number(d.normalized_score)} | ${number(d.weighted_points)} | ${cell(d.status)} |`),
    '', `- **Elapsed:** ${duration(card.timing_totals.wall_clock_ms)}`,
    `- **Tokens:** ${tokens(card.token_totals)} total (${card.token_totals.input_tokens} input, ${card.token_totals.output_tokens} output, ${card.token_totals.cache_read_tokens} cache read, ${card.token_totals.cache_write_tokens} cache write${card.token_totals.unknown_tokens ? `, ${card.token_totals.unknown_tokens} unknown` : ''})`,
    `- **Strengths:** ${strengths.length ? strengths.join('; ') : 'None identified from bounded score data.'}`,
    `- **Penalties:** ${penalties.length ? penalties.join('; ') : 'None.'}`,
    `- **Warnings:** ${warnings.length ? warnings.join('; ') : 'None.'}`,
    '', '<details><summary>Per-phase breakdown</summary>', '',
    '| Phase | Outcome | Elapsed | Tokens | Metrics | Completeness | Confidence |', '| --- | --- | ---: | ---: | --- | --- | ---: |',
    ...PHASE_ORDER.map(id => { const p = card.phases[id]; return `| ${PHASE_LABELS[id]} | ${cell(p.outcome)} | ${duration(p.duration_ms)} | ${tokens(p.token_usage)} | ${cell(metrics(p.measurements))} | ${cell(p.completeness)} | ${number(p.confidence)}% |`; }),
    '', '</details>',
  ];
  if (card.completeness !== 'complete' || card.evidence_coverage.ratio < 1 || card.token_totals.unavailable) {
    lines.push('', `> **Provisional score:** some evidence is unavailable (${card.evidence_coverage.missing_critical.length ? card.evidence_coverage.missing_critical.map(cell).join(', ') : 'see coverage and phase completeness above'}).`);
  }
  return lines.join('\n');
}

export function formatRunScorecardFile(file: string): string {
  try { return formatRunScorecardMarkdown(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown); }
  catch { return formatRunScorecardMarkdown(undefined); }
}

if (process.argv[1] && /run-scorecard-markdown\.(?:js|ts)$/.test(process.argv[1])) {
  process.stdout.write(`${formatRunScorecardFile(process.argv[2] ?? '')}\n`);
}
