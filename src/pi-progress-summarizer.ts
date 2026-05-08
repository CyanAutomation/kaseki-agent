/**
 * Pi Progress Summarizer
 *
 * Extracts meaningful summaries from Pi coding agent events:
 * - File paths from tool operations
 * - Decision keywords from reasoning
 * - Error detection from tool outputs
 * - Elapsed time formatting
 */

import { ANSI_COLORS } from './ansi-colors.js';

interface EventSummary {
  action?: string; // Tool action with context (e.g., "read src/parser.ts")
  detail?: string; // Additional detail (e.g., "found 12 matches")
  level?: 'info' | 'warn' | 'error'; // Log level for coloring
  elapsed?: string; // Elapsed time since start
}

const DECISION_KEYWORDS = [
  'create',
  'modify',
  'delete',
  'fix',
  'implement',
  'refactor',
  'update',
  'add',
  'remove',
  'change',
  'improve',
  'optimize',
  'revise',
  'restructure',
];

const ERROR_PATTERNS = [
  'error',
  'failed',
  'failure',
  'exception',
  'cannot',
  'unable to',
  'invalid',
  'undefined',
  'null',
  'not found',
  'does not exist',
  'exit code',
  'exited with code',
  'exit',
];

/**
 * Extract file path from tool name or context
 * E.g., "read_file" with path in content → "src/parser.ts"
 */
export function extractFilePath(toolName: string, content?: string): string | null {
  if (!toolName) return null;

  // Handle common tool patterns that include paths
  const pathPatterns = [
    /read_file[:\s]+([^\s,\]]+)/i,
    /write_file[:\s]+([^\s,\]]+)/i,
    /grep_search[:\s]+([^\s,\]]+)/i,
    /file_search[:\s]+([^\s,\]]+)/i,
    /semantic_search[:\s]+([^\s,\]]+)/i,
    /find.*path[:\s]+([^\s,\]]+)/i,
    /path[:\s]+([^\s,\]]+)/i,
    /(?:^|\s)([./a-zA-Z0-9_-/]+\.[a-zA-Z0-9]+)(?:\s|$)/, // Generic file with extension
  ];

  if (content) {
    for (const pattern of pathPatterns) {
      const match = content.match(pattern);
      if (match && match[1]) {
        const candidate = match[1];
        // Only accept if it looks like a file path
        if (candidate.includes('/') || candidate.includes('.')) {
          return shortPath(candidate);
        }
      }
    }
  }

  // Map tool names to typical file operations
  const toolMap: Record<string, string> = {
    read_file: 'read',
    write_file: 'write',
    grep_search: 'grep',
    file_search: 'find',
    semantic_search: 'search',
    create_file: 'create',
    replace_string_in_file: 'edit',
    list_dir: 'list',
    bash: 'bash',
    ls: 'ls',
    cat: 'read',
    grep: 'grep',
    find: 'find',
  };

  return toolMap[toolName] || null;
}

/**
 * Shorten file paths for display
 * E.g., /workspaces/kaseki-agent/src/parser.ts → src/parser.ts
 */
function shortPath(path: string): string {
  if (!path) return '';
  // Remove leading slashes and absolute paths
  let shortened = path.replace(/^\/workspaces\/[^/]+\//, '');
  shortened = shortened.replace(/^\.\//, '');
  // Truncate long paths
  if (shortened.length > 40) {
    const parts = shortened.split('/');
    if (parts.length > 2) {
      shortened = '…/' + parts.slice(-2).join('/');
    }
  }
  return shortened;
}

/**
 * Detect if content contains decision keywords
 */
export function extractDecision(content?: string): string | null {
  if (!content) return null;

  const lowerContent = content.toLowerCase();
  for (const keyword of DECISION_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      // Return the full sentence or first 60 chars containing the keyword
      const idx = lowerContent.indexOf(keyword);
      const start = Math.max(0, idx - 20);
      const end = Math.min(content.length, idx + 50);
      const snippet = content.substring(start, end).trim();
      if (snippet.length > 5) {
        return snippet.replace(/\s+/g, ' ');
      }
      return keyword;
    }
  }
  return null;
}

/**
 * Detect errors in tool output
 */
export function detectError(content?: string): { hasError: boolean; snippet?: string } {
  if (!content) return { hasError: false };

  const lowerContent = content.toLowerCase();
  for (const pattern of ERROR_PATTERNS) {
    if (lowerContent.includes(pattern)) {
      // Find the sentence or snippet containing the error
      const idx = lowerContent.indexOf(pattern);
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + 60);
      const snippet = content.substring(start, end).trim();
      return { hasError: true, snippet };
    }
  }

  return { hasError: false };
}

/**
 * Summarize a Pi event for display in progress logs
 */
export function summarizeEvent(
  event: any,
  toolName: string,
  startTime: number
): EventSummary | null {
  const summary: EventSummary = {};

  // Extract tool action
  const filePath = extractFilePath(toolName, JSON.stringify(event).substring(0, 200));
  if (filePath) {
    summary.action = filePath;
  }

  // Check for errors in output
  const eventStr = JSON.stringify(event);
  const { hasError, snippet } = detectError(eventStr);
  if (hasError) {
    summary.level = 'error';
    if (snippet) {
      summary.detail = snippet.substring(0, 60);
    }
  }

  // Look for decision keywords in message content
  if (!hasError && event.message?.content) {
    const content = event.message.content;
    const contentText = Array.isArray(content)
      ? content.map((c: any) => c.text || c.content || '').join(' ')
      : String(content);

    const decision = extractDecision(contentText);
    if (decision) {
      summary.detail = decision.substring(0, 60);
    }
  }

  // Add elapsed time
  summary.elapsed = formatElapsed(startTime);

  return Object.keys(summary).length > 0 ? summary : null;
}

/**
 * Format elapsed time
 * E.g., 85000ms → "1m 25s"
 */
export function formatElapsed(startTime: number): string {
  const elapsed = Date.now() - startTime;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text: string | undefined, maxLen: number = 100): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}

/**
 * Format a progress message with color support
 */
export function formatProgressMessage(
  stage: string,
  action: string,
  detail?: string,
  level?: 'info' | 'warn' | 'error',
  elapsed?: string
): string {
  let message = action;

  if (detail) {
    message += ` | ${truncate(detail, 60)}`;
  }

  if (elapsed) {
    message += ` (${elapsed})`;
  }

  // Apply color based on level
  let coloredMessage = message;
  if (level === 'error') {
    coloredMessage = `${ANSI_COLORS.RED}${message}${ANSI_COLORS.RESET}`;
  } else if (level === 'warn') {
    coloredMessage = `${ANSI_COLORS.YELLOW}${message}${ANSI_COLORS.RESET}`;
  }

  return `[progress] ${stage}: ${coloredMessage}`;
}

/**
 * Sample rate controller for high-frequency events
 * Returns true if this event should be emitted
 */
export class EventSampler {
  private sampleRate: number = 10; // Emit 1 per N events
  private counter: number = 0;

  constructor(rate: number = 10) {
    this.sampleRate = Math.max(1, rate);
  }

  shouldEmit(): boolean {
    this.counter++;
    return this.counter % this.sampleRate === 0;
  }

  reset(): void {
    this.counter = 0;
  }
}
