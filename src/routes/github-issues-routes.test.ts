jest.mock('../logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), error: jest.fn() })),
}));

jest.mock('../github-utils', () => ({
  parseGitHubUrl: jest.fn(),
  generateGitHubAppToken: jest.fn(),
  fetchGitHubIssues: jest.fn(),
}));

import express from 'express';
import { Server } from 'http';
import { createGitHubIssuesRoutes } from './github-issues-routes';
import * as githubUtils from '../github-utils';

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve, reject) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
    nextServer.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('github-issues-routes', () => {
  let server: Server;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    jest.clearAllMocks();
  });

  async function postValidIssuesRequest(): Promise<Response> {
    const app = express();
    app.use(express.json());
    app.use(createGitHubIssuesRoutes());
    const started = await listen(app);
    server = started.server;
    return fetch(`${started.url}/github-issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'CyanAutomation/tako-bako' }),
    });
  }

  it('returns the documented issue envelope', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ token: 'installation-token' });
    (githubUtils.fetchGitHubIssues as jest.Mock).mockResolvedValue([{
      number: 29,
      title: 'Improve the README',
      body: 'Clarify the quick start.',
      url: 'https://github.com/CyanAutomation/tako-bako/issues/29',
      created_at: '2026-09-02T00:00:00.000Z',
    }]);

    const app = express();
    app.use(express.json());
    app.use(createGitHubIssuesRoutes());
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/github-issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'CyanAutomation/tako-bako' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      repoUrl: 'https://github.com/CyanAutomation/tako-bako',
      issueCount: 1,
      issues: [{
        number: 29,
        title: 'Improve the README',
        body: 'Clarify the quick start.',
        url: 'https://github.com/CyanAutomation/tako-bako/issues/29',
        created_at: '2026-09-02T00:00:00.000Z',
      }],
    });
  });

  it('forwards an explicitly selected label instead of silently using the default', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ token: 'installation-token' });
    (githubUtils.fetchGitHubIssues as jest.Mock).mockResolvedValue([]);

    const app = express();
    app.use(express.json());
    app.use(createGitHubIssuesRoutes());
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/github-issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'CyanAutomation/tako-bako', label: 'documentation' }),
    });

    expect(response.status).toBe(200);
    expect(githubUtils.fetchGitHubIssues).toHaveBeenCalledWith(
      'CyanAutomation', 'tako-bako', 'installation-token',
      expect.objectContaining({ labels: ['documentation'] }),
    );
  });

  it('explains how to configure missing GitHub App credentials', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ error: 'GitHub App ID not found' });

    const response = await postValidIssuesRequest();
    const body = await response.json() as any;

    expect(response.status).toBe(503);
    expect(body.title).toBe('GitHub App is not configured');
    expect(body.detail).toMatch(/GITHUB_APP_ID_FILE.*GITHUB_APP_PRIVATE_KEY_FILE/);
    expect(githubUtils.fetchGitHubIssues).not.toHaveBeenCalled();
  });

  it('explains how to recover when GitHub rejects its installation token', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ token: 'installation-token' });
    (githubUtils.fetchGitHubIssues as jest.Mock).mockRejectedValue(new Error('GitHub API error: 401'));

    const response = await postValidIssuesRequest();
    const body = await response.json() as any;

    expect(response.status).toBe(502);
    expect(body.title).toBe('GitHub authentication failed');
    expect(body.detail).toMatch(/App ID and private key.*installed on this repository.*mint a fresh token/i);
  });

  it('reports GitHub API connectivity failures with network recovery steps', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ token: 'installation-token' });
    (githubUtils.fetchGitHubIssues as jest.Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'));

    const response = await postValidIssuesRequest();
    const body = await response.json() as any;

    expect(response.status).toBe(503);
    expect(body.title).toBe('GitHub API unavailable');
    expect(body.detail).toMatch(/DNS.*outbound HTTPS.*firewall/i);
  });

  it('allows callers to explicitly request issues with every label', async () => {
    (githubUtils.parseGitHubUrl as jest.Mock).mockReturnValue({ isValid: true, owner: 'CyanAutomation', repo: 'tako-bako' });
    (githubUtils.generateGitHubAppToken as jest.Mock).mockResolvedValue({ token: 'installation-token' });
    (githubUtils.fetchGitHubIssues as jest.Mock).mockResolvedValue([]);

    const app = express();
    app.use(express.json());
    app.use(createGitHubIssuesRoutes());
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/github-issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'CyanAutomation/tako-bako', allLabels: true }),
    });

    expect(response.status).toBe(200);
    expect(githubUtils.fetchGitHubIssues).toHaveBeenCalledWith(
      'CyanAutomation', 'tako-bako', 'installation-token',
      expect.objectContaining({ labels: [] }),
    );
  });

  it.each([
    [{ repoUrl: 'CyanAutomation/tako-bako', limit: 0 }],
    [{ repoUrl: 'CyanAutomation/tako-bako', limit: 101 }],
    [{ repoUrl: 'CyanAutomation/tako-bako', state: 'draft' }],
    [{ repoUrl: 'CyanAutomation/tako-bako', labels: ['valid', ''] }],
    [{ repoUrl: 'CyanAutomation/tako-bako', allLabels: 'true' }],
  ])('rejects invalid input before making GitHub calls: %j', async (body) => {
    const app = express();
    app.use(express.json());
    app.use(createGitHubIssuesRoutes());
    const started = await listen(app);
    server = started.server;

    const response = await fetch(`${started.url}/github-issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(githubUtils.generateGitHubAppToken).not.toHaveBeenCalled();
    expect(githubUtils.fetchGitHubIssues).not.toHaveBeenCalled();
  });
});
