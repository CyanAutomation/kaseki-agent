import { readFileSync } from 'node:fs';

/**
 * Result of resolving the OpenRouter API key from environment or file
 */
export interface ApiKeyResolutionResult {
  value?: string;
  configured: boolean;
  source?: 'env_var' | 'file' | 'none';
  error?: string;
}

/**
 * Resolves the OpenRouter API key for the OpenRouter decisions API classification endpoint.
 *
 * This follows kaseki-agent's standard API key resolution pattern:
 * 1. Check OPENROUTER_API_KEY_FILE (preferred for security)
 * 2. Fall back to OPENROUTER_API_KEY env var
 * 3. Report not configured if neither is available
 *
 * Used by classificationSmoke smoke test to evaluate code review scenarios.
 *
 * @returns Resolution result with value (if found), configured status, and source metadata
 */
export function resolveOpenRouterApiKey(): ApiKeyResolutionResult {
  const filePath = process.env.OPENROUTER_API_KEY_FILE;
  const fallbackResult: ApiKeyResolutionResult = {
    configured: false,
    source: 'none',
  };

  if (filePath) {
    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const trimmedContent = fileContent.trim();

      return {
        value: trimmedContent,
        configured: true,
        source: 'file',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to read OPENROUTER_API_KEY_FILE (${filePath}):`, errorMessage);
      fallbackResult.error = errorMessage;
    }
  }

  if (process.env.OPENROUTER_API_KEY !== undefined) {
    return {
      value: process.env.OPENROUTER_API_KEY,
      configured: true,
      source: 'env_var',
    };
  }

  if (fallbackResult.error) {
    return {
      configured: false,
      source: 'none',
      error: fallbackResult.error,
    };
  }

  return fallbackResult;
}
