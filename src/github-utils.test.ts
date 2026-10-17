import { retryTransientGitHubRequest } from './github-utils';
import * as hostSecretsReader from './secrets/host-secrets-reader';
import { resolveGitHubAppId } from './github-utils';

describe('resolveGitHubAppId', () => {
  const originalAppId = process.env.GITHUB_APP_ID;

  afterEach(() => {
    if (originalAppId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = originalAppId;
    jest.restoreAllMocks();
  });

  it('prefers a configured environment value and retains the legacy file fallback', () => {
    const readSecret = jest.spyOn(hostSecretsReader, 'readHostSecret').mockReturnValue('file-app-id');
    process.env.GITHUB_APP_ID = '123456';

    expect(resolveGitHubAppId()).toBe('123456');
    expect(readSecret).not.toHaveBeenCalled();

    delete process.env.GITHUB_APP_ID;
    expect(resolveGitHubAppId()).toBe('file-app-id');
  });
});

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
