import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClassificationAnswer, QuestionDefinition } from '../types/openrouter-decisions';
import { CodeSummarizer } from '../summarization/code-summarizer';
import { redactJevEvidence } from '../jev-evidence-redaction';
import { EventDrivenContextReevaluator, type ContextReevaluationMessage } from './context-reevaluation';

export type CavemanToolOutputRoute = 'preserve' | 'compact_repeated' | 'structural_code' | 'discard';
export type ContextDisposition = 'preserve' | 'condense' | 'discard';

export interface ContextRoutingDecision {
  preserveProbability: number;
  condenseProbability: number;
  discardProbability: number;
  disposition: ContextDisposition;
  reason?: string;
}

export interface CavemanToolOutputContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface CavemanToolOutputEvent {
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  content: CavemanToolOutputContent[];
  isError: boolean;
}

export interface JevToolOutputDecision {
  answers?: Record<string, ClassificationAnswer>;
}

export interface CavemanToolOutputMetadata {
  phase: string;
  toolName: string;
  resultKind: 'source_code' | 'search_output' | 'command_output' | 'file_content' | 'other';
  isError: boolean;
  characters: number;
  bytes: number;
  approximateTokens: number;
  lineCount: number;
  consecutiveDuplicateLineRatio: number;
  hasReadRange: boolean;
  toolOutputTargetTokens?: number;
  overSoftToolOutputTarget?: boolean;
  operation?: string;
  changedState?: boolean;
  containsFailureSignal?: boolean;
  exitStatus?: number;
  filePath?: string;
}

export interface CavemanToolOutputResult {
  attempted: boolean;
  transformed: boolean;
  route: CavemanToolOutputRoute;
  reason: string;
  confidence?: number;
  inputChars: number;
  outputChars: number;
  savedChars: number;
  content: CavemanToolOutputContent[];
  metadata?: CavemanToolOutputMetadata;
  disposition?: ContextDisposition;
  decision?: ContextRoutingDecision;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  routingLatencyMs?: number;
}

export type ClassifyCavemanToolOutput = (
  state: CavemanToolOutputMetadata,
  questions: Record<string, QuestionDefinition>,
) => Promise<JevToolOutputDecision>;

export const CAVEMAN_TOOL_OUTPUT_QUESTIONS: Record<string, QuestionDefinition> = {
  route: {
    type: 'choice',
    instructions: 'Choose a safe local reduction using only the supplied output metadata. Raw tool text, task text, and command text are not included. Preserve exact content when uncertain, when the result is an error, or when a reduction could hide relevant evidence.',
    criteria: {
      preserve: 'Keep result exactly as returned. Use for errors, exact evidence, code requiring implementation details, unfamiliar output, or uncertainty.',
      compact_repeated: 'For successful bash/search results with a high ratio of consecutive repeated lines, replace repeated runs with their exact line and an explicit repeat count. Do not alter any other line.',
      structural_code: 'For a large, full-file TypeScript or JavaScript read, return an AST structural preview only when a follow-up exact read of the same workspace path can recover implementation details.',
    },
  },
};

export const SEMANTIC_CONTEXT_ROUTING_QUESTIONS: Record<string, QuestionDefinition> = {
  disposition: {
    type: 'choice',
    instructions: 'Choose whether this tool result should enter the current coding context in full, as a condensed representation, or be safely omitted. Use only the bounded metadata and goal summary provided. Preserve failure evidence, exact source details needed for implementation, state-changing operation evidence, and uncertainty. Condense repetitive successful output or large context that remains useful at lower fidelity. Discard only clearly routine, redundant output that cannot affect the current task.',
    criteria: {
      preserve: 'Retain the complete original output because exact details or evidence may matter.',
      condense: 'Keep useful information but at lower fidelity; deterministic local Caveman reduction will perform the transformation.',
      discard: 'Output is clearly irrelevant or redundant and safe to omit from active context; lightweight metadata will remain.',
    },
  },
};

