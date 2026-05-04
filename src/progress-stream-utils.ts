export const SANITIZE_TOOL_NAME_MAX_LEN = 100;

export function sanitizeToolName(raw: string): string {
  const withoutTags = raw.replace(/<[^>]*>/g, ' ');
  const withoutControls = Array.from(withoutTags, (char) => {
    const code = char.charCodeAt(0);
    return (code <= 0x1f || code === 0x7f) ? ' ' : char;
  }).join('');
  const collapsed = withoutControls.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'tool';
  return collapsed.length > SANITIZE_TOOL_NAME_MAX_LEN
    ? collapsed.slice(0, SANITIZE_TOOL_NAME_MAX_LEN)
    : collapsed;
}
