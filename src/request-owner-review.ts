/**
 * Request repo owner as a reviewer on pull requests
 *
 * When a PR is created against a personal repository by the GitHub App,
 * this module automatically requests the repository owner as a reviewer.
 * This makes the PR appear in the owner's "Review requested" filter.
 *
 * Organization-owned repositories are skipped automatically.
 */

interface GitHubUser {
  login: string;
  type: 'User' | 'Organization';
  id: number;
}

interface GitHubRepository {
  name: string;
  owner: GitHubUser;
}

interface GitHubPullRequest {
  number: number;
  base: {
    repo: GitHubRepository;
  };
}

interface ReviewRequestPayload {
  reviewers: string[];
}

interface ReviewRequestResult {
  success: boolean;
  status: number;
  message: string;
  skipped: boolean;
  skippedReason?: string;
}

/**
 * Extract review request details from PR payload
 */
function extractReviewDetails(pr: GitHubPullRequest): {
  ownerLogin: string;
  ownerType: 'User' | 'Organization';
  prNumber: number;
  repoOwner: string;
  repoName: string;
} {
  const owner = pr.base.repo.owner;
  return {
    ownerLogin: owner.login,
    ownerType: owner.type,
    prNumber: pr.number,
    repoOwner: owner.login,
    repoName: pr.base.repo.name,
  };
}

/**
 * Determine if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  switch (status) {
    case 429: // Rate limited
    case 500:
    case 502:
    case 503:
    case 504: // Server errors
      return true;
    default:
      return false;
  }
}

/**
 * Request repository owner as a reviewer
 *
 * @param pr - GitHub PR payload
 * @param token - GitHub installation access token
 * @param makeFetch - Function to make HTTP requests (defaults to fetch)
 * @returns Result of the review request
 *
 * Returns success=true and skipped=true for organization repos (expected case).
 * Returns success=true and skipped=false for successful personal repo review requests.
 * Returns success=false for unexpected errors that couldn't be recovered.
 */
export async function requestOwnerReview(
  pr: GitHubPullRequest,
  token: string,
  makeFetch: (url: string, options: any) => Promise<Response> = fetch,
): Promise<ReviewRequestResult> {
  // Validate inputs
  if (!pr || !pr.base || !pr.base.repo || !pr.base.repo.owner || !token) {
    return {
      success: false,
      status: 0,
      message: 'Invalid PR payload or token',
      skipped: false,
    };
  }

  const { ownerLogin, ownerType, prNumber, repoOwner, repoName } =
    extractReviewDetails(pr);

  // Skip for organization repos (expected case, not an error)
  if (ownerType !== 'User') {
    return {
      success: true,
      status: 0,
      message: `Skipped: PR is on ${ownerType.toLowerCase()} repo`,
      skipped: true,
      skippedReason: `owner_type_is_${ownerType.toLowerCase()}`,
    };
  }

  // Build request payload
  const payload: ReviewRequestPayload = {
    reviewers: [ownerLogin],
  };

  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${prNumber}/requested_reviewers`;

  // Request with retry logic
  let lastStatus = 0;
  let lastError: Error | null = null;
  const maxRetries = 2;
  const baseBackoffMs = 2000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Backoff before retrying
      if (attempt > 0) {
        const backoffMs = baseBackoffMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      const response = await makeFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      lastStatus = response.status;

      // Handle successful response
      if (response.status === 201) {
        return {
          success: true,
          status: 201,
          message: `Requested review from ${ownerLogin} on PR #${prNumber}`,
          skipped: false,
        };
      }

      // Handle specific error cases
      if (response.status === 422) {
        // Already requested or validation error
        return {
          success: true,
          status: 422,
          message: `Owner already has review request pending or user cannot be requested`,
          skipped: false,
        };
      }

      if (response.status === 403) {
        // Permission error - don't retry, but non-fatal
        return {
          success: true,
          status: 403,
          message: 'GitHub App lacks permission to request reviewers (HTTP 403)',
          skipped: false,
        };
      }

      if (response.status === 404) {
        // Not found - don't retry, but non-fatal
        return {
          success: true,
          status: 404,
          message: `Could not find user ${ownerLogin} or PR #${prNumber} is not accessible`,
          skipped: false,
        };
      }

      // Retryable error
      if (isRetryableStatus(response.status)) {
        if (attempt < maxRetries) {
          continue; // Retry
        }
        // Max retries exhausted
        return {
          success: false,
          status: response.status,
          message: `GitHub API returned ${response.status} after ${maxRetries} retries`,
          skipped: false,
        };
      }

      // Unexpected status - don't retry
      return {
        success: true, // Non-fatal for PR creation
        status: response.status,
        message: `Unexpected HTTP status ${response.status} requesting owner review`,
        skipped: false,
      };
    } catch (error) {
      lastError = error as Error;

      // Network error - retryable
      if (attempt < maxRetries) {
        continue; // Retry
      }

      // Max retries exhausted
      return {
        success: false,
        status: 0,
        message: `Network error: ${lastError.message}`,
        skipped: false,
      };
    }
  }

  // Should not reach here, but handle just in case
  return {
    success: false,
    status: lastStatus || 0,
    message: lastError ? `Error: ${lastError.message}` : 'Unknown error',
    skipped: false,
  };
}

/**
 * Creates a mock fetch function for testing
 */
export function createMockFetch(
  responses: { status: number; body?: Record<string, unknown> }[],
): (url: string, options: any) => Promise<Response> {
  let callCount = 0;

  return async (_url: string, _options: any): Promise<Response> => {
    const responseConfig = responses[Math.min(callCount, responses.length - 1)];
    callCount++;

    return new Response(JSON.stringify(responseConfig.body || {}), {
      status: responseConfig.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
