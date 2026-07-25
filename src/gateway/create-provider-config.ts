export type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

export type ReadTextFile = (path: string, encoding: 'utf8') => string;

export interface GatewayProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  api: 'openai-completions';
  models: Array<{
    id: string;
    name: string;
    reasoning: false;
    input: ['text'];
    cost: { input: 0; output: 0; cacheRead: 0; cacheWrite: 0 };
    contextWindow: 128000;
    maxTokens: number;
  }>;
}

function resolveGatewayApiKey(env: GatewayEnvironment, readFile: ReadTextFile): string {
  if (env.LLM_GATEWAY_API_KEY) return env.LLM_GATEWAY_API_KEY;

  const filePath = env.LLM_GATEWAY_API_KEY_FILE || '~/.kaseki/secrets.json';
  const expandedPath = filePath.startsWith('~')
    ? filePath.replace('~', env.HOME || '')
    : filePath;

  try {
    return readFile(expandedPath, 'utf8').trim();
  } catch {
    return '';
  }
}

function resolveGatewayMaxTokens(env: GatewayEnvironment): number {
  const parsed = Number.parseInt(env.LLM_GATEWAY_MAX_OUTPUT_TOKENS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4096;
}

/** Build Pi's gateway provider configuration without reading global state. */
export function createGatewayProviderConfig(
  env: GatewayEnvironment,
  readFile: ReadTextFile
): GatewayProviderConfig | undefined {
  const gatewayUrl = env.LLM_GATEWAY_URL;
  if (!gatewayUrl) return undefined;

  const gatewayApiKey = resolveGatewayApiKey(env, readFile);
  const model = env.LLM_GATEWAY_MODEL || 'dynamic/kaseki-agent';
  const headers = gatewayUrl.includes('gateway.ai.cloudflare.com')
    ? {
      'cf-aig-authorization': `Bearer ${gatewayApiKey}`,
      'cf-aig-collect-log-payload': env.KASEKI_GATEWAY_LOG_PAYLOADS === '1' ? 'true' : 'false',
      'cf-aig-metadata': JSON.stringify({
        run_id: env.KASEKI_INSTANCE || 'unknown',
        phase: env.KASEKI_INFERENCE_PHASE || 'unknown',
        attempt: env.KASEKI_INFERENCE_ATTEMPT || 'unknown',
        request_id: env.KASEKI_INFERENCE_REQUEST_ID || 'unknown',
        component: 'kaseki-agent',
      }),
    }
    : undefined;

  return {
    name: 'LLM Gateway (CloudFlare)',
    baseUrl: gatewayUrl,
    apiKey: gatewayApiKey || '$LLM_GATEWAY_API_KEY',
    ...(headers ? { headers } : {}),
    api: 'openai-completions',
    models: [
      {
        id: model,
        name: `CloudFlare Gateway (${model})`,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: resolveGatewayMaxTokens(env),
      },
    ],
  };
}
