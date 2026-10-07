import * as path from 'node:path';

export interface RelevanceToolResultEvent {
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError: boolean;
}

export interface ContextReevaluationMessage {
  role?: string;
  toolName?: string;
  toolCallId?: string;
  tool_call_id?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface TrackedRead {
  path: string;
  estimatedTokens: number;
  stale: boolean;
  announced: boolean;
}

export interface ContextReevaluationEventSummary {
  invalidatedItems: number;
  trigger: 'file_modified' | 'none';
}

export interface ContextReevaluationResult {
  messages: ContextReevaluationMessage[];
  changed: boolean;
  staleItems: number;
  rewrittenMessages: number;
  newlyReevaluated: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

const MUTATING_FILE_TOOLS = new Set(['write', 'edit', 'hashline_edit']);
const MAX_TRACKED_READS = 200;

function resolvedPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return path.resolve(value.trim());
}

function eventPath(input: Record<string, unknown>): string | undefined {
  return resolvedPath(input.path ?? input.file_path ?? input.filePath ?? input.filename);
}

function outputText(content: Array<{ text?: string }>): string {
  return content.filter(item => typeof item.text === 'string').map(item => item.text).join('\n');
}

function estimatedTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 4);
}

function messageToolCallId(message: ContextReevaluationMessage): string | undefined {
  const value = message.toolCallId ?? message.tool_call_id;
  return typeof value === 'string' && value ? value : undefined;
}

function isToolResultMessage(message: ContextReevaluationMessage): boolean {
  return message.role === 'toolResult' || message.role === 'tool' || message.role === 'tool_result';
}

export class EventDrivenContextReevaluator {
  private readonly reads = new Map<string, TrackedRead>();

  constructor(private readonly options: { minTokens?: number; maxTrackedReads?: number } = {}) {}

  get trackedItemCount(): number {
    return this.reads.size;
  }

  observeToolResult(event: RelevanceToolResultEvent): ContextReevaluationEventSummary {
    if (event.isError) return { invalidatedItems: 0, trigger: 'none' };
    if (MUTATING_FILE_TOOLS.has(event.toolName)) {
      const changedPath = eventPath(event.input);
      if (!changedPath) return { invalidatedItems: 0, trigger: 'none' };
      let invalidatedItems = 0;
      for (const read of this.reads.values()) {
        if (!read.stale && read.path === changedPath) {
          read.stale = true;
          invalidatedItems += 1;
        }
      }
      return { invalidatedItems, trigger: invalidatedItems > 0 ? 'file_modified' : 'none' };
    }

    if (event.toolName !== 'read' || !event.toolCallId) return { invalidatedItems: 0, trigger: 'none' };
    const readPath = eventPath(event.input);
    if (!readPath) return { invalidatedItems: 0, trigger: 'none' };
    const tokens = estimatedTokens(outputText(event.content));
    if (tokens < (this.options.minTokens ?? 1500)) return { invalidatedItems: 0, trigger: 'none' };
    this.reads.delete(event.toolCallId);
    this.reads.set(event.toolCallId, { path: readPath, estimatedTokens: tokens, stale: false, announced: false });
    const maxReads = this.options.maxTrackedReads ?? MAX_TRACKED_READS;
    while (this.reads.size > maxReads) this.reads.delete(this.reads.keys().next().value as string);
    return { invalidatedItems: 0, trigger: 'none' };
  }

  reevaluateContext(messages: ContextReevaluationMessage[]): ContextReevaluationResult {
    const staleItems = [...this.reads.values()].filter(read => read.stale).length;
    let rewrittenMessages = 0;
    let newlyReevaluated = 0;
    let estimatedTokensBefore = 0;
    let estimatedTokensAfter = 0;
    const nextMessages = messages.map(message => {
      if (!message || !isToolResultMessage(message)) return message;
      const callId = messageToolCallId(message);
      const read = callId ? this.reads.get(callId) : undefined;
      if (!read?.stale) return message;
      const previousText = outputText((message.content || []) as Array<{ text?: string }>);
      const notice = `[Kaseki: earlier read of ${JSON.stringify(read.path)} is stale after a successful file edit. Reread this path before relying on the old contents.]`;
      estimatedTokensBefore += estimatedTokens(previousText);
      estimatedTokensAfter += estimatedTokens(notice);
      rewrittenMessages += 1;
      if (!read.announced) newlyReevaluated += 1;
      read.announced = true;
      return { ...message, content: [{ type: 'text', text: notice }] };
    });
    return {
      messages: nextMessages,
      changed: rewrittenMessages > 0,
      staleItems,
      rewrittenMessages,
      newlyReevaluated,
      estimatedTokensBefore,
      estimatedTokensAfter,
    };
  }
}