const DEFAULT_MIN_CHARS = 6_000;
const LEVEL_THREE_MIN_CHARS = 3_000;
const MAX_STRUCTURAL_SUMMARY_BYTES = 256_000;
const MIN_COMPACT_SAVINGS_CHARS = 128;
const MIN_COMPACT_SAVINGS_RATIO = 0.12;
const MIN_STRUCTURAL_SAVINGS_CHARS = 500;
const MIN_STRUCTURAL_SAVINGS_RATIO = 0.3;
const DEFAULT_DISCARD_THRESHOLD = 0.98;
const DEFAULT_CONDENSE_THRESHOLD = 0.7;

function operationCategory(event: CavemanToolOutputEvent): string {
  if (event.toolName !== 'bash' && event.toolName !== 'powershell') return event.toolName;
  const command = typeof event.input.command === 'string' ? event.input.command.trim().toLowerCase() : '';
  if (/^git\s+(?:add|checkout|switch|reset|commit|merge|rebase|push|pull|fetch|tag|clean|cherry-pick|stash|revert|apply)\b/.test(command)
    || /^git\s+branch\s+(?:-(?:d|D|m|c)\b|--(?:delete|move|copy)\b)/.test(command)
    || /^gh\s+pr\s+(?:create|merge|close|edit|ready|reopen|review|comment)\b/.test(command)
    || /^(?:curl|wget)\b.*(?:-x\s*(?:post|put|patch|delete)|--request\s+(?:post|put|patch|delete)|--data(?:-raw|-binary)?\b|(?:^|\s)-d(?:\s|$))/.test(command)
    || /^(?:npm|pnpm|yarn|bun)\s+install\b/.test(command)
    || /^(?:rm|mv|mkdir|touch)\b/.test(command)
    || /^sed\s+-i\b/.test(command)
    || /^apply_patch\b/.test(command)) return 'state_change';
  if (/^git\s+status\b/.test(command)) return 'git_status';
  if (/^git\s+branch\b/.test(command)) return 'git_branch_state';
  if (/^gh\s+pr\b/.test(command)) return 'pull_request_state';
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|typecheck|check)\b/.test(command)) return 'package_quality_check';
  if (/^git\s+(?:diff|log|show)\b/.test(command)) return 'git_inspection';
  if (/^(?:rg|grep|find|fd)\b/.test(command)) return 'repository_search';
  return 'shell_operation';
}

function boundedGoalSummary(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const redacted = String(redactJevEvidence(value)).replace(/\s+/g, ' ').trim();
  return redacted.slice(0, 1200);
}

export function readSemanticGoalSummary(resultsDirectory: string, taskPrompt = ''): string | undefined {
  let goal: Record<string, unknown> = {};
  try {
    const goalPath = path.join(resultsDirectory, 'goal-setting.json');
    if (fs.statSync(goalPath).size > 128 * 1024) return boundedGoalSummary(taskPrompt);
    const parsed: unknown = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) goal = parsed as Record<string, unknown>;
  } catch { /* Goal artifacts are optional; retain bounded task prompt as fallback. */ }
  const candidate = [goal.upgraded_goal, goal.objective, goal.goal, taskPrompt]
    .find((item) => typeof item === 'string' && item.trim());
  return boundedGoalSummary(candidate);
}

function getText(event: CavemanToolOutputEvent): string | undefined {
  if (event.content.length !== 1 || event.content[0]?.type !== 'text' || typeof event.content[0].text !== 'string') {
    return undefined;
  }
  return event.content[0].text;
}

function getReadPath(event: CavemanToolOutputEvent): string | undefined {
  return typeof event.input.path === 'string' ? event.input.path : undefined;
}

function resultKind(event: CavemanToolOutputEvent): CavemanToolOutputMetadata['resultKind'] {
  if (event.toolName === 'read') {
    const extension = path.extname(getReadPath(event) || '').toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) return 'source_code';
    return 'file_content';
  }
  if (['grep', 'search', 'find'].includes(event.toolName)) return 'search_output';
  if (event.toolName === 'bash' || event.toolName === 'powershell') return 'command_output';
  return 'other';
}

