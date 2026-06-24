/**
 * Provider Diagnostic Logging Module
 *
 * Captures and logs detailed diagnostic information about provider issues
 * to help with debugging and monitoring.
 *
 * Features:
 * - Structured logging of empty assistant turns
 * - Response body capture (when available)
 * - Token usage tracking
 * - Provider-specific metrics
 * - Deduplication to avoid log spam
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ProviderDiagnostic {
  timestamp: string;
  phase: string; // 'scouting', 'goal-setting', 'coding', etc.
  provider: string;
  api: string;
  model: string;
  responseId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  errorType: string; // 'empty_assistant_turn', 'malformed_response', etc.
  errorMessage: string;
  suggestedAction: string;
  fullResponseBody?: string; // Optional: full response for deep debugging
}

export class ProviderDiagnosticsLogger {
  private diagnosticsPath: string;
  private seenErrors: Set<string> = new Set();
  private writeBuffer: ProviderDiagnostic[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(resultsDir: string = '/results') {
    this.diagnosticsPath = path.join(resultsDir, 'provider-diagnostics.jsonl');
  }

  /**
   * Log an empty assistant turn with full diagnostic info
   */
  logEmptyAssistantTurn(
    phase: string,
    provider: string,
    api: string,
    model: string,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    responseId: string | undefined,
    fullResponse?: unknown
  ): void {
    const errorKey = `${provider}:${api}:${model}:${outputTokens || 0}`;

    // Deduplicate: only log each unique error once per session
    if (this.seenErrors.has(errorKey)) {
      return;
    }
    this.seenErrors.add(errorKey);

    const diagnostic: ProviderDiagnostic = {
      timestamp: new Date().toISOString(),
      phase,
      provider,
      api,
      model,
      responseId,
      inputTokens,
      outputTokens,
      totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      errorType: 'empty_assistant_turn',
      errorMessage: `Provider ${provider} returned successful HTTP response (${api} API) but with zero assistant content despite claiming ${outputTokens} output tokens`,
      suggestedAction:
        provider === 'gateway'
          ? 'Check LLM gateway (manifest.scheimann.xyz) openai-responses adapter. May need to: (1) Validate response deserialization, (2) Check response.message.content population, (3) Retry with explicit model instead of auto-routing'
          : 'Provider issue; try direct provider (not via gateway), or fallback to different model',
      ...(fullResponse ? { fullResponseBody: JSON.stringify(fullResponse, null, 2) } : {}),
    };

    this.writeBuffer.push(diagnostic);

    // Auto-flush after a short delay to batch writes
    if (!this.flushInterval) {
      this.flushInterval = setTimeout(() => this.flush(), 100);
    }
  }

  /**
   * Log a malformed response
   */
  logMalformedResponse(
    phase: string,
    provider: string,
    api: string,
    model: string,
    reason: string,
    fullResponse?: unknown
  ): void {
    const errorKey = `malformed:${provider}:${api}:${reason}`;

    if (this.seenErrors.has(errorKey)) {
      return;
    }
    this.seenErrors.add(errorKey);

    const diagnostic: ProviderDiagnostic = {
      timestamp: new Date().toISOString(),
      phase,
      provider,
      api,
      model,
      errorType: 'malformed_response',
      errorMessage: `Provider response structure is invalid: ${reason}`,
      suggestedAction: `Verify provider is returning valid ${api} response format. Check provider logs and error codes.`,
      ...(fullResponse ? { fullResponseBody: JSON.stringify(fullResponse, null, 2) } : {}),
    };

    this.writeBuffer.push(diagnostic);

    if (!this.flushInterval) {
      this.flushInterval = setTimeout(() => this.flush(), 100);
    }
  }

  /**
   * Log a provider timeout or network error
   */
  logProviderError(
    phase: string,
    provider: string,
    api: string,
    model: string,
    errorType: string,
    errorMessage: string
  ): void {
    const errorKey = `${provider}:${api}:${errorType}`;

    if (this.seenErrors.has(errorKey)) {
      return;
    }
    this.seenErrors.add(errorKey);

    const diagnostic: ProviderDiagnostic = {
      timestamp: new Date().toISOString(),
      phase,
      provider,
      api,
      model,
      errorType,
      errorMessage,
      suggestedAction: this.suggestActionForError(errorType, provider),
    };

    this.writeBuffer.push(diagnostic);

    if (!this.flushInterval) {
      this.flushInterval = setTimeout(() => this.flush(), 100);
    }
  }

  /**
   * Suggest an action based on error type
   */
  private suggestActionForError(errorType: string, provider: string): string {
    const suggestions: Record<string, string> = {
      timeout: 'Increase KASEKI_AGENT_TIMEOUT_SECONDS or check provider availability',
      rate_limit: 'Wait and retry; may need to reduce concurrent requests or upgrade API plan',
      auth_error: 'Verify API key is valid and has sufficient credits',
      model_not_found: 'Update KASEKI_MODEL to an available model; check provider docs',
      connection_error: `Check network connectivity to ${provider}; verify firewall rules`,
      quota_exceeded: 'Add credits to provider account or wait for quota reset',
    };

    return suggestions[errorType] || 'Check provider logs and contact support if issue persists';
  }

  /**
   * Flush buffered diagnostics to file
   */
  flush(): void {
    if (this.flushInterval) {
      clearTimeout(this.flushInterval);
      this.flushInterval = null;
    }

    if (this.writeBuffer.length === 0) {
      return;
    }

    try {
      const lines = this.writeBuffer
        .map((d) => JSON.stringify(d))
        .join('\n');

      if (fs.existsSync(this.diagnosticsPath)) {
        fs.appendFileSync(this.diagnosticsPath, '\n' + lines);
      } else {
        fs.writeFileSync(this.diagnosticsPath, lines);
      }

      this.writeBuffer = [];
    } catch (error) {
      // Silently fail to avoid blocking on logging errors
      console.error(`Failed to write provider diagnostics: ${error}`);
    }
  }

  /**
   * Get all diagnostics that have been logged
   */
  getAll(): ProviderDiagnostic[] {
    return Array.from(this.seenErrors).map((key) => {
      // This is a simplified version; in real usage, you'd track the full diagnostic
      return {
        timestamp: new Date().toISOString(),
        phase: 'unknown',
        provider: 'unknown',
        api: 'unknown',
        model: 'unknown',
        errorType: 'unknown',
        errorMessage: key,
        suggestedAction: 'Check logs for details',
      };
    });
  }

  /**
   * Get summary of diagnostics
   */
  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const key of this.seenErrors) {
      summary[key] = (summary[key] ?? 0) + 1;
    }
    return summary;
  }
}

/**
 * Singleton instance for application-wide use
 */
let globalLogger: ProviderDiagnosticsLogger | null = null;

export function initializeProviderDiagnosticsLogger(resultsDir?: string): ProviderDiagnosticsLogger {
  globalLogger = new ProviderDiagnosticsLogger(resultsDir);
  return globalLogger;
}

export function getProviderDiagnosticsLogger(): ProviderDiagnosticsLogger {
  if (!globalLogger) {
    globalLogger = new ProviderDiagnosticsLogger();
  }
  return globalLogger;
}
