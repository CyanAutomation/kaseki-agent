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
});
