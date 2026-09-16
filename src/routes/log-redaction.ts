/**
 * Logs are operator-facing API responses, not a secret store. Keep enough
 * context to diagnose a failure while removing credential-bearing paths and
 * values that occasionally appear in Docker/provider diagnostics.
 */
export function redactLogContent(content: string): string {
  return content
    .replace(/\/run\/secrets\/[^\s'"`]+/g, '[redacted secret path]')
    .replace(/\b(sha256_fingerprint\s*[=:]\s*)[a-f0-9]{32,}\b/gi, '$1[redacted]')
    .replace(/-----BEGIN [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g, '[redacted private key]');
}
