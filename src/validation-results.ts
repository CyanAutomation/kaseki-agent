export type ValidationResultRow = Record<string, unknown>;

function object(value: unknown): ValidationResultRow | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ValidationResultRow : undefined;
}

function detailValue(details: unknown, key: string): string | undefined {
  if (typeof details !== 'string') return undefined;
  return details.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1];
}

function normalizeValidationRow(rawRow: unknown): { row: ValidationResultRow; stage: string } | undefined {
  const row = object(rawRow);
  if (!row) return undefined;
  const details = row.details ?? row.detail;
  const rawInvocation = row.invocation ?? detailValue(details, 'invocation');
  const rawAttempt = row.attempt ?? detailValue(details, 'attempt');
  const rawStage = row.stage ?? row.validation_stage ?? detailValue(details, 'stage');
  const invocation = rawInvocation === undefined ? undefined : Number(rawInvocation);
  const attempt = rawAttempt === undefined ? undefined : Number(rawAttempt);
  const stage = rawStage === undefined ? '' : String(rawStage).toLowerCase();
  if (stage && !/^validation(?:\s|$)/.test(stage)) return undefined;

  return {
    row: {
      ...row,
      ...(Number.isFinite(invocation) ? { invocation } : {}),
      ...(Number.isFinite(attempt) ? { attempt } : {}),
      ...(rawStage !== undefined ? { stage: String(rawStage) } : {}),
    },
    stage,
  };
}

function resultIdentity(row: ValidationResultRow, stage: string): string {
  return JSON.stringify([
    // Older timing artifacts omit stage metadata; since unmarked rows are
    // accepted as validation results, match them with explicit validation rows.
    stage || 'validation',
    row.attempt ?? null,
    row.invocation ?? null,
    row.command ?? null,
    row.exit_code ?? null,
  ]);
}

function mergeValidationSources(sources: unknown[][]): ValidationResultRow[] {
  const merged = new Map<string, ValidationResultRow>();
  sources.forEach((source) => {
    const occurrences = new Map<string, number>();
    for (const rawRow of source) {
      const normalized = normalizeValidationRow(rawRow);
      if (!normalized) continue;
      const identity = resultIdentity(normalized.row, normalized.stage);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      const mergeKey = `${identity}#${occurrence}`;
      const prior = merged.get(mergeKey);
      if (!prior) {
        merged.set(mergeKey, normalized.row);
        continue;
      }
      const combined = { ...normalized.row };
      for (const [key, value] of Object.entries(prior)) {
        if (combined[key] === undefined) combined[key] = value;
      }
      merged.set(mergeKey, combined);
    }
  });
  return [...merged.values()];
}

function latestInvocationRows(rows: ValidationResultRow[]): ValidationResultRow[] {
  const invocations = rows
    .map((row) => Number(row.invocation))
    .filter((value) => Number.isFinite(value));
  if (invocations.length === 0) return rows;
  const latestInvocation = Math.max(...invocations);
  return rows.filter((row) => row.invocation === undefined || row.invocation === latestInvocation);
}

/** Return final-attempt validation rows while accepting older artifacts without attempt metadata. */
export function latestValidationResults(...sources: unknown[][]): ValidationResultRow[] {
  return latestInvocationRows(mergeValidationSources(sources));
}
