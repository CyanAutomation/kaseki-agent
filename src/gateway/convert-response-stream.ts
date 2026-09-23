export interface GatewayStreamIdentity {
  api: string;
  provider: string;
  model: string;
}

export interface GatewayTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface GatewayAssistantMessage extends GatewayStreamIdentity {
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  usage: GatewayTokenUsage;
  stopReason: 'stop';
  timestamp: number;
}

export type GatewayPiEvent =
  | { type: 'start'; partial: GatewayAssistantMessage }
  | { type: 'text_start'; contentIndex: 0; partial: GatewayAssistantMessage }
  | { type: 'text_delta'; contentIndex: 0; delta: string; partial: GatewayAssistantMessage }
  | { type: 'text_end'; contentIndex: 0; content: string }
  | { type: 'done'; reason: 'stop'; message: GatewayAssistantMessage };

export interface GatewayStreamOptions extends GatewayStreamIdentity {
  now?: () => number;
}

type GatewayCompletedResponse = {
  output?: Array<{ type?: unknown; text?: unknown; content?: Array<{ text?: unknown }> }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
  };
};

function finiteTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function completedResponseText(response: GatewayCompletedResponse): string {
  return (response.output ?? []).map(item => {
    if (typeof item.text === 'string') return item.text;
    return (item.content ?? [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join('');
  }).join('');
}

function parseCompletedResponse(sse: string): GatewayCompletedResponse | undefined {
  for (const block of sse.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') continue;

    try {
      const event = JSON.parse(data) as { type?: unknown; response?: GatewayCompletedResponse };
      if (event.type === 'response.completed' && event.response) return event.response;
    } catch {
      // Ignore malformed gateway frames and continue to the terminal response.
    }
  }
  return undefined;
}

/** Convert a complete OpenAI Responses SSE payload into Pi's assistant event protocol. */
export function convertGatewaySseToPiEvents(
  sse: string,
  { now = Date.now, ...identity }: GatewayStreamOptions
): GatewayPiEvent[] {
  const response = parseCompletedResponse(sse);
  if (!response) throw new Error('Gateway SSE stream did not contain a response.completed event');

  const text = completedResponseText(response);
  const input = finiteTokenCount(response.usage?.input_tokens);
  const output = finiteTokenCount(response.usage?.output_tokens);
  const cacheRead = finiteTokenCount(response.usage?.input_tokens_details?.cached_tokens);
  const message: GatewayAssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...identity,
    usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output },
    stopReason: 'stop',
    timestamp: now(),
  };
  const emptyPartial: GatewayAssistantMessage = { ...message, content: [] };

  return [
    { type: 'start', partial: emptyPartial },
    { type: 'text_start', contentIndex: 0, partial: emptyPartial },
    { type: 'text_delta', contentIndex: 0, delta: text, partial: message },
    { type: 'text_end', contentIndex: 0, content: text },
    { type: 'done', reason: 'stop', message },
  ];
}