function isRouteCandidate(event: CavemanToolOutputEvent): boolean {
  if (['bash', 'grep', 'search', 'find'].includes(event.toolName)) return true;
  if (event.toolName !== 'read' || event.input.offset !== undefined || event.input.limit !== undefined) return false;
  return resultKind(event) === 'source_code';
}

function repeatedLineRatio(text: string): { lineCount: number; ratio: number } {
  const lines = text.split('\n');
  const meaningfulLines = lines.filter((line, index) => !(index === lines.length - 1 && line === '') && line.trim() !== '').length;
  let repeatedLines = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== '' && lines[index] === lines[index - 1]) repeatedLines += 1;
  }
  return {
    lineCount: lines.length - (lines.at(-1) === '' ? 1 : 0),
    ratio: meaningfulLines > 0 ? repeatedLines / meaningfulLines : 0,
  };
}

export function buildCavemanToolOutputMetadata(
  event: CavemanToolOutputEvent,
  text: string,
  options: { phase?: string; toolOutputTargetTokens?: number } = {},
): CavemanToolOutputMetadata {
  const repetitions = repeatedLineRatio(text);
  const bytes = Buffer.byteLength(text, 'utf8');
  const approximateTokens = Math.ceil(bytes / 4);
  const hasReadRange = event.input.offset !== undefined || event.input.limit !== undefined;
  const target = options.toolOutputTargetTokens;
  return {
    phase: options.phase || 'coding',
    toolName: event.toolName,
    resultKind: resultKind(event),
    isError: event.isError,
    characters: text.length,
    bytes,
    approximateTokens,
    lineCount: repetitions.lineCount,
    consecutiveDuplicateLineRatio: Number(repetitions.ratio.toFixed(3)),
    hasReadRange,
    operation: operationCategory(event),
    changedState: operationCategory(event) === 'state_change',
    containsFailureSignal: /(?:\berror\b|\bfailed\b|\bfailure\b|\b(?:fatal|uncaught exception|security finding|vulnerability|permission denied|conflict|rejected)\b)/i.test(text),
    ...(Number.isInteger(event.input.exitCode) ? { exitStatus: Number(event.input.exitCode) } : {}),
    ...(getReadPath(event) ? { filePath: String(redactJevEvidence(getReadPath(event))).slice(0, 256) } : {}),
    ...(target && target > 0 ? {
      toolOutputTargetTokens: target,
      overSoftToolOutputTarget: approximateTokens > target,
    } : {}),
  };
}

function semanticDisposition(
  answer: ClassificationAnswer | undefined,
  thresholds: { discard: number; condense: number },
): ContextRoutingDecision {
  if (!answer || answer.type !== 'choice' || !['preserve', 'condense', 'discard'].includes(answer.choice)) {
    return { preserveProbability: 1, condenseProbability: 0, discardProbability: 0, disposition: 'preserve', reason: 'invalid_jev_answer' };
  }
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
    return { preserveProbability: 1, condenseProbability: 0, discardProbability: 0, disposition: 'preserve', reason: 'invalid_jev_probabilities' };
  }
  const preserveProbability = probabilities.preserve;
  const condenseProbability = probabilities.condense;
  const discardProbability = probabilities.discard;
  if (![preserveProbability, condenseProbability, discardProbability].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return { preserveProbability: 1, condenseProbability: 0, discardProbability: 0, disposition: 'preserve', reason: 'invalid_jev_probabilities' };
  }
  const probabilityTotal = preserveProbability + condenseProbability + discardProbability;
  if (Math.abs(probabilityTotal - 1) > 0.03 || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    return { preserveProbability: 1, condenseProbability: 0, discardProbability: 0, disposition: 'preserve', reason: 'invalid_jev_probabilities' };
  }
  if (answer.choice === 'discard' && discardProbability >= thresholds.discard) {
    return { preserveProbability, condenseProbability, discardProbability, disposition: 'discard' };
  }
  if (answer.choice === 'condense' && condenseProbability >= thresholds.condense) {
    return { preserveProbability, condenseProbability, discardProbability, disposition: 'condense' };
  }
  return { preserveProbability, condenseProbability, discardProbability, disposition: 'preserve', reason: 'below_disposition_threshold' };
}

