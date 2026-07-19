function extractResponseText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const response = value as any;
  if (typeof response.output_text === 'string') return response.output_text;
  if (typeof response.text === 'string') return response.text;
  if (Array.isArray(response.output)) {
    return response.output.map(extractOutputItemText).join('');
  }
  return '';
}

function extractOutputItemText(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const outputItem = item as any;
  if (typeof outputItem.text === 'string') return outputItem.text;
  if (!Array.isArray(outputItem.content)) return '';
  return outputItem.content.map(extractContentPartText).join('');
}

function extractContentPartText(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const contentPart = part as any;
  if (typeof contentPart.text === 'string') return contentPart.text;
  if (typeof contentPart.output_text === 'string') return contentPart.output_text;
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

function extractSseData(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined;
  const data = line.slice('data:'.length).trim();
  return data && data !== '[DONE]' ? data : undefined;
}

function parseSseEvent(data: string): any | undefined {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function resolveResponseId(event: any): string | undefined {
  if (typeof event?.response?.id === 'string') return event.response.id;
  if (typeof event?.item?.id === 'string') return event.item.id;
  return undefined;
}

export function parseResponsesSse(bodyText: string): { text: string; responseId?: string; outputTokens?: number } {
  let text = '';
  let responseId: string | undefined;
  let outputTokens: number | undefined;
  for (const line of bodyText.split(/\r?\n/)) {
    const data = extractSseData(line);
    if (!data) continue;
    const event = parseSseEvent(data);
    if (!event) continue;
    if (typeof event?.delta === 'string') text += event.delta;
    responseId = responseId ?? resolveResponseId(event);
    if (event?.response) {
      text += extractResponseText(event.response);
      outputTokens = outputTokens ?? extractOutputTokens(event.response);
    }
  }
  return { text, responseId, outputTokens };
}
