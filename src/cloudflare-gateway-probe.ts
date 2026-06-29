export interface CloudflareGatewayProbeOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  prompt?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface CloudflareGatewayProbeResult {
  content: string;
  raw: unknown;
}

interface GatewayContentPart {
  text?: unknown;
}

interface GatewayChoice {
  finish_reason?: unknown;
  message?: {
    content?: unknown;
    reasoning?: unknown;
  };
}

interface GatewayResponseBody {
  choices?: GatewayChoice[];
}

const DEFAULT_MODEL = 'dynamic/kaseki-agent';
const DEFAULT_PROMPT = 'Say "CloudFlare gateway test successful" in one sentence';
// Dynamic gateway routes may select reasoning models whose hidden reasoning
// consumes the output budget before message.content is emitted. Keep this
// probe small, but large enough to validate those routes reliably.
const DEFAULT_MAX_TOKENS = 256;

export function buildCloudflareGatewayChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function parseGatewayContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return String((part as GatewayContentPart).text ?? '');
        }
        return String(part);
      })
      .join('');
  }
  return content === undefined || content === null ? '' : String(content);
}

export async function probeCloudflareGateway(
  options: CloudflareGatewayProbeOptions
): Promise<CloudflareGatewayProbeResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const response = await fetchFn(buildCloudflareGatewayChatCompletionsUrl(options.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      messages: [
        {
          role: 'user',
          content: options.prompt || DEFAULT_PROMPT,
        },
      ],
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    throw new Error(`CloudFlare gateway probe failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as GatewayResponseBody;
  const choice = data.choices?.[0];
  const content = parseGatewayContent(choice?.message?.content);
  if (!content) {
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'unknown';
    const reasoningPresent = parseGatewayContent(choice?.message?.reasoning).length > 0;
    if (finishReason === 'length' && reasoningPresent) {
      throw new Error(
        'CloudFlare gateway probe exhausted max_tokens during model reasoning before message content was emitted'
      );
    }
    throw new Error('CloudFlare gateway probe response did not include message content');
  }

  return { content, raw: data };
}
