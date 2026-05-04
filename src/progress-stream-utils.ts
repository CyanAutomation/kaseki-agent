export const SANITIZE_TOOL_NAME_MAX_LEN = 100;

export function sanitizeToolName(raw: string): string {
  const withoutTags = raw.replace(/<[^>]*>/g, ' ');
  const withoutControls = withoutTags.replace(/[\u0000-\u001F\u007F]/g, ' ');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'tool';
  return collapsed.length > SANITIZE_TOOL_NAME_MAX_LEN
    ? collapsed.slice(0, SANITIZE_TOOL_NAME_MAX_LEN)
    : collapsed;
}
