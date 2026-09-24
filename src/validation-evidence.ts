import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ValidationEvidence {
  text: string;
  sources: string[];
}

export type ValidationResultRow = Record<string, unknown>;

function object(value: unknown): ValidationResultRow | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ValidationResultRow : undefined;
}

function detailValue(details: unknown, key: string): string | undefined {
  if (typeof details !== 'string') return undefined;
  return details.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1];
}

/** Return final-attempt validation rows while accepting older artifacts without attempt metadata. */
export function latestValidationResults(...sources: unknown[][]): ValidationResultRow[] {
  const merged = new Map<string, ValidationResultRow>();
  const occurrencesBySource = sources.map(() => new Map<string, number>());
  sources.forEach((source, sourceIndex) => {
    for (const rawRow of source) {
      const row = object(rawRow);
      if (!row) continue;
      const details = row.details ?? row.detail;
      const rawInvocation = row.invocation ?? detailValue(details, 'invocation');
      const invocation = rawInvocation === undefined ? undefined : Number(rawInvocation);
      const rawAttempt = row.attempt ?? detailValue(details, 'attempt');
      const attempt = rawAttempt === undefined ? undefined : Number(rawAttempt);
      const rawStage = row.stage ?? row.validation_stage ?? detailValue(details, 'stage');
      const stage = rawStage === undefined ? undefined : String(rawStage);
      const normalized: ValidationResultRow = {
        ...row,
        ...(Number.isFinite(invocation) ? { invocation } : {}),
        ...(Number.isFinite(attempt) ? { attempt } : {}),
        ...(stage !== undefined ? { stage } : {}),
      };
      const normalizedStage = String(stage ?? '').toLowerCase();
      if (normalizedStage && !/^validation(?:\s|$)/.test(normalizedStage)) continue;

      // The phase result and timing manifest describe the same execution.
      // Match equal occurrences across sources, preserving intentional repeats
      // of the same command within a single validation invocation.
      const identity = JSON.stringify([
        normalizedStage,
        normalized.attempt ?? null,
        normalized.invocation ?? null,
        normalized.command ?? null,
        normalized.exit_code ?? null,
      ]);
      const sourceOccurrences = occurrencesBySource[sourceIndex];
      const occurrence = sourceOccurrences.get(identity) ?? 0;
      sourceOccurrences.set(identity, occurrence + 1);
      const mergeKey = `${identity}#${occurrence}`;
      const prior = merged.get(mergeKey);
      if (!prior) {
        merged.set(mergeKey, normalized);
      } else {
        const combined = { ...normalized };
        for (const [key, value] of Object.entries(prior)) {
          if (combined[key] === undefined) combined[key] = value;
        }
        merged.set(mergeKey, combined);
      }
    }
  });
  const rows = [...merged.values()];
  const invocations = rows.map((row) => Number(row.invocation)).filter((value) => Number.isFinite(value));
  if (invocations.length === 0) return rows;
  const latestInvocation = Math.max(...invocations);
  return rows.filter((row) => row.invocation === undefined || row.invocation === latestInvocation);
}

/**
 * Collect validation evidence across the post-agent and baseline phases.
 * A missing post-agent log must not hide timings or pre-validation output.
 */
export function collectValidationEvidence(resultsDir: string): ValidationEvidence {
  const sources: string[] = [];
  const parts: string[] = [];
  for (const file of [
    'validation.log', 'validation-timings.tsv', 'pre-validation.log', 'pre-validation-timings.tsv',
    'validation-results.json', 'timings-manifest.json',
  ]) {
    let content = '';
    try {
      content = fs.readFileSync(path.join(resultsDir, file), 'utf8');
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    sources.push(file);
    parts.push(`--- ${file} ---\n${content.slice(-12000)}`);
  }
  return { text: parts.join('\n'), sources };
}
