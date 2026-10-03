import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as ipaddr from 'ipaddr.js';

export interface WebhookResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface WebhookHttpResponse {
  status: number;
  statusText: string;
  ok: boolean;
}

export interface WebhookRequestOptions {
  address: string;
  family: 4 | 6;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface SafeWebhookOptions {
  /** Exact URL origins allowed to target local or plain HTTP webhook receivers. */
  allowedOrigins?: readonly string[];
  lookup?: (hostname: string) => Promise<WebhookResolvedAddress[]>;
  request?: (url: URL, options: WebhookRequestOptions) => Promise<WebhookHttpResponse>;
  timeoutMs?: number;
}

export class WebhookEgressPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookEgressPolicyError';
  }
}

/**
 * Send one webhook request after validating its destination and resolving DNS
 * once. The selected address becomes the socket host, so a second DNS answer
 * cannot change the peer between validation and connect.
 * Redirects are returned to the caller and are never followed.
 */
export async function postWebhookSafely(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: SafeWebhookOptions = {},
): Promise<WebhookHttpResponse> {
  const url = parseWebhookUrl(rawUrl);
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins ?? readAllowedOrigins());
  const allowlisted = allowedOrigins.has(url.origin);

  if (!allowlisted && url.protocol !== 'https:') {
    throw new WebhookEgressPolicyError('Webhook destinations must use HTTPS unless the exact origin is explicitly allowlisted');
  }

  const hostname = normalizeHostname(url.hostname);
  const addresses = await (options.lookup ?? resolveHostname)(hostname);
  if (addresses.length === 0 || addresses.length > 16) {
    throw new WebhookEgressPolicyError('Webhook destination did not resolve to a supported address set');
  }

  if (!allowlisted && addresses.some(({ address }) => !isPublicInternetAddress(address))) {
    throw new WebhookEgressPolicyError('Webhook destination resolves to a non-public network address');
  }

  const selectedAddress = addresses[0];
  if (!selectedAddress || (selectedAddress.family !== 4 && selectedAddress.family !== 6)) {
    throw new WebhookEgressPolicyError('Webhook destination resolved to an invalid address');
  }

  return (options.request ?? requestPinnedAddress)(url, {
    address: selectedAddress.address,
    family: selectedAddress.family,
    headers,
    body,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
}

export function isPublicInternetAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

function parseWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookEgressPolicyError('Webhook URL is invalid');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new WebhookEgressPolicyError('Webhook URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new WebhookEgressPolicyError('Webhook URL must not contain user information');
  }
  if (url.hash) {
    throw new WebhookEgressPolicyError('Webhook URL must not contain a fragment');
  }
  if (!url.hostname) {
    throw new WebhookEgressPolicyError('Webhook URL must include a hostname');
  }
  return url;
}

function parseAllowedOrigins(origins: readonly string[]): Set<string> {
  const allowed = new Set<string>();
  for (const rawOrigin of origins) {
    const value = rawOrigin.trim();
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('KASEKI_WEBHOOK_ALLOWED_ORIGINS must contain valid HTTP(S) origins');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.replace(/\/$/, '')) {
      throw new Error('KASEKI_WEBHOOK_ALLOWED_ORIGINS entries must be exact origins without paths');
    }
    allowed.add(parsed.origin);
  }
  return allowed;
}

function readAllowedOrigins(): string[] {
  return (process.env.KASEKI_WEBHOOK_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

function normalizeHostname(hostname: string): string {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.toLowerCase().replace(/\.$/, '');
}

async function resolveHostname(hostname: string): Promise<WebhookResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family as 4 | 6,
  }));
}

export function createPinnedRequestOptions(url: URL, options: WebhookRequestOptions): https.RequestOptions {
  const hostname = normalizeHostname(url.hostname);
  const headers = Object.fromEntries(
    Object.entries(options.headers).filter(([name]) => name.toLowerCase() !== 'host'),
  );

  return {
    protocol: url.protocol,
    // Connect to the address that was validated above. The user-provided URL
    // remains only in the HTTP authority and request target, never the socket host.
    hostname: options.address,
    port: url.port ? Number(url.port) : undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: { ...headers, host: url.host },
    family: options.family,
    ...(url.protocol === 'https:' && !ipaddr.isValid(hostname) ? { servername: hostname } : {}),
  };
}

function requestPinnedAddress(url: URL, options: WebhookRequestOptions): Promise<WebhookHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(createPinnedRequestOptions(url, options), (response) => {
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? '',
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
      }));
      response.resume();
    });

    request.setTimeout(options.timeoutMs, () => request.destroy(new Error('Webhook request timed out')));
    request.on('error', reject);
    request.end(options.body);
  });
}
