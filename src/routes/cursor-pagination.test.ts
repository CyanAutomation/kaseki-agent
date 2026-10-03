import { encodeCursor, isAfterCursor, parseCursor, parseLimit } from './cursor-pagination';

describe('cursor pagination', () => {
  test('round-trips a createdAt and id position', () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    expect(parseCursor(encodeCursor(createdAt, 'kaseki-12'))).toEqual({
      createdAt: createdAt.toISOString(),
      id: 'kaseki-12',
    });
  });

  test('rejects malformed cursors and non-positive limits', () => {
    expect(() => parseCursor('invalid')).toThrow('cursor must be a valid opaque cursor');
    expect(() => parseLimit('0')).toThrow('limit must be a positive integer');
  });

  test('uses id as a stable tie breaker and clamps page size', () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const cursor = parseCursor(encodeCursor(createdAt, 'kaseki-5'))!;
    expect(isAfterCursor(createdAt, 'kaseki-4', cursor)).toBe(true);
    expect(isAfterCursor(createdAt, 'kaseki-6', cursor)).toBe(false);
    expect(parseLimit('900')).toBe(500);
  });
});
