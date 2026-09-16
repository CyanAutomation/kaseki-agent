import { retryTransientGitHubRequest } from './github-utils';

describe('retryTransientGitHubRequest', () => {
  it('retries a transient GitHub timeout before succeeding', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('GitHub API request timed out after 15000ms while resolving installation'))
      .mockResolvedValueOnce(42);

    await expect(retryTransientGitHubRequest(operation, { attempts: 2, delayMs: 0 }))
      .resolves.toBe(42);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent GitHub authentication error', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('Failed to get installation ID: 401 bad credentials'));

    await expect(retryTransientGitHubRequest(operation, { attempts: 3, delayMs: 0 }))
      .rejects.toThrow('401 bad credentials');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
