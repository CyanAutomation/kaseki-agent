import { LocalKasekiApiClient } from './LocalKasekiApiClient';
import { ConfigManager } from '../../config/ConfigManager';

describe('LocalKasekiApiClient', () => {
  const originalApiKey = process.env.KASEKI_API_KEY;
  const originalApiKeys = process.env.KASEKI_API_KEYS;
  const originalApiBaseUrl = process.env.KASEKI_API_BASE_URL;

  beforeEach(() => {
    delete process.env.KASEKI_API_KEY;
    delete process.env.KASEKI_API_KEYS;
    delete process.env.KASEKI_API_BASE_URL;
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.KASEKI_API_KEY;
    else process.env.KASEKI_API_KEY = originalApiKey;
    if (originalApiKeys === undefined) delete process.env.KASEKI_API_KEYS;
    else process.env.KASEKI_API_KEYS = originalApiKeys;
    if (originalApiBaseUrl === undefined) delete process.env.KASEKI_API_BASE_URL;
    else process.env.KASEKI_API_BASE_URL = originalApiBaseUrl;
    jest.restoreAllMocks();
  });

  test('posts runs without Authorization header for unauthenticated local mode', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'kaseki-1', status: 'queued', createdAt: '2026-05-14T00:00:00.000Z' }),
    } as Response);
    const client = new LocalKasekiApiClient({ baseUrl: 'http://localhost:8080/api' });

    await client.createRun({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/runs', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  test('uses KASEKI_API_KEY as a bearer token and honors configured base URL', async () => {
    process.env.KASEKI_API_KEY = 'test-api-key';
    process.env.KASEKI_API_BASE_URL = 'http://127.0.0.1:9090/api';
    const configManager = new ConfigManager();
    await configManager.load();

    const client = LocalKasekiApiClient.fromConfig(configManager);

    expect(client.baseUrl).toBe('http://127.0.0.1:9090/api');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'kaseki-2', status: 'queued', createdAt: '2026-05-14T00:00:00.000Z' }),
    } as Response);

    await client.createRun({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9090/api/runs', expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-api-key',
      },
    }));
  });

  test('treats empty KASEKI_API_KEYS as unauthenticated local mode', async () => {
    process.env.KASEKI_API_KEY = '';
    process.env.KASEKI_API_BASE_URL = 'http://localhost:8080/api';
    process.env.KASEKI_API_KEYS = '';
    const configManager = new ConfigManager();
    await configManager.load();
    const client = LocalKasekiApiClient.fromConfig(configManager);

    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'kaseki-3', status: 'queued', createdAt: '2026-05-14T00:00:00.000Z' }),
    } as Response);

    await client.createRun({ repoUrl: 'https://github.com/org/repo', ref: 'main' });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/runs', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  test('gets runs and status from local API endpoints', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          runs: [{ id: 'kaseki-1', status: 'completed', createdAt: '2026-05-14T00:00:00.000Z', exitCode: 0 }],
          total: 1,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'kaseki-1', status: 'completed', exitCode: 0 }),
      } as Response);
    const client = new LocalKasekiApiClient({ baseUrl: 'http://localhost:8080/api' });

    await expect(client.listRuns()).resolves.toMatchObject({ total: 1 });
    await expect(client.getRunStatus('kaseki-1')).resolves.toMatchObject({ id: 'kaseki-1', status: 'completed' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:8080/api/runs', { headers: {} });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:8080/api/runs/kaseki-1/status', { headers: {} });
  });
});