function protectedEvidence(event: CavemanToolOutputEvent, text: string): boolean {
  if (event.isError) return true;
  if (operationCategory(event) === 'state_change') return true;
  if (['git_status', 'git_branch_state', 'pull_request_state'].includes(operationCategory(event))) return true;
  return /(?:\berror\b|\bfailed\b|\bfailure\b|\b(?:fatal|uncaught exception|security finding|vulnerability|permission denied|conflict|rejected)\b)/i.test(text);
}

export async function routeSemanticToolOutput(
  event: CavemanToolOutputEvent,
  classify: ClassifyCavemanToolOutput,
  options: {
    enabled?: boolean;
    minTokens?: number;
    discardThreshold?: number;
    condenseThreshold?: number;
    phase?: string;
    toolOutputTargetTokens?: number;
    goalSummary?: string;
  } = {},
): Promise<CavemanToolOutputResult> {
  const text = getText(event);
  if (text === undefined) return { ...preserved(event, '', 'unsupported_content'), disposition: 'preserve', estimatedInputTokens: 0, estimatedOutputTokens: 0 };
  const inputTokens = Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  if (options.enabled === false) return { ...preserved(event, text, 'router_disabled'), disposition: 'preserve', estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens };
  if (protectedEvidence(event, text)) return { ...preserved(event, text, event.isError ? 'tool_error' : 'protected_evidence'), disposition: 'preserve', estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens };
  if (!isRouteCandidate(event)) return { ...preserved(event, text, 'tool_not_eligible'), disposition: 'preserve', estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens };
  const minTokens = options.minTokens ?? 1500;
  if (inputTokens < minTokens) return { ...preserved(event, text, 'below_minimum_size'), disposition: 'preserve', estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens };

  const metadata = buildCavemanToolOutputMetadata(event, text, options);
  if (metadata.consecutiveDuplicateLineRatio >= 0.9) {
    const repeatedCompaction = compactResult(event, text);
    if (repeatedCompaction !== undefined) {
      const outputTokens = Math.ceil(Buffer.byteLength(repeatedCompaction, 'utf8') / 4);
      return {
        attempted: false,
        transformed: true,
        route: 'compact_repeated',
        reason: 'deterministic_repeated_output',
        inputChars: text.length,
        outputChars: repeatedCompaction.length,
        savedChars: text.length - repeatedCompaction.length,
        content: [{ ...event.content[0], text: repeatedCompaction }],
        metadata,
        disposition: 'condense',
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
      };
    }
  }
  const started = performance.now();
  let decision: JevToolOutputDecision;
  try {
    const goalSummary = boundedGoalSummary(options.goalSummary);
    decision = await classify({ ...metadata, ...(goalSummary ? { goalSummary } : {}) }, SEMANTIC_CONTEXT_ROUTING_QUESTIONS);
  } catch {
    return { ...preserved(event, text, 'jev_unavailable', { attempted: true, metadata }), disposition: 'preserve', estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens, routingLatencyMs: Math.round(performance.now() - started) };
  }
  const routingLatencyMs = Math.round(performance.now() - started);
  const dispositionAnswer = (decision as JevToolOutputDecision | undefined)?.answers?.disposition;
  const selected = semanticDisposition(dispositionAnswer, {
    discard: options.discardThreshold ?? DEFAULT_DISCARD_THRESHOLD,
    condense: options.condenseThreshold ?? DEFAULT_CONDENSE_THRESHOLD,
  });
  if (selected.disposition === 'preserve') {
    return { ...preserved(event, text, selected.reason || 'jev_preserved', { attempted: true, metadata, confidence: dispositionAnswer?.type === 'choice' ? dispositionAnswer.confidence : undefined }), disposition: 'preserve', decision: selected, estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens, routingLatencyMs };
  }
  if (selected.disposition === 'discard') {
    const marker = `[Kaseki omitted routine ${event.toolName} output; operation=${metadata.operation}; estimated_tokens=${inputTokens}; result=${event.isError ? 'error' : 'successful-or-unknown'}.]`;
    return { attempted: true, transformed: true, route: 'discard', reason: 'jev_selected_conservative_discard', confidence: dispositionAnswer?.type === 'choice' ? dispositionAnswer.confidence : undefined, inputChars: text.length, outputChars: marker.length, savedChars: text.length - marker.length, content: [{ type: 'text', text: marker }], metadata, disposition: 'discard', decision: selected, estimatedInputTokens: inputTokens, estimatedOutputTokens: Math.ceil(Buffer.byteLength(marker) / 4), routingLatencyMs };
  }
  const repeatedCompaction = compactResult(event, text);
  const transformed = repeatedCompaction ?? summarizeCodeRead(event, text);
  if (transformed === undefined) {
    return { ...preserved(event, text, 'condense_unavailable_preserved', { attempted: true, metadata }), disposition: 'preserve', decision: { ...selected, disposition: 'preserve', reason: 'condense_unavailable_preserved' }, estimatedInputTokens: inputTokens, estimatedOutputTokens: inputTokens, routingLatencyMs };
  }
  return {
    attempted: true,
    transformed: true,
    route: repeatedCompaction !== undefined ? 'compact_repeated' : 'structural_code',
    reason: 'jev_selected_condense_caveman_transform',
    confidence: dispositionAnswer?.type === 'choice' ? dispositionAnswer.confidence : undefined,
    inputChars: text.length,
    outputChars: transformed.length,
    savedChars: text.length - transformed.length,
    content: [{ ...event.content[0], text: transformed }],
    metadata,
    disposition: 'condense',
    decision: selected,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: Math.ceil(Buffer.byteLength(transformed, 'utf8') / 4),
    routingLatencyMs,
  };
}

