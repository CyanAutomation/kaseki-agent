/**
 * Provider Error Formatter
 *
 * Specializes in formatting provider error objects into user-friendly diagnostic messages.
 * Handles both structured provider errors and legacy provider error metadata.
 */

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export class ProviderErrorFormatter {
  /**
   * Format a structured provider error object into a diagnostic message.
   * Extracts message, type, phase, provider, model; combines into formatted string.
   */
  formatStructuredProviderError(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const error = value as Record<string, unknown>;
    const message = this.stringField(error, 'message');
    if (!message) return undefined;
    const type = this.stringField(error, 'type') ?? 'provider_error';
    const phase = this.stringField(error, 'phase');
    const provider = this.stringField(error, 'provider');
    const model = this.stringField(error, 'model');
    const context = [phase && `phase: ${phase}`, provider && `provider: ${provider}`, model && `model: ${model}`]
      .filter(Boolean);
    return this.cleanDiagnosticText(`${type}: ${message}${context.length ? ` (${context.join(', ')})` : ''}`);
  }

  /**
   * Format legacy provider error metadata into a diagnostic message.
   * Extracts from provider_error_* fields in failure JSON.
   */
  formatProviderError(failureJson: Record<string, unknown>): string | undefined {
    const message = this.stringField(failureJson, 'provider_error_message');
    if (!message) {
      return undefined;
    }

    const type = this.stringField(failureJson, 'provider_error_type') ?? 'provider_error';
    const phase = this.stringField(failureJson, 'provider_error_phase');
    const model = this.stringField(failureJson, 'provider_error_model');
    const context = [
      phase ? `phase: ${phase}` : undefined,
      model ? `model: ${model}` : undefined,
    ].filter(Boolean);
    return this.cleanDiagnosticText(`${type}: ${message}${context.length ? ` (${context.join(', ')})` : ''}`);
  }

  /**
   * Extract string field from error object
   */
  private stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0 ? this.cleanDiagnosticText(value) : undefined;
  }

  /**
   * Clean diagnostic text by removing ANSI codes and normalizing whitespace
   */
  private cleanDiagnosticText(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, '').replace(/\s+/g, ' ').trim();
  }
}
