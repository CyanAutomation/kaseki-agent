import { EventCounterAggregator } from './event-aggregator.js';

describe('EventCounterAggregator', () => {
  it('should record event types and increment counts', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordEventType('assistant_message');
    aggregator.recordEventType('assistant_message');
    aggregator.recordEventType('thinking_start');

    const summary = aggregator.summary();
    expect(summary.event_counts['assistant_message']).toBe(2);
    expect(summary.event_counts['thinking_start']).toBe(1);
  });

  it('should handle missing event types by using <missing> placeholder', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordEventType(undefined);
    aggregator.recordEventType(undefined);

    const summary = aggregator.summary();
    expect(summary.event_counts['<missing>']).toBe(2);
  });

  it('should cap cardinality at 1000 keys and fold into __other__', () => {
    const aggregator = new EventCounterAggregator();

    // Add 1001 unique event types
    for (let i = 0; i < 1001; i++) {
      aggregator.recordEventType(`event_${i}`);
    }

    const summary = aggregator.summary();
    const uniqueKeys = Object.keys(summary.event_counts).filter((k) => k !== '__other__');

    // Should have at most 1000 unique keys (plus __other__)
    expect(uniqueKeys.length).toBe(1000);
    expect(summary.event_counts['__other__']).toBe(1);
  });

  it('should record model and API observations', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordModelAndApi({ model: 'claude-3-opus', api: 'openrouter' });
    aggregator.recordModelAndApi({ model: 'claude-3-opus', api: 'openrouter' });
    aggregator.recordModelAndApi({ model: 'gpt-4', api: 'openai' });

    const summary = aggregator.summary();
    expect(summary.selected_model).toBe('claude-3-opus');
    expect(summary.selected_api).toBe('openrouter');
  });

  it('should ignore message objects that are not objects or are null', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordModelAndApi(null);
    aggregator.recordModelAndApi(undefined);
    aggregator.recordModelAndApi('not an object');

    const summary = aggregator.summary();
    expect(summary.selected_model).toBe('');
    expect(summary.selected_api).toBe('');
  });

  it('should track assistant event types separately', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordAssistantEventType('assistant_message');
    aggregator.recordAssistantEventType('thinking');
    aggregator.recordAssistantEventType('thinking');

    const summary = aggregator.summary();
    expect(summary.assistant_event_counts['assistant_message']).toBe(1);
    expect(summary.assistant_event_counts['thinking']).toBe(2);
  });

  it('should count tool start and end events', () => {
    const aggregator = new EventCounterAggregator();
    aggregator.recordToolStart();
    aggregator.recordToolStart();
    aggregator.recordToolEnd();
    aggregator.recordToolEnd();
    aggregator.recordToolEnd();

    const summary = aggregator.summary();
    expect(summary.tool_start_count).toBe(2);
    expect(summary.tool_end_count).toBe(3);
  });

  it('should select top model/api by frequency', () => {
    const aggregator = new EventCounterAggregator();

    // Model A more frequent
    aggregator.recordModelAndApi({ model: 'model-a', api: 'api-a' });
    aggregator.recordModelAndApi({ model: 'model-a', api: 'api-a' });
    aggregator.recordModelAndApi({ model: 'model-a', api: 'api-b' });
    aggregator.recordModelAndApi({ model: 'model-b', api: 'api-a' });

    const summary = aggregator.summary();
    expect(summary.selected_model).toBe('model-a');
    // api-a has count 3 (appears with model-a twice and model-b once)
    expect(summary.selected_api).toBe('api-a');
  });

  it('should return empty string for selected model/api if none recorded', () => {
    const aggregator = new EventCounterAggregator();
    const summary = aggregator.summary();
    expect(summary.selected_model).toBe('');
    expect(summary.selected_api).toBe('');
  });
});
