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
