const STAGE_ALIASES: Array<[RegExp, string]> = [
  [/goal.setting/i, 'goal-setting'],
  [/scouting/i, 'scouting'],
  [/pi coding agent|coding/i, 'coding'],
  [/^validation(?:\s|$)/i, 'validation'],
  [/goal check/i, 'goal-check'],
  [/run evaluation/i, 'run-evaluation'],
];

export function aggregateStageDurations(contents: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of contents.split(/\r?\n/)) {
    const columns = row.split('\t');
    const stage = columns[0]?.trim();
    if (!stage) continue;
    const duration = Number(columns.length >= 3 ? columns[2] : columns[1]);
    if (!Number.isFinite(duration) || duration < 0) continue;
    const alias = STAGE_ALIASES.find(([pattern]) => pattern.test(stage));
    if (alias) result[alias[1]] = (result[alias[1]] ?? 0) + duration;
  }
  return result;
}
