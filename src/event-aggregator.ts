/**
 * event-aggregator.ts
 *
 * Encapsulates counter aggregation logic for Pi event stream processing.
 * Tracks event types, models, APIs, tool executions, and assistant message types
 * with bounded cardinality (1000 keys per counter).
 */

const MAX_DISTINCT_SUMMARY_KEYS = 1000;
const OTHER_BUCKET_KEY = '__other__';

export interface EventCountMap {
  [key: string]: number;
}

export interface AggregatorSummary {
  selected_model: string;
  selected_api: string;
  event_counts: EventCountMap;
  assistant_event_counts: EventCountMap;
  tool_start_count: number;
  tool_end_count: number;
}

/**
 * EventCounterAggregator manages counter maps for event stream aggregation.
 *
 * Responsibilities:
 * - Track event type counts with cardinality cap
 * - Track assistant message type counts
 * - Observe and count models and APIs
 * - Track tool execution start/end events
 * - Provide summarized output with top model/API selected
 */
export class EventCounterAggregator {
  private eventCounts: EventCountMap = {};
  private assistantEventCounts: EventCountMap = {};
  private models: EventCountMap = {};
  private apis: EventCountMap = {};
  private toolStartCount = 0;
  private toolEndCount = 0;

  /**
   * Increment a counter in a map with cardinality cap.
   * Once a map reaches MAX_DISTINCT_SUMMARY_KEYS entries, new unseen keys
   * are folded into the "__other__" bucket.
   */
  private incrementMap(
    map: EventCountMap,
    key: string | undefined,
    maxDistinctKeys: number = MAX_DISTINCT_SUMMARY_KEYS
  ): void {
    if (!key) return;

    let targetKey = key;
    if (
      map[key] === undefined &&
      Object.keys(map).filter((k) => k !== OTHER_BUCKET_KEY).length >= maxDistinctKeys
    ) {
      targetKey = OTHER_BUCKET_KEY;
    }
    map[targetKey] = (map[targetKey] ?? 0) + 1;
  }

  /**
   * Record an event type observation.
   */
  recordEventType(eventType: string | undefined): void {
    this.incrementMap(this.eventCounts, eventType ?? '<missing>', MAX_DISTINCT_SUMMARY_KEYS);
  }

  /**
   * Record an assistant message type observation.
   */
  recordAssistantEventType(assistantType: string | undefined): void {
    this.incrementMap(
      this.assistantEventCounts,
      assistantType,
      MAX_DISTINCT_SUMMARY_KEYS
    );
  }

  /**
   * Record model and API observations from a message object.
   */
  recordModelAndApi(message: any): void {
    if (!message || typeof message !== 'object') return;
    this.incrementMap(this.models, message.model, MAX_DISTINCT_SUMMARY_KEYS);
    this.incrementMap(this.apis, message.api, MAX_DISTINCT_SUMMARY_KEYS);
  }

  /**
   * Record a tool execution start event.
   */
  recordToolStart(): void {
    this.toolStartCount++;
  }

  /**
   * Record a tool execution end event.
   */
  recordToolEnd(): void {
    this.toolEndCount++;
  }

  /**
   * Get the top model by frequency.
   */
  private topByFrequency(map: EventCountMap): string {
    return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }

  /**
   * Generate summary with selected model/API and all counters.
   */
  summary(): AggregatorSummary {
    return {
      selected_model: this.topByFrequency(this.models),
      selected_api: this.topByFrequency(this.apis),
      event_counts: this.eventCounts,
      assistant_event_counts: this.assistantEventCounts,
      tool_start_count: this.toolStartCount,
      tool_end_count: this.toolEndCount,
    };
  }
}
