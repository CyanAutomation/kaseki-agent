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
});
