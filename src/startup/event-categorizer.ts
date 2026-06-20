/**
 * Event Categorizer
 *
 * Categorizes startup events by type, rank, and severity
 * Enables filtering and prioritization in logs and reports
 */

export type EventCategory = 'bootstrap' | 'preflight' | 'validation' | 'error' | 'other';
export type EventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'blocking';

export interface CategorizedEvent {
  type: string;
  component: string;
  category: EventCategory;
  severity: EventSeverity;
  rank: number;
  detail?: string;
}

export interface RawEvent {
  type: string;
  component: string;
  detail?: string;
}

/**
 * Categorize a raw startup event
 *
 * @param event - Raw event with type and component
 * @returns Categorized event with category, severity, and rank
 */
export function categorizeEvent(event: RawEvent): CategorizedEvent {
  const { category, severity, rank } = getEventProperties(event.type);

  return {
    ...event,
    category,
    severity,
    rank,
  };
}

/**
 * Get category and severity for an event type
 */
function getEventProperties(
  eventType: string
): { category: EventCategory; severity: EventSeverity; rank: number } {
  const lowerType = eventType.toLowerCase();

  // Error events
  if (lowerType.includes('error') || lowerType.includes('failed')) {
    return {
      category: 'error',
      severity: 'blocking',
      rank: 1000,
    };
  }

  // Slow component warnings
  if (lowerType.includes('slow')) {
    return {
      category: 'bootstrap',
      severity: 'warning',
      rank: 800,
    };
  }

  // Bootstrap/component initialization
  if (
    lowerType.includes('init') ||
    lowerType.includes('component') ||
    lowerType.includes('service') ||
    lowerType.includes('started')
  ) {
    return {
      category: 'bootstrap',
      severity: 'info',
      rank: 600,
    };
  }

  // Preflight checks
  if (lowerType.includes('check') || lowerType.includes('preflight')) {
    const isFailed = lowerType.includes('failed');
    return {
      category: 'preflight',
      severity: isFailed ? 'warning' : 'info',
      rank: isFailed ? 700 : 500,
    };
  }

  // Validation events
  if (lowerType.includes('validation') || lowerType.includes('test')) {
    return {
      category: 'validation',
      severity: 'info',
      rank: 400,
    };
  }

  // Default: other events
  return {
    category: 'other',
    severity: 'debug',
    rank: 0,
  };
}

/**
 * Get all available event categories
 */
export function getEventCategories(): EventCategory[] {
  return ['bootstrap', 'preflight', 'validation', 'error', 'other'];
}