function preserved(
  event: CavemanToolOutputEvent,
  text: string,
  reason: string,
  options: { attempted?: boolean; metadata?: CavemanToolOutputMetadata; confidence?: number; route?: CavemanToolOutputRoute } = {},
): CavemanToolOutputResult {
  return {
    attempted: options.attempted ?? false,
    transformed: false,
    route: options.route || 'preserve',
    reason,
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    inputChars: text.length,
    outputChars: text.length,
    savedChars: 0,
    content: event.content,
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

function selectedRoute(
  decision: JevToolOutputDecision | undefined,
  confidenceThreshold: number,
): { route: CavemanToolOutputRoute; confidence?: number; reason?: string } {
  const answer = decision?.answers?.route;
  if (!answer || answer.type !== 'choice' || !['preserve', 'compact_repeated', 'structural_code'].includes(answer.choice)) {
    return { route: 'preserve', reason: 'invalid_jev_answer' };
  }
  if (!Number.isFinite(answer.confidence) || answer.confidence < confidenceThreshold) {
    return { route: 'preserve', confidence: answer.confidence, reason: 'low_confidence' };
  }
  return { route: answer.choice as CavemanToolOutputRoute, confidence: answer.confidence };
}

function compactRepeatedLines(text: string): string {
  const lines = text.split('\n');
  const compacted: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    let end = index + 1;
    if (line !== '') {
      while (end < lines.length && lines[end] === line) end += 1;
    }
    const runLength = end - index;
    compacted.push(line);
    if (runLength > 1) compacted.push(`[Kaseki Caveman: previous exact line repeated ${runLength - 1} additional times]`);
    index = end;
  }
  return compacted.join('\n');
}

function compactResult(event: CavemanToolOutputEvent, text: string): string | undefined {
  if (event.isError || !['bash', 'grep', 'search', 'find'].includes(event.toolName)) return undefined;
  const compacted = compactRepeatedLines(text);
  const saved = text.length - compacted.length;
  if (saved < MIN_COMPACT_SAVINGS_CHARS || saved / Math.max(1, text.length) < MIN_COMPACT_SAVINGS_RATIO) return undefined;
  return compacted;
}

function summarizeCodeRead(event: CavemanToolOutputEvent, text: string): string | undefined {
  if (event.isError || event.toolName !== 'read' || event.input.offset !== undefined || event.input.limit !== undefined) return undefined;
  const filePath = getReadPath(event);
  if (!filePath) return undefined;
  const extension = path.extname(filePath).toLowerCase();
  const language = extension === '.ts' || extension === '.tsx'
    ? 'typescript'
    : extension === '.js' || extension === '.jsx'
      ? 'javascript'
      : undefined;
  if (!language || Buffer.byteLength(text, 'utf8') > MAX_STRUCTURAL_SUMMARY_BYTES) return undefined;

  const summarizer = new CodeSummarizer(language);
  const summary = summarizer.summarize(text, 500);
  if (summary.parseError) return undefined;
  const structureCount = summary.imports.length + summary.exports.length + summary.classes.length + summary.functions.length + summary.types.length + summary.interfaces.length;
  if (structureCount === 0) return undefined;

  const preview = summarizer.formatAsMarkdown(summary);
  const compacted = [
    `Kaseki structural preview for ${JSON.stringify(filePath)} (${summary.originalSizeBytes} bytes). Exact implementation details are omitted.`,
    preview,
    `To inspect exact code, use the read tool on ${JSON.stringify(filePath)} with a focused offset/limit.`,
  ].join('\n\n');
  const saved = text.length - compacted.length;
  if (saved < MIN_STRUCTURAL_SAVINGS_CHARS || saved / Math.max(1, text.length) < MIN_STRUCTURAL_SAVINGS_RATIO) return undefined;
  return compacted;
}

export async function routeToolOutput(
  event: CavemanToolOutputEvent,
  classify: ClassifyCavemanToolOutput,
  options: {
    enabled?: boolean;
    minChars?: number;
    confidenceThreshold?: number;
    phase?: string;
    toolOutputTargetTokens?: number;
  } = {},
): Promise<CavemanToolOutputResult> {
  const text = getText(event);
  if (text === undefined) {
    return { ...preserved(event, '', 'unsupported_content'), inputChars: 0, outputChars: 0 };
  }
  if (options.enabled === false) return preserved(event, text, 'router_disabled');
  if (event.isError) return preserved(event, text, 'tool_error');
  if (!isRouteCandidate(event)) return preserved(event, text, 'tool_not_eligible');
  if (text.length < (options.minChars ?? DEFAULT_MIN_CHARS)) return preserved(event, text, 'below_minimum_size');

  const metadata = buildCavemanToolOutputMetadata(event, text, options);
  let decision: JevToolOutputDecision;
  try {
    decision = await classify(metadata, CAVEMAN_TOOL_OUTPUT_QUESTIONS);
  } catch {
    return preserved(event, text, 'jev_unavailable', { attempted: true, metadata });
  }

  const selected = selectedRoute(decision, options.confidenceThreshold ?? 0.86);
  if (selected.route === 'preserve') {
    return preserved(event, text, selected.reason || 'jev_preserved', {
      attempted: true,
      metadata,
      confidence: selected.confidence,
    });
  }

  const transformed = selected.route === 'compact_repeated'
    ? compactResult(event, text)
    : summarizeCodeRead(event, text);
  if (transformed === undefined) {
    return preserved(event, text, 'route_not_applicable_or_insufficient_savings', {
      attempted: true,
      metadata,
      confidence: selected.confidence,
      route: selected.route,
    });
  }

  const outputChars = transformed.length;
  return {
    attempted: true,
    transformed: true,
    route: selected.route,
    reason: 'jev_selected_high_confidence_transform',
    confidence: selected.confidence,
    inputChars: text.length,
    outputChars,
    savedChars: text.length - outputChars,
    content: [{ ...event.content[0], text: transformed }],
    metadata,
  };
}

export function cavemanToolOutputRouterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const level = Number.parseInt(env.KASEKI_CAVEMAN_LEVEL || '2', 10);
  return env.KASEKI_CAVEMAN !== '0' && level >= 2 && (env.KASEKI_CAVEMAN_ROUTER || 'jev') === 'jev';
}

