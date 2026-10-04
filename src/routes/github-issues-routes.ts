/**
 * GitHub Issues Routes
 *
 * Provides endpoints for fetching and filtering GitHub issues:
 * - POST /api/v1/github-issues - Fetch filtered issues from a repository
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLogger } from '../logger';
import { sendErrorResponse } from '../utils/response-helpers';
import {
  parseGitHubUrl,
  generateGitHubAppToken,
  fetchGitHubIssues,
} from '../github-utils';

const logger = createLogger('github-issues-routes');

interface GitHubIssueResponse {
  number: number;
  title: string;
  body: string | null;
  url: string;
  created_at: string;
}

interface GitHubIssuesResponse {
  repoUrl: string;
  issueCount: number;
  issues: GitHubIssueResponse[];
}

const FetchIssuesRequestSchema = z.object({
  repoUrl: z.string().trim().min(1).max(500).optional(),
  repo: z.string().trim().min(1).max(500).optional(),
  label: z.string().trim().min(1).max(50).optional(),
  labels: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  /** Request issues regardless of label instead of applying the default label. */
  allLabels: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  state: z.enum(['open', 'closed', 'all']).optional(),
}).strict().refine((body) => Boolean(body.repoUrl || body.repo), 'repoUrl or repo is required');

function classifyGitHubDependencyFailure(message: string): { status: number; title: string; detail: string } {
  const normalized = message.toLowerCase();
  if (/enotfound|eai_again|econnrefused|econnreset|etimedout|timed out|socket hang up|fetch failed/.test(normalized)) {
    return {
      status: 503,
      title: 'GitHub API unavailable',
      detail: 'Kaseki could not reach GitHub. Check DNS, outbound HTTPS access, firewall or proxy rules, then retry.',
    };
  }
  if (/401|bad credentials|unauthorized/.test(normalized)) {
    return {
      status: 502,
      title: 'GitHub authentication failed',
      detail: 'GitHub rejected the GitHub App credentials or installation token. Check that the App ID and private key are current, the app is installed on this repository, and then retry to mint a fresh token.',
    };
  }
  if (/403|forbidden/.test(normalized)) {
    return {
      status: 502,
      title: 'GitHub access denied',
      detail: 'GitHub denied access to this repository. Confirm the GitHub App is installed and has permission to read Issues; if the request was rate limited, wait before retrying.',
    };
  }
  if (/404/.test(normalized)) {
    return {
      status: 404,
      title: 'Repository unavailable',
      detail: 'GitHub could not find this repository or the GitHub App cannot access it. Check the repository URL and app installation.',
    };
  }
  if (/not found|not configured|invalid key|private key/.test(normalized)) {
    return {
      status: 503,
      title: 'GitHub App is not configured',
      detail: 'GitHub App credentials are missing or invalid. Configure readable GITHUB_APP_ID_FILE and GITHUB_APP_PRIVATE_KEY_FILE secrets, then retry.',
    };
  }
  return {
    status: 502,
    title: 'GitHub API request failed',
    detail: 'Kaseki could not complete the request to GitHub. Check GitHub API availability and the App installation, then retry.',
  };
}

/**
 * POST /api/v1/github-issues
 * Fetch GitHub issues from a repository with optional filtering
 *
 * Request body:
 * {
 *   "repoUrl": "https://github.com/owner/repo" or "owner/repo",
 *   "label": "kaseki-agent" (optional, defaults to "kaseki-agent"),
 *   "labels": ["label1", "label2"] (optional, overrides label field),
 *   "limit": 5 (optional, max 100),
 *   "state": "open" (optional, "open" | "closed" | "all")
 * }
 *
 * Response:
 * {
 *   "repoUrl": "https://github.com/owner/repo",
 *   "issueCount": 1,
 *   "issues": [
 *     {
 *     "number": 123,
 *     "title": "Issue title",
 *     "body": "Issue body",
 *     "url": "https://github.com/owner/repo/issues/123",
 *     "created_at": "2026-05-30T..."
 *     }
 *   ]
 * }
 */
export function createGitHubIssuesRoutes(): Router {
  const router = Router();

  router.post('/github-issues', async (req: Request, res: Response) => {
    try {
      const parsedBody = FetchIssuesRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return sendErrorResponse(res, 400, 'Bad Request', 'Request body must contain a repository and only supported, valid filter fields');
      }
      const body = parsedBody.data;

      // Validate repo URL
      const repoUrl = body.repoUrl || body.repo;
      if (!repoUrl) {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          'Missing required field: repoUrl'
        );
      }

      const parsed = parseGitHubUrl(repoUrl);
      if (!parsed.isValid) {
        return sendErrorResponse(
          res,
          400,
          'Bad Request',
          `Invalid repository URL: ${parsed.error}`
        );
      }

      const { owner, repo } = parsed;

      // Prepare labels filter - default to "kaseki-agent" if not specified
      let labels = body.labels || [];
      if (labels.length === 0 && body.label) {
        labels = [body.label];
      }
      if (labels.length === 0 && !body.allLabels) {
        labels = ['kaseki-agent'];
      }

      // Get GitHub App access token
      logger.info(`Generating GitHub App token for ${owner}/${repo}`);
      const tokenResult = await generateGitHubAppToken(owner, repo);

      if (!tokenResult.token || tokenResult.error) {
        logger.error(`GitHub App token generation failed: ${tokenResult.error}`);
        const failure = classifyGitHubDependencyFailure(tokenResult.error || 'GitHub App token was not returned');
        return sendErrorResponse(
          res,
          failure.status,
          failure.title,
          failure.detail,
        );
      }

      const token = tokenResult.token;

      // Fetch issues
      logger.info(
        `Fetching issues from ${owner}/${repo} with labels: ${labels.join(',')}`
      );

      const issues = await fetchGitHubIssues(owner, repo, token, {
        labels,
        limit: body.limit ?? 5,
        state: body.state || 'open',
      });

      logger.info(`Found ${issues.length} issues matching criteria`);

      // Transform response - only include relevant fields
      const response: GitHubIssuesResponse = {
        repoUrl: `https://github.com/${owner}/${repo}`,
        issueCount: issues.length,
        issues: issues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          url: issue.url,
          created_at: issue.created_at,
        })),
      };

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`GitHub issues request failed: ${errorMessage}`);

      const failure = classifyGitHubDependencyFailure(errorMessage);
      return sendErrorResponse(res, failure.status, failure.title, failure.detail);
    }
  });

  return router;
}
