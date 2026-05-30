/**
 * GitHub Issues Routes
 *
 * Provides endpoints for fetching and filtering GitHub issues:
 * - GET /api/github-issues - Fetch filtered issues from a repository
 */

import { Router, Request, Response } from 'express';
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

interface FetchIssuesRequest {
  repoUrl?: string;
  repo?: string;
  label?: string;
  labels?: string[];
  limit?: number;
  state?: 'open' | 'closed' | 'all';
}

/**
 * POST /api/github-issues
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
 * [
 *   {
 *     "number": 123,
 *     "title": "Issue title",
 *     "body": "Issue body",
 *     "url": "https://github.com/owner/repo/issues/123",
 *     "created_at": "2026-05-30T..."
 *   }
 * ]
 */
export function createGitHubIssuesRoutes(): Router {
  const router = Router();

  router.post('/github-issues', async (req: Request, res: Response) => {
    try {
      const body = req.body as FetchIssuesRequest;

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
      if (labels.length === 0) {
        labels = ['kaseki-agent'];
      }

      // Get GitHub App access token
      logger.info(`Generating GitHub App token for ${owner}/${repo}`);
      const tokenResult = await generateGitHubAppToken(owner, repo);

      if (!tokenResult.token || tokenResult.error) {
        logger.error(`GitHub App token generation failed: ${tokenResult.error}`);
        return sendErrorResponse(
          res,
          401,
          'Unauthorized',
          `GitHub App authentication failed: ${tokenResult.error}`
        );
      }

      const token = tokenResult.token;

      // Fetch issues
      logger.info(
        `Fetching issues from ${owner}/${repo} with labels: ${labels.join(',')}`
      );

      const issues = await fetchGitHubIssues(owner, repo, token, {
        labels,
        limit: body.limit || 5,
        state: body.state || 'open',
      });

      logger.info(`Found ${issues.length} issues matching criteria`);

      // Transform response - only include relevant fields
      const response: GitHubIssueResponse[] = issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body,
        url: issue.url,
        created_at: issue.created_at,
      }));

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`GitHub issues request failed: ${errorMessage}`);

      if (errorMessage.includes('404')) {
        return sendErrorResponse(
          res,
          404,
          'Not Found',
          'Repository not found'
        );
      }

      if (errorMessage.includes('401')) {
        return sendErrorResponse(
          res,
          401,
          'Unauthorized',
          'GitHub API authentication failed'
        );
      }

      return sendErrorResponse(
        res,
        500,
        'Internal Server Error',
        `Failed to fetch GitHub issues: ${errorMessage}`
      );
    }
  });

  return router;
}
