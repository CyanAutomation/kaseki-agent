import { progressEventsFromDockerLogTail } from './docker-log-progress-events';

describe('progressEventsFromDockerLogTail', () => {
  it('deduplicates stage headings that differ only by case', () => {
    const events = progressEventsFromDockerLogTail(
      '==> typescript pre-check\n==> TypeScript pre-check\n',
      '2026-06-28T21:24:10.671Z',
    );

    expect(events).toEqual([
      expect.objectContaining({
        stage: 'typescript pre-check',
        status: 'started',
        timestamp: '2026-06-28T21:24:10.671Z',
      }),
    ]);
  });

  it('keeps distinct progress states for the same stage', () => {
    const events = progressEventsFromDockerLogTail(
      '[progress] scouting started: beginning\n[progress] scouting finished: complete\n',
    );

    expect(events).toHaveLength(2);
  });

  it('preserves Docker timestamps and strips ANSI from stage names', () => {
    const events = progressEventsFromDockerLogTail(
      '2026-07-05T17:18:19.527Z ==> pi scouting agent\u001b[0;34m\n',
      '2026-07-05T18:00:00.000Z',
    );

    expect(events[0]).toEqual(expect.objectContaining({
      stage: 'pi scouting agent',
      timestamp: '2026-07-05T17:18:19.527Z',
    }));
    expect(events[0].timestampEstimated).toBeUndefined();
  });

  it('uses a stable epoch fallback instead of changing timestamps on every read', () => {
    const first = progressEventsFromDockerLogTail('==> clone repository\n');
    const second = progressEventsFromDockerLogTail('==> clone repository\n');

    expect(first[0].timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(second[0].timestamp).toBe(first[0].timestamp);
    expect(first[0].timestampEstimated).toBe(true);
  });
});