export function cavemanToolOutputRouterMinChars(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number.parseInt(env.KASEKI_CAVEMAN_ROUTER_MIN_CHARS || '', 10);
  if (Number.isInteger(configured) && configured > 0) return configured;
  const level = Number.parseInt(env.KASEKI_CAVEMAN_LEVEL || '2', 10);
  return level >= 3 ? LEVEL_THREE_MIN_CHARS : DEFAULT_MIN_CHARS;
}

export interface CavemanPiExtension {
  on(
    event: 'tool_result',
    handler: (event: CavemanToolOutputEvent) => Promise<{ content: CavemanToolOutputContent[] } | undefined>,
  ): unknown;
  on(
    event: 'context',
    handler: (event: { messages: ContextReevaluationMessage[] }) => { messages: ContextReevaluationMessage[] } | undefined,
  ): unknown;
}

function recordContextReevaluation(
  resultsDirectory: string,
  phase: string,
  summary: { staleItems: number; rewrittenMessages: number; newlyReevaluated: number; estimatedTokensBefore: number; estimatedTokensAfter: number },
): void {
  if (!summary.newlyReevaluated) return;
  const diagnosticPath = path.join(resultsDirectory, 'caveman-routing.jsonl');
  const payload = {
    timestamp: new Date().toISOString(),
    event_type: 'event_reevaluation',
    trigger: 'successful_same_path_file_edit',
    phase,
    stale_items: summary.staleItems,
    rewritten_messages: summary.rewrittenMessages,
    newly_reevaluated: summary.newlyReevaluated,
    estimated_input_tokens: summary.estimatedTokensBefore,
    estimated_output_tokens: summary.estimatedTokensAfter,
    estimated_tokens_saved: Math.max(0, summary.estimatedTokensBefore - summary.estimatedTokensAfter),
  };
  try {
    fs.mkdirSync(resultsDirectory, { recursive: true });
    const fd = fs.openSync(diagnosticPath, 'a', 0o600);
    try { fs.writeSync(fd, `${JSON.stringify(payload)}\n`); } finally { fs.closeSync(fd); }
  } catch {
    // Event reevaluation telemetry must never change context behavior.
  }
}

