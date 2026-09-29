import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ClassificationAnswer, QuestionDefinition } from '../types/openrouter-decisions';
import { CodeSummarizer } from '../summarization/code-summarizer';

export type CavemanToolOutputRoute = 'preserve' | 'compact_repeated' | 'structural_code';

export interface CavemanToolOutputContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface CavemanToolOutputEvent {
  toolName: string;
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

const DEFAULT_MIN_CHARS = 6_000;
const LEVEL_THREE_MIN_CHARS = 3_000;
const MAX_STRUCTURAL_SUMMARY_BYTES = 256_000;
const MIN_COMPACT_SAVINGS_CHARS = 128;
const MIN_COMPACT_SAVINGS_RATIO = 0.12;
const MIN_STRUCTURAL_SAVINGS_CHARS = 500;
const MIN_STRUCTURAL_SAVINGS_RATIO = 0.3;

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
    ...(target && target > 0 ? {
      toolOutputTargetTokens: target,
      overSoftToolOutputTarget: approximateTokens > target,
    } : {}),
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
  decision: JevToolOutputDecision,
  confidenceThreshold: number,
): { route: CavemanToolOutputRoute; confidence?: number; reason?: string } {
  const answer = decision.answers?.route;
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
}

function recordRoutingDiagnostic(
  result: CavemanToolOutputResult,
  phase: string,
  resultsDirectory: string,
): void {
  if (!resultsDirectory) return;
  const diagnosticPath = path.join(resultsDirectory, 'caveman-routing.jsonl');
  const payload = {
    timestamp: new Date().toISOString(),
    phase,
    attempted: result.attempted,
    route: result.route,
    transformed: result.transformed,
    reason: result.reason,
    confidence: result.confidence ?? null,
    input_chars: result.inputChars,
    output_chars: result.outputChars,
    saved_chars: result.savedChars,
    metadata: result.metadata ?? null,
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
  pi.on('tool_result', async (event) => {
    const enabled = cavemanToolOutputRouterEnabled(env);
    const threshold = Number.parseFloat(env.KASEKI_CAVEMAN_ROUTER_CONFIDENCE_THRESHOLD || '0.86');
    const toolOutputTargetTokens = Number.parseInt(env.KASEKI_PHASE_MAX_TOOL_OUTPUT_TOKENS || '', 10);
    const result = await routeToolOutput(event, classify, {
      enabled,
      minChars: cavemanToolOutputRouterMinChars(env),
      confidenceThreshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 ? threshold : 0.86,
      phase: env.KASEKI_INFERENCE_PHASE || 'coding',
      ...(Number.isInteger(toolOutputTargetTokens) && toolOutputTargetTokens > 0 ? { toolOutputTargetTokens } : {}),
    });
    if (result.attempted) {
      recordRoutingDiagnostic(result, env.KASEKI_INFERENCE_PHASE || 'coding', env.KASEKI_RESULTS_DIR || '/results');
    }
    return result.transformed ? { content: result.content } : undefined;
  });
}
