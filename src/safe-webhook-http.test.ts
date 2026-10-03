import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { postWebhookSafely, WebhookEgressPolicyError } from './safe-webhook-http';

describe('postWebhookSafely', () => {
  test.each([
    'http://example.com/hook',
    'http://127.0.0.1/hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
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
    const request = jest.fn(async (_url, options) => ({
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

  test('allows explicitly allowlisted internal receivers and does not follow redirects', async () => {
    const server = createServer((_req, res) => {
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
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
