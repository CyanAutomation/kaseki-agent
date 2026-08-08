/** Sanitize bounded, single-line artifact text for safe Markdown display. */
export function sanitizeScorecardText(value: unknown, limit = 180): string {
  const clean = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '').replace(/gh[pousr]_[A-Za-z0-9_]+/gi, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/gi, '[redacted]').replace(/(?:api|access|auth|bearer|github|openai|secret|token|password|credential)[_-]?(?:key|token|secret|password)?\s*[=:]\s*\S+/gi, '[redacted]').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(0, limit - 3))}...`;
}
