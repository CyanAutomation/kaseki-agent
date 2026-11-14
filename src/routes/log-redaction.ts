/**
 * Logs are operator-facing API responses, not a secret store. Keep enough
 * context to diagnose a failure while removing credential-bearing paths and
 * values that occasionally appear in Docker/provider diagnostics.
 */
const SECRET_FIELD_NAME = '(?:api[_-]?key|access[_-]?token|authorization|auth(?:[_-]?(?:key|token))?|bearer(?:[_-]?(?:key|token))?|client[_-]?secret|github[_-]?(?:api[_-]?)?token|openai[_-]?(?:api[_-]?)?key|private[_-]?key|refresh[_-]?token|secret(?:[_-]?(?:key|token))?|token|password|credential)';
const KEY_VALUE_SECRET_FIELD_NAME = '(?:api[_-]?key|access[_-]?token|auth(?:[_-]?(?:key|token))?|client[_-]?secret|github[_-]?(?:api[_-]?)?token|openai[_-]?(?:api[_-]?)?key|private[_-]?key|refresh[_-]?token|secret(?:[_-]?(?:key|token))?|token|password|credential)';

export function redactLogContent(content: string): string {
  return content
    .replace(/\/run\/secrets\/[^\s'"`]+/g, '[redacted secret path]')
    .replace(/\b(sha256_fingerprint\s*[=:]\s*)[a-f0-9]{32,}\b/gi, '$1[redacted]')
    .replace(new RegExp(`("${SECRET_FIELD_NAME}"\\s*:\\s*")(?:(?:\\\\.)|[^"\\\\])*(")`, 'gi'), '$1[redacted]$2')
    .replace(/\b(Authorization\s*:\s*)(?:(Bearer\s+)(?!\[redacted\b)[^\s,;]+|(?!Bearer\s+|\[redacted\b)[^\s,;]+)/gi, (_match, label: string, scheme?: string) => `${label}${scheme ?? ''}[redacted credential]`)
    .replace(new RegExp(`\\b(${KEY_VALUE_SECRET_FIELD_NAME}\\s*[=:]\\s*)(?!\\[redacted\\b)[^\\s,;]+`, 'gi'), '$1[redacted]')
    .replace(/\b(bearer(?:[_-]?(?:key|token))?\s*[=:]\s*)(?!\[redacted\b)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/gi, '[redacted credential]')
    .replace(/-----BEGIN [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----[\s\S]*?-----END [^-\n]*(?:PRIVATE KEY|OPENSSH PRIVATE KEY)-----/g, '[redacted private key]');
}
