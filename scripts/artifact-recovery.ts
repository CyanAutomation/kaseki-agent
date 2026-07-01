import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

type Phase = 'goal-setting' | 'scouting';

type RecoveryOptions = {
  phase: Phase;
  rawPath: string;
  candidatePath: string;
  resultsDir?: string;
};

function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
}

function collectBalancedJsonObjects(text: string): string[] {
  const snippets: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        snippets.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return snippets;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function goalSettingSchemaErrors(artifact: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(artifact)) return ['root must be an object'];
  if (!artifact.original_prompt || typeof artifact.original_prompt !== 'string') errors.push('original_prompt must be non-empty string');
  if (!artifact.upgraded_goal || typeof artifact.upgraded_goal !== 'string') errors.push('upgraded_goal must be non-empty string');
  if (!artifact.reasoning || typeof artifact.reasoning !== 'string') errors.push('reasoning must be non-empty string');
  if (!Array.isArray(artifact.key_requirements)) errors.push('key_requirements must be array');
  if (!Array.isArray(artifact.success_criteria)) errors.push('success_criteria must be array');
  return errors;
}

function scoutingSchemaErrors(artifact: unknown, strict = true): string[] {
  const errors: string[] = [];
  if (!isRecord(artifact)) return ['root must be an object'];
  if (!artifact.task || typeof artifact.task !== 'string') errors.push('task must be non-empty string');
  if (!strict) return errors;
  for (const field of ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact']) {
    if (!Array.isArray(artifact[field])) errors.push(`${field} must be array`);
  }
  return errors;
}

function logScoutingRecoveryDiagnostic(resultsDir: string, message: string, recovered: boolean): void {
  const entry = {
    timestamp: new Date().toISOString(),
    event: 'artifact_recovery',
    message,
    recovery_attempted: true,
    recovery_success: recovered,
  };
  try {
    fs.appendFileSync(`${resultsDir}/scouting-recovery-diagnostics.jsonl`, JSON.stringify(entry) + '\n');
  } catch {
    // Best-effort diagnostic only.
  }
}

export function recoverArtifactFromEventStream(options: RecoveryOptions): boolean {
  let text = '';
  try {
    text = fs.readFileSync(options.rawPath, 'utf8');
  } catch {
    return false;
  }

  const valid = new Map<string, Record<string, unknown>>();
  const partial = new Map<string, Record<string, unknown>>();
  const snippets = collectBalancedJsonObjects(text);

  const inspectCandidate = (candidate: unknown): void => {
    if (!isRecord(candidate)) return;
    if (options.phase === 'goal-setting') {
      if (goalSettingSchemaErrors(candidate).length === 0) valid.set(stableStringify(candidate), candidate);
      return;
    }
    if (scoutingSchemaErrors(candidate, true).length === 0) valid.set(stableStringify(candidate), candidate);
    else if (scoutingSchemaErrors(candidate, false).length === 0) partial.set(stableStringify(candidate), candidate);
  };

  for (const snippet of snippets) {
    try {
      const parsed = JSON.parse(snippet) as unknown;
      inspectCandidate(parsed);
      for (const innerText of collectStrings(parsed)) {
        for (const innerSnippet of collectBalancedJsonObjects(innerText)) {
          try {
            inspectCandidate(JSON.parse(innerSnippet) as unknown);
          } catch {
            // Ignore malformed embedded snippets.
          }
        }
      }
    } catch {
      // Ignore malformed top-level snippets.
    }
  }

  if (options.phase === 'goal-setting') {
    if (valid.size !== 1) return false;
    fs.writeFileSync(options.candidatePath, JSON.stringify([...valid.values()][0], null, 2) + '\n');
    return true;
  }

  const resultsDir = options.resultsDir ?? process.cwd();
  if (valid.size === 1) {
    fs.writeFileSync(options.candidatePath, JSON.stringify([...valid.values()][0], null, 2) + '\n');
    logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovered from event stream (strict validation passed)', true);
    return true;
  }
  if (partial.size === 1) {
    fs.writeFileSync(options.candidatePath, JSON.stringify([...partial.values()][0], null, 2) + '\n');
    logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovered from event stream (partial recovery - minimal fields only)', true);
    return true;
  }
  const candidates = [...valid.values(), ...partial.values()];
  if (candidates.length > 0) {
    const recovered = candidates.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
    fs.writeFileSync(options.candidatePath, JSON.stringify(recovered, null, 2) + '\n');
    logScoutingRecoveryDiagnostic(resultsDir, `Scouting artifact recovered from event stream (multiple candidates, selected best: ${Object.keys(recovered).length} fields)`, true);
    return true;
  }
  logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovery failed: no valid JSON objects found in event stream', false);
  return false;
}

function usage(): never {
  console.error('Usage: artifact-recovery <goal-setting|scouting> <raw-events.jsonl> <candidate.json> [results-dir]');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const phase = process.argv[2] as Phase | undefined;
  const rawPath = process.argv[3];
  const candidatePath = process.argv[4];
  const resultsDir = process.argv[5];
  if ((phase !== 'goal-setting' && phase !== 'scouting') || !rawPath || !candidatePath) usage();
  process.exit(recoverArtifactFromEventStream({ phase, rawPath, candidatePath, resultsDir }) ? 0 : 1);
}
