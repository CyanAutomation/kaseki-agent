export interface RunCursor {
  createdAt: string;
  id: string;
}

export function parseCursor(value: unknown): RunCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 512) throw new Error('cursor must be a valid opaque cursor');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<RunCursor>;
    if (
      typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' || parsed.id.length === 0
    ) throw new Error('invalid fields');
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error('cursor must be a valid opaque cursor');
  }
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  const timestamp = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(JSON.stringify({ createdAt: timestamp, id })).toString('base64url');
}

/** True when an item sorts after the cursor in a newest-first createdAt/id ordering. */
export function isAfterCursor(createdAt: Date, id: string, cursor: RunCursor): boolean {
  const cursorTime = Date.parse(cursor.createdAt);
  const itemTime = createdAt.getTime();
  return itemTime < cursorTime || (itemTime === cursorTime && id.localeCompare(cursor.id) < 0);
}

export function parseLimit(value: unknown, defaultValue = 50, maxValue = 500): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer');
  return Math.min(parsed, maxValue);
}
