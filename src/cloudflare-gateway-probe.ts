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
  message?: {
    content?: unknown;
  };
}

interface GatewayResponseBody {
  choices?: GatewayChoice[];
}

const DEFAULT_MODEL = 'dynamic/kaseki-agent';
const DEFAULT_PROMPT = 'Say "CloudFlare gateway test successful" in one sentence';
const DEFAULT_MAX_TOKENS = 50;

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
      max_tokens: options.maxTokens || DEFAULT_MAX_TOKENS,
    }),
  });

  if (!response.ok) {
    throw new Error(`CloudFlare gateway probe failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as GatewayResponseBody;
  const content = parseGatewayContent(data.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error('CloudFlare gateway probe response did not include message content');
  }

  return { content, raw: data };
}
