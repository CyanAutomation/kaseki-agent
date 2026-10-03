import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPinnedRequestOptions, postWebhookSafely, WebhookEgressPolicyError } from './safe-webhook-http';

describe('postWebhookSafely', () => {
  test.each([
    'http://example.com/hook',
    'http://127.0.0.1/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://2130706433/hook',
    'https://user:pass@example.com/hook',
  ])('rejects unsafe target %s before sending', async (url) => {
    const request = jest.fn();

    await expect(postWebhookSafely(url, '{}', {}, {
      lookup: async (hostname) => [{ address: hostname, family: hostname.includes(':') ? 6 : 4 }],
      request,
    })).rejects.toBeInstanceOf(WebhookEgressPolicyError);

    expect(request).not.toHaveBeenCalled();
  });

  test('rejects mixed public and private DNS answers', async () => {
    const request = jest.fn();
    await expect(postWebhookSafely('https://hooks.example.test/hook', '{}', {}, {
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.8', family: 4 },
      ],
      request,
    })).rejects.toBeInstanceOf(WebhookEgressPolicyError);
    expect(request).not.toHaveBeenCalled();
  });

  test('pins the request to a validated DNS answer', async () => {
    const request = jest.fn(async (_url, _options) => ({
      status: 204,
      statusText: 'No Content',
      ok: true,
    }));

    const response = await postWebhookSafely('https://hooks.example.test/hook', '{"event":"x"}', {}, {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request,
    });

    expect(response.status).toBe(204);
    expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      address: '93.184.216.34',
      family: 4,
    }));
  });

  test('uses the validated address as the socket host while preserving the webhook authority', () => {
    const requestOptions = createPinnedRequestOptions(
      new URL('https://hooks.example.test:8443/notify?event=complete'),
      {
        address: '93.184.216.34',
        family: 4,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        timeoutMs: 10_000,
      },
    );

    expect(requestOptions).toMatchObject({
      protocol: 'https:',
      hostname: '93.184.216.34',
      port: 8443,
      path: '/notify?event=complete',
      family: 4,
      servername: 'hooks.example.test',
      headers: {
        'Content-Type': 'application/json',
        host: 'hooks.example.test:8443',
      },
    });
  });

  test('allows explicitly allowlisted internal receivers and does not follow redirects', async () => {
    let receivedHost: string | undefined;
    let receivedAddress: string | undefined;
    const server = createServer((req, res) => {
      receivedHost = req.headers.host;
      receivedAddress = req.socket.remoteAddress;
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
      res.end('redirect');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await postWebhookSafely(`http://127.0.0.1:${port}/hook`, '{}', {}, {
        allowedOrigins: [`http://127.0.0.1:${port}`],
      });
      expect(response.status).toBe(302);
      expect(receivedHost).toBe(`127.0.0.1:${port}`);
      expect(receivedAddress).toBe('127.0.0.1');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
