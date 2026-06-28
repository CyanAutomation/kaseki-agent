/**
 * Gateway Response Validation & Analysis
 *
 * Handles validation of gateway responses and analysis of response structures
 * to diagnose text extraction issues and provide remediation guidance.
 */

function extractResponseText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const response = value as any;
  if (typeof response.output_text === 'string') return response.output_text;
  if (typeof response.text === 'string') return response.text;
  if (Array.isArray(response.output)) {
    return response.output.map((item: any) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (!Array.isArray(item.content)) return '';
      return item.content.map((part: any) => {
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.output_text === 'string') return part.output_text;
        return '';
      }).join('');
    }).join('');
  }
  return '';
}

export function extractOutputTokens(value: unknown): number | undefined {
  const usage = (value as any)?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  for (const key of ['output_tokens', 'output', 'completion_tokens']) {
    if (typeof usage[key] === 'number' && Number.isFinite(usage[key])) return usage[key];
  }
  return undefined;
}

export function parseResponsesSse(bodyText: string): { text: string; responseId?: string; outputTokens?: number } {
  let text = '';
  let responseId: string | undefined;
  let outputTokens: number | undefined;
  for (const line of bodyText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (typeof event?.delta === 'string') text += event.delta;
    if (!responseId && typeof event?.response?.id === 'string') responseId = event.response.id;
    if (!responseId && typeof event?.item?.id === 'string') responseId = event.item.id;
    if (event?.response) {
      text += extractResponseText(event.response);
      outputTokens = outputTokens ?? extractOutputTokens(event.response);
    }
  }
  return { text, responseId, outputTokens };
}

/**
 * Extract the structure of the first few events for diagnostics
 * Sanitized to avoid leaking sensitive data
 */
export function extractSampleEventStructure(stdout: string): any[] {
  const samples: any[] = [];
  for (const line of stdout.split(/\r?\n/).slice(0, 5)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed);
      // Build a sanitized structure showing only field names and types
      const sanitized = sanitizeEventStructure(event);
      samples.push(sanitized);
    } catch {
      // Skip malformed lines
    }
  }
  return samples;
}

/**
 * Recursively sanitize event structure to show field names/types without sensitive content
 */
function sanitizeEventStructure(obj: any, depth = 0, maxDepth = 3): any {
  if (depth > maxDepth) return '...';
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return typeof obj;
  if (Array.isArray(obj)) return `[${obj.length} items]`;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Show type and length for strings
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

/**
 * Analyze response structure to help diagnose text extraction failures
 * Returns details about what fields were found and which patterns might work
 */
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

  const recordField = (field: string, role: unknown) => {
    fieldsFound.add(field);
    if (role === 'assistant') {
      assistantFieldsFound.add(field);
    } else {
      nonAssistantFieldsFound.add(`${typeof role === 'string' ? role : 'unknown'}.${field}`);
    }
  };

  const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

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
    let messageHasText = false;

    // Track which fields are present, separating assistant output from prompts or other roles.
    if (typeof message.text === 'string') {
      recordField('message.text', role);
      if (hasText(message.text)) messageHasText = true;
    }
    if (typeof message.output_text === 'string') {
      recordField('message.output_text', role);
      if (hasText(message.output_text)) messageHasText = true;
    }
    if (typeof message.assistantMessage === 'string') {
      recordField('message.assistantMessage', role);
      if (hasText(message.assistantMessage)) messageHasText = true;
    }
    if (typeof message.content === 'string') {
      recordField('message.content (string)', role);
      if (hasText(message.content)) messageHasText = true;
    }
    if (Array.isArray(message.choices)) {
      recordField('message.choices[]', role);
      const choice = message.choices[0];
      if (typeof choice?.message?.content === 'string') {
        recordField('message.choices[0].message.content', role);
        if (hasText(choice.message.content)) messageHasText = true;
      }
      if (typeof choice?.delta?.content === 'string') {
        recordField('message.choices[0].delta.content', role);
        if (hasText(choice.delta.content)) messageHasText = true;
      }
    }
    // Direct delta field (streaming format without choices wrapper)
    if (typeof message.delta?.content === 'string') {
      recordField('message.delta.content', role);
      if (hasText(message.delta.content)) messageHasText = true;
    }
    if (typeof message.response?.content === 'string') {
      recordField('message.response.content', role);
      if (hasText(message.response.content)) messageHasText = true;
    }
    if (Array.isArray(message.content)) {
      recordField('message.content (array)', role);
      for (const part of message.content) {
        if (typeof part?.text === 'string') {
          recordField('message.content[].text', role);
          if (hasText(part.text)) messageHasText = true;
        }
        if (typeof part?.output_text === 'string') {
          recordField('message.content[].output_text', role);
          if (hasText(part.output_text)) messageHasText = true;
        }
        if (typeof part?.content === 'string') {
          recordField('message.content[].content', role);
          if (hasText(part.content)) messageHasText = true;
        }
      }
    }

    if (messageHasText) {
      if (role === 'assistant') assistantEventsWithText++;
      else nonAssistantEventsWithText++;
    }
  }

  // Suggest patterns based only on assistant response fields that were found.
  const suggestedPatterns: string[] = [];
  if (assistantFieldsFound.has('message.text')) suggestedPatterns.push('message.text (legacy Pi)');
  if (assistantFieldsFound.has('message.output_text')) suggestedPatterns.push('message.output_text (legacy Pi)');
  if (assistantFieldsFound.has('message.content (string)')) suggestedPatterns.push('message.content string (Cloudflare)');
  if (assistantFieldsFound.has('message.choices[0].message.content')) suggestedPatterns.push('choices[0].message.content (Chat Completions)');
  if (assistantFieldsFound.has('message.choices[0].delta.content')) suggestedPatterns.push('choices[0].delta.content (streaming)');
  if (assistantFieldsFound.has('message.delta.content')) suggestedPatterns.push('message.delta.content (streaming direct)');
  if (assistantFieldsFound.has('message.response.content')) suggestedPatterns.push('response.content (wrapped)');

  return {
    eventCount,
    eventsByType,
    fieldsFound: Array.from(fieldsFound),
    eventsWithText: assistantEventsWithText,
    assistantEventsWithText,
    nonAssistantEventsWithText,
    assistantFieldsFound: Array.from(assistantFieldsFound),
    nonAssistantFieldsFound: Array.from(nonAssistantFieldsFound),
    suggestedPatterns,
  };
}
