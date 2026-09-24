type JsonObject = Record<string, unknown>;

export function redactJevEvidence(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s,;]+/gi, 'Authorization: Bearer [REDACTED_CREDENTIAL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/g, 'Bearer [REDACTED_CREDENTIAL]')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/(https?:\/\/[^:/\s]+):([^@/\s]+)@/gi, '$1:[REDACTED_CREDENTIAL]@')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED_SECRET]');
  if (Array.isArray(value)) return value.map(redactJevEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as JsonObject).map(([key, item]) => [key, /secret|token|password|credential|api.?key/i.test(key) ? '[REDACTED_SECRET]' : redactJevEvidence(item)]),
  );
  return value;
}