function recordRoutingDiagnostic(
  result: CavemanToolOutputResult,
  phase: string,
  resultsDirectory: string,
  event: CavemanToolOutputEvent,
): void {
  if (!resultsDirectory) return;
  const diagnosticPath = path.join(resultsDirectory, 'caveman-routing.jsonl');
  const payload = {
    timestamp: new Date().toISOString(),
    phase,
    tool_name: event.toolName,
    operation: result.metadata?.operation || operationCategory(event),
    semantic_router_enabled: result.disposition !== undefined,
    attempted: result.attempted,
    route: result.route,
    transformed: result.transformed,
    reason: result.reason,
    confidence: result.confidence ?? null,
    input_chars: result.inputChars,
    output_chars: result.outputChars,
    saved_chars: result.savedChars,
    disposition: result.disposition || (result.transformed ? 'condense' : 'preserve'),
    decision_probabilities: result.decision ? {
      preserve: result.decision.preserveProbability,
      condense: result.decision.condenseProbability,
      discard: result.decision.discardProbability,
    } : null,
    jev_evaluated: result.attempted,
    jev_failed: result.reason === 'jev_unavailable' || result.reason.startsWith('invalid_jev'),
    deterministic_bypass: !result.attempted,
    category: result.metadata?.resultKind || resultKind(event),
    estimated_input_tokens: result.estimatedInputTokens ?? result.metadata?.approximateTokens ?? Math.ceil(result.inputChars / 4),
    estimated_output_tokens: result.estimatedOutputTokens ?? Math.ceil(result.outputChars / 4),
    estimated_tokens_saved: Math.max(0, (result.estimatedInputTokens ?? result.metadata?.approximateTokens ?? Math.ceil(result.inputChars / 4)) - (result.estimatedOutputTokens ?? Math.ceil(result.outputChars / 4))),
    routing_latency_ms: result.routingLatencyMs ?? null,
    caveman_reduction_triggered: result.reason === 'jev_selected_condense_caveman_transform',
    metadata: result.metadata ? { ...result.metadata, filePath: undefined } : null,
  };
  try {
    fs.mkdirSync(resultsDirectory, { recursive: true });
    const fd = fs.openSync(diagnosticPath, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(payload)}\n`);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Routing diagnostics are best effort; they must not change model behavior.
  }
}

export function installCavemanToolOutputRouter(
  pi: CavemanPiExtension,
  classify: ClassifyCavemanToolOutput,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const phase = env.KASEKI_INFERENCE_PHASE || 'coding';
  const semanticEnabled = env.KASEKI_SEMANTIC_CONTEXT_ROUTER_ENABLED !== '0' && phase === 'coding';
  const reevaluationEnabled = semanticEnabled && env.KASEKI_SEMANTIC_CONTEXT_REEVALUATION_ENABLED !== '0';
  const resultsDirectory = env.KASEKI_RESULTS_DIR || '/results';
  const configuredSemanticMinTokens = Number.parseInt(env.KASEKI_SEMANTIC_CONTEXT_MIN_TOKENS || '1500', 10);
  const semanticMinTokens = Number.isInteger(configuredSemanticMinTokens) && configuredSemanticMinTokens > 0
    ? configuredSemanticMinTokens
    : 1500;
  const reevaluator = reevaluationEnabled
    ? new EventDrivenContextReevaluator({ minTokens: semanticMinTokens })
    : undefined;
  const goalSummary = semanticEnabled && cavemanToolOutputRouterEnabled(env)
    ? readSemanticGoalSummary(resultsDirectory, env.TASK_PROMPT || '')
    : undefined;
  pi.on('tool_result', async (event) => {
    try { reevaluator?.observeToolResult(event); } catch { /* Relevance tracking must not block tool results. */ }
    const enabled = cavemanToolOutputRouterEnabled(env);
    const threshold = Number.parseFloat(env.KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD || '0.86');
    const toolOutputTargetTokens = Number.parseInt(env.KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS || '', 10);
    const discardThreshold = Number.parseFloat(env.KASEKI_SEMANTIC_CONTEXT_DISCARD_THRESHOLD || '0.98');
    const condenseThreshold = Number.parseFloat(env.KASEKI_SEMANTIC_CONTEXT_CONDENSE_THRESHOLD || '0.7');
    let result: CavemanToolOutputResult;
    try {
      result = semanticEnabled
        ? await routeSemanticToolOutput(event, classify, {
          enabled,
          minTokens: semanticMinTokens,
          discardThreshold: Number.isFinite(discardThreshold) && discardThreshold >= 0 && discardThreshold <= 1 ? discardThreshold : DEFAULT_DISCARD_THRESHOLD,
          condenseThreshold: Number.isFinite(condenseThreshold) && condenseThreshold >= 0 && condenseThreshold <= 1 ? condenseThreshold : DEFAULT_CONDENSE_THRESHOLD,
          phase,
          goalSummary,
          ...(Number.isInteger(toolOutputTargetTokens) && toolOutputTargetTokens > 0 ? { toolOutputTargetTokens } : {}),
        })
        : await routeToolOutput(event, classify, {
          enabled,
          minChars: cavemanToolOutputRouterMinChars(env),
          confidenceThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.86,
          phase,
          ...(Number.isInteger(toolOutputTargetTokens) && toolOutputTargetTokens > 0 ? { toolOutputTargetTokens } : {}),
        });
    } catch {
      // Unexpected routing or transformation errors must leave the Pi result untouched.
      result = preserved(event, getText(event) || '', 'router_unexpected_error');
    }
    recordRoutingDiagnostic(result, phase, resultsDirectory, event);
    return result.transformed ? { content: result.content } : undefined;
  });
  if (reevaluator) {
    try {
      pi.on('context', (event) => {
        if (!Array.isArray(event?.messages)) return undefined;
        try {
          const reevaluated = reevaluator.reevaluateContext(event.messages);
          if (!reevaluated.changed) return undefined;
          recordContextReevaluation(resultsDirectory, phase, reevaluated);
          return { messages: reevaluated.messages };
        } catch {
          // Invalid context messages stay untouched; the hook must fail open.
          return undefined;
        }
      });
    } catch {
      // Older Pi extensions may not support context hooks; keep tool-output routing active.
    }
  }
}
