import type { SoyuzAdapterConfig } from './config';
import type { CloudflarePulledMessage } from './contracts';

export class CloudflareQueueError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'CloudflareQueueError';
  }
}

export class CloudflareQueueConsumer {
  private readonly baseUrl: string;

  constructor(
    private readonly config: SoyuzAdapterConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/queues/${encodeURIComponent(config.queueId)}/messages`;
  }

  async pull(batchSize: number): Promise<CloudflarePulledMessage[]> {
    const response = await this.call(`${this.baseUrl}/pull`, {
      visibility_timeout_ms: this.config.visibilityTimeoutMs,
      batch_size: batchSize,
    });
    const result = response.result as { messages?: unknown } | undefined;
    if (!Array.isArray(result?.messages)) throw new Error('Cloudflare Queue pull response has no messages array');
    return result.messages.map((message) => {
      if (!message || typeof message !== 'object') throw new Error('Cloudflare Queue returned an invalid message object');
      const item = message as Record<string, unknown>;
      if (typeof item.lease_id !== 'string' || typeof item.id !== 'string') {
        throw new Error('Cloudflare Queue message is missing its lease or ephemeral ID');
      }
      return {
        body: item.body,
        id: item.id,
        timestamp_ms: typeof item.timestamp_ms === 'number' ? item.timestamp_ms : 0,
        attempts: typeof item.attempts === 'number' ? item.attempts : 0,
        lease_id: item.lease_id,
      };
    });
  }

  async acknowledge(leaseId: string): Promise<void> {
    await this.call(`${this.baseUrl}/ack`, { acks: [{ lease_id: leaseId }], retries: [] });
  }

  async retry(leaseId: string, delaySeconds: number): Promise<void> {
    await this.call(`${this.baseUrl}/ack`, {
      acks: [],
      retries: [{ lease_id: leaseId, delay_seconds: Math.max(1, Math.min(900, Math.floor(delaySeconds))) }],
    });
  }

  private async call(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.queueApiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > 12 * 1024 * 1024) {
      throw new Error('Cloudflare Queue response exceeded the 12 MB client limit');
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Cloudflare Queue returned invalid JSON (${response.status})`);
    }
    const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
    if (!response.ok || parsed.success !== true) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      const details = errors.map((entry) => {
        if (entry && typeof entry === 'object' && 'message' in entry) return String((entry as { message: unknown }).message);
        return 'Cloudflare Queue request rejected';
      }).join('; ');
      throw new CloudflareQueueError(
        response.status,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        details || `Cloudflare Queue request failed (${response.status})`,
      );
    }
    return parsed;
  }
}
