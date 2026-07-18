/**
 * Extract the structure of the first few events for diagnostics.
 * Sanitized to avoid leaking sensitive data.
 */
export function extractSampleEventStructure(stdout: string): any[] {
  const samples: any[] = [];
  for (const line of stdout.split(/\r?\n/).slice(0, 5)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      samples.push(sanitizeEventStructure(event));
    } catch {
      // Skip malformed lines
    }
  }
  return samples;
}

function sanitizeEventStructure(obj: any, depth = 0, maxDepth = 3): any {
  if (depth > maxDepth) return '...';
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return typeof obj;
  if (Array.isArray(obj)) return `[${obj.length} items]`;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = `string(${Math.min(value.length, 50)})`;
    } else if (typeof value === 'number') {
      result[key] = 'number';
    } else if (typeof value === 'boolean') {
      result[key] = 'boolean';
    } else if (value === null) {
      result[key] = 'null';
    } else if (Array.isArray(value)) {
      result[key] = `[${value.length} items]`;
    } else if (typeof value === 'object') {
      result[key] = sanitizeEventStructure(value, depth + 1, maxDepth);
    }
  }
  return result;
}

export function countPiJsonEvents(stdout: string): number {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{'))
    .length;
}

export function analyzeMessageFields(
  message: any,
): { fieldsPresent: string[]; hasNonEmptyText: boolean } {
  const fieldsPresent: string[] = [];
  let hasNonEmptyText = false;

  const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

  const check = (field: string, value: unknown): void => {
    if (typeof value !== 'string') return;
    fieldsPresent.push(field);
    if (hasText(value)) hasNonEmptyText = true;
  };

  check('message.text', message.text);
  check('message.output_text', message.output_text);
  check('message.assistantMessage', message.assistantMessage);
  check('message.content (string)', typeof message.content === 'string' ? message.content : undefined);

  if (Array.isArray(message.choices)) {
    fieldsPresent.push('message.choices[]');
    const choice = message.choices[0];
    check('message.choices[0].message.content', choice?.message?.content);
    check('message.choices[0].delta.content', choice?.delta?.content);
  }

  check('message.delta.content', message.delta?.content);
  check('message.response.content', message.response?.content);

  if (Array.isArray(message.content)) {
    fieldsPresent.push('message.content (array)');
    for (const part of message.content) {
      check('message.content[].text', part?.text);
      check('message.content[].output_text', part?.output_text);
      check('message.content[].content', part?.content);
    }
  }

  return { fieldsPresent, hasNonEmptyText };
}

export function buildSuggestedPatterns(assistantFieldsFound: Set<string>): string[] {
  const patterns: string[] = [];
  if (assistantFieldsFound.has('message.text')) patterns.push('message.text (legacy Pi)');
  if (assistantFieldsFound.has('message.output_text')) patterns.push('message.output_text (legacy Pi)');
  if (assistantFieldsFound.has('message.content (string)')) patterns.push('message.content string (Cloudflare)');
  if (assistantFieldsFound.has('message.choices[0].message.content')) patterns.push('choices[0].message.content (Chat Completions)');
  if (assistantFieldsFound.has('message.choices[0].delta.content')) patterns.push('choices[0].delta.content (streaming)');
  if (assistantFieldsFound.has('message.delta.content')) patterns.push('message.delta.content (streaming direct)');
  if (assistantFieldsFound.has('message.response.content')) patterns.push('response.content (wrapped)');
  return patterns;
}

export function analyzeResponseStructure(stdout: string): {
  eventCount: number;
  eventsByType: Record<string, number>;
  fieldsFound: string[];
  eventsWithText: number;
  assistantEventsWithText: number;
  nonAssistantEventsWithText: number;
  assistantFieldsFound: string[];
  nonAssistantFieldsFound: string[];
  suggestedPatterns: string[];
} {
  const eventsByType: Record<string, number> = {};
  const fieldsFound = new Set<string>();
  const assistantFieldsFound = new Set<string>();
  const nonAssistantFieldsFound = new Set<string>();
  let assistantEventsWithText = 0;
  let nonAssistantEventsWithText = 0;
  let eventCount = 0;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    eventCount++;

    if (event.type) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    const message = event?.message;
    if (!message) continue;

    const role = message.role;
    const { fieldsPresent, hasNonEmptyText } = analyzeMessageFields(message);

    for (const field of fieldsPresent) {
      fieldsFound.add(field);
      if (role === 'assistant') {
        assistantFieldsFound.add(field);
      } else {
        nonAssistantFieldsFound.add(`${typeof role === 'string' ? role : 'unknown'}.${field}`);
      }
    }

    if (hasNonEmptyText) {
      if (role === 'assistant') assistantEventsWithText++;
      else nonAssistantEventsWithText++;
    }
  }

  return {
    eventCount,
    eventsByType,
    fieldsFound: Array.from(fieldsFound),
    eventsWithText: assistantEventsWithText,
    assistantEventsWithText,
    nonAssistantEventsWithText,
    assistantFieldsFound: Array.from(assistantFieldsFound),
    nonAssistantFieldsFound: Array.from(nonAssistantFieldsFound),
    suggestedPatterns: buildSuggestedPatterns(assistantFieldsFound),
  };
}
