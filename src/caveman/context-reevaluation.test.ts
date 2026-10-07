import {
  EventDrivenContextReevaluator,
  type ContextReevaluationMessage,
  type RelevanceToolResultEvent,
} from './context-reevaluation.js';

const readEvent = (path: string, toolCallId = `read-${path}`): RelevanceToolResultEvent => ({
  toolName: 'read', toolCallId, input: { path }, content: [{ type: 'text', text: 'old file contents' }], isError: false,
});

const writeEvent = (path: string, isError = false): RelevanceToolResultEvent => ({
  toolName: 'hashline_edit', toolCallId: `edit-${path}`, input: { path }, content: [{ type: 'text', text: 'edited' }], isError,
});

const toolMessage = (toolCallId: string, text: string): ContextReevaluationMessage => ({
  role: 'toolResult', toolCallId, toolName: 'read', content: [{ type: 'text', text }],
});

describe('event-driven context relevance reevaluation', () => {
  it('marks only earlier reads of the same successfully modified path stale at the next context build', () => {
    const tracker = new EventDrivenContextReevaluator({ minTokens: 1 });
    tracker.observeToolResult(readEvent('./src/router.ts', 'old-read'));
    tracker.observeToolResult(readEvent('src/other.ts', 'other-read'));
    const invalidated = tracker.observeToolResult(writeEvent('src/router.ts'));
    const messages = [toolMessage('old-read', 'old file contents'), toolMessage('other-read', 'other file contents')];

    const updated = tracker.reevaluateContext(messages);

    expect(invalidated).toMatchObject({ invalidatedItems: 1, trigger: 'file_modified' });
    expect(updated.changed).toBe(true);
    expect(updated.messages[0].content).toEqual([{ type: 'text', text: expect.stringContaining('stale after a successful file edit') }]);
    expect(updated.messages[1]).toBe(messages[1]);
    expect(updated.staleItems).toBe(1);
  });

  it('does not invalidate on failed edits, unrelated tools, or missing path identity', () => {
    const tracker = new EventDrivenContextReevaluator({ minTokens: 1 });
    tracker.observeToolResult(readEvent('src/router.ts', 'read-1'));

    expect(tracker.observeToolResult(writeEvent('src/router.ts', true)).invalidatedItems).toBe(0);
    expect(tracker.observeToolResult({ ...writeEvent('src/other.ts'), toolName: 'bash' }).invalidatedItems).toBe(0);
    expect(tracker.observeToolResult({ ...writeEvent('src/router.ts'), input: {} }).invalidatedItems).toBe(0);
    expect(tracker.reevaluateContext([toolMessage('read-1', 'still current')]).changed).toBe(false);
  });

  it('tracks only bounded large reads with stable tool-call ids and handles both Pi id spellings', () => {
    const tracker = new EventDrivenContextReevaluator({ minTokens: 10 });
    tracker.observeToolResult({ ...readEvent('small.ts', 'small'), content: [{ type: 'text', text: 'tiny' }] });
    tracker.observeToolResult({ ...readEvent('large.ts', 'large'), content: [{ type: 'text', text: 'x'.repeat(100) }] });
    tracker.observeToolResult({ ...readEvent('missing-id.ts'), toolCallId: undefined, content: [{ type: 'text', text: 'x'.repeat(100) }] });
    tracker.observeToolResult(writeEvent('large.ts'));

    const updated = tracker.reevaluateContext([
      toolMessage('small', 'tiny'),
      toolMessage('large', 'large content'),
      { role: 'tool', tool_call_id: 'large', toolName: 'read', content: [{ type: 'text', text: 'large content' }] },
    ]);

    expect(updated.messages[0]).toBeDefined();
    expect(updated.messages[1].content?.[0].text).toContain('stale after a successful file edit');
    expect(updated.messages[2].content?.[0].text).toContain('stale after a successful file edit');
    expect(updated.staleItems).toBe(1);
  });

  it('keeps tracker state local and does not mutate Pi-owned context messages', () => {
    const tracker = new EventDrivenContextReevaluator({ minTokens: 1 });
    tracker.observeToolResult(readEvent('src/router.ts', 'read-1'));
    tracker.observeToolResult(writeEvent('src/router.ts'));
    const original = toolMessage('read-1', 'old file contents');

    const updated = tracker.reevaluateContext([original]);

    expect(original.content?.[0].text).toBe('old file contents');
    expect(updated.messages[0]).not.toBe(original);
    expect(tracker.trackedItemCount).toBe(1);
  });
});
