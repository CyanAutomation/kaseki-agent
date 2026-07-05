/**
 * Runtime Error Extractor
 *
 * Specializes in extracting and formatting terminal runtime errors from stderr output.
 * Identifies Error stack traces and ERROR wrapper messages from failed command execution.
 */

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export class RuntimeErrorExtractor {
  /**
   * Extract terminal runtime error from stderr tail in failure JSON.
   * Looks for Error stack traces or ERROR wrapper messages; pairs with failed_command if available.
   */
  extractTerminalRuntimeError(failureJson: Record<string, unknown>): string | undefined {
    const stderrTail = this.stringField(failureJson, 'stderr_tail');
    if (!stderrTail) return undefined;

    const lines = stderrTail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const runtimeError = lines.find((line) =>
      /^Error(?:\s+\[[A-Z0-9_]+\])?:/.test(line) || /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)/.test(line)
    );
    const wrapperError = lines.find((line) => /^ERROR:\s+/.test(line));
    const error = runtimeError ?? wrapperError;
    if (!error) return undefined;

    const failedCommand = this.stringField(failureJson, 'failed_command');
    return failedCommand ? `${failedCommand}: ${error}` : error;
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
