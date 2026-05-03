export const SANITIZE_TOOL_NAME_MAX_LEN = 80;

export function sanitizeToolName(raw: string): string {
  const stripped = raw.replace(/<[^>]*>/g, '').trim();
  if (!stripped) return 'tool';
  return stripped.length > SANITIZE_TOOL_NAME_MAX_LEN
    ? stripped.slice(0, SANITIZE_TOOL_NAME_MAX_LEN)
    : stripped;
}
