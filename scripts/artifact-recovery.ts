import fs from 'node:fs';

export type Phase = 'goal-setting' | 'scouting';

export type RecoveryOptions = {
  phase: Phase;
  rawPath: string;
  candidatePath: string;
  resultsDir?: string;
};

type RecoveryCandidates = {
  valid: Map<string, Record<string, unknown>>;
  partial: Map<string, Record<string, unknown>>;
};

export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
}

export function collectBalancedJsonObjects(text: string): string[] {
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

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function goalSettingSchemaErrors(artifact: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(artifact)) return ['root must be an object'];
  if (!artifact.original_prompt || typeof artifact.original_prompt !== 'string') errors.push('original_prompt must be non-empty string');
  if (!artifact.upgraded_goal || typeof artifact.upgraded_goal !== 'string') errors.push('upgraded_goal must be non-empty string');
  if (!artifact.reasoning || typeof artifact.reasoning !== 'string') errors.push('reasoning must be non-empty string');
  if (!Array.isArray(artifact.key_requirements)) errors.push('key_requirements must be array');
  if (!Array.isArray(artifact.success_criteria)) errors.push('success_criteria must be array');
  return errors;
}

export function scoutingSchemaErrors(artifact: unknown, strict = true): string[] {
  const errors: string[] = [];
  if (!isRecord(artifact)) return ['root must be an object'];
  if (!artifact.task || typeof artifact.task !== 'string') errors.push('task must be non-empty string');
  if (!strict) return errors;
  for (const field of ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact']) {
    if (!Array.isArray(artifact[field])) errors.push(`${field} must be array`);
  }
  return errors;
}

export function logScoutingRecoveryDiagnostic(resultsDir: string, message: string, recovered: boolean): void {
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

function inspectCandidate(candidate: unknown, phase: Phase, candidates: RecoveryCandidates): void {
  if (!isRecord(candidate)) return;
  const key = stableStringify(candidate);
  if (phase === 'goal-setting') {
    if (goalSettingSchemaErrors(candidate).length === 0) candidates.valid.set(key, candidate);
    return;
  }
  if (scoutingSchemaErrors(candidate, true).length === 0) candidates.valid.set(key, candidate);
  else if (scoutingSchemaErrors(candidate, false).length === 0) candidates.partial.set(key, candidate);
}

function collectRecoveryCandidates(text: string, phase: Phase): RecoveryCandidates {
  const candidates: RecoveryCandidates = {
    valid: new Map<string, Record<string, unknown>>(),
    partial: new Map<string, Record<string, unknown>>(),
  };

  for (const snippet of collectBalancedJsonObjects(text)) {
    try {
      const parsed = JSON.parse(snippet) as unknown;
      inspectCandidate(parsed, phase, candidates);
      for (const innerText of collectStrings(parsed)) {
        for (const innerSnippet of collectBalancedJsonObjects(innerText)) {
          try {
            inspectCandidate(JSON.parse(innerSnippet) as unknown, phase, candidates);
          } catch {
            // Ignore malformed embedded snippets.
          }
        }
      }
    } catch {
      // Ignore malformed top-level snippets.
    }
  }

  return candidates;
}

function writeRecoveredArtifact(candidatePath: string, artifact: Record<string, unknown>): void {
  fs.writeFileSync(candidatePath, JSON.stringify(artifact, null, 2) + '\n');
}

function recoverGoalSettingArtifact(candidatePath: string, candidates: RecoveryCandidates): boolean {
  if (candidates.valid.size !== 1) return false;
  writeRecoveredArtifact(candidatePath, [...candidates.valid.values()][0]);
  return true;
}

function recoverScoutingArtifact(
  candidatePath: string,
  resultsDir: string,
  candidates: RecoveryCandidates,
): boolean {
  if (candidates.valid.size === 1) {
    writeRecoveredArtifact(candidatePath, [...candidates.valid.values()][0]);
    logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovered from event stream (strict validation passed)', true);
    return true;
  }
  if (candidates.partial.size === 1) {
    writeRecoveredArtifact(candidatePath, [...candidates.partial.values()][0]);
    logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovered from event stream (partial recovery - minimal fields only)', true);
    return true;
  }
  const allCandidates = [...candidates.valid.values(), ...candidates.partial.values()];
  if (allCandidates.length > 0) {
    const recovered = allCandidates.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
    writeRecoveredArtifact(candidatePath, recovered);
    logScoutingRecoveryDiagnostic(resultsDir, `Scouting artifact recovered from event stream (multiple candidates, selected best: ${Object.keys(recovered).length} fields)`, true);
    return true;
  }
  logScoutingRecoveryDiagnostic(resultsDir, 'Scouting artifact recovery failed: no valid JSON objects found in event stream', false);
  return false;
}

export function recoverArtifactFromEventStream(options: RecoveryOptions): boolean {
  let text = '';
  try {
    text = fs.readFileSync(options.rawPath, 'utf8');
  } catch {
    return false;
  }

  const candidates = collectRecoveryCandidates(text, options.phase);

  if (options.phase === 'goal-setting') {
    return recoverGoalSettingArtifact(options.candidatePath, candidates);
  }

  return recoverScoutingArtifact(options.candidatePath, options.resultsDir ?? process.cwd(), candidates);
}

function usage(): never {
  console.error('Usage: artifact-recovery <goal-setting|scouting> <raw-events.jsonl> <candidate.json> [results-dir]');
  process.exit(2);
}

export function runRecoveryCliFromArgs(args: string[]): number {
  const phase = args[0] as Phase | undefined;
  const rawPath = args[1];
  const candidatePath = args[2];
  const resultsDir = args[3];

  if ((phase !== 'goal-setting' && phase !== 'scouting') || !rawPath || !candidatePath) {
    usage();
  }

  return recoverArtifactFromEventStream({ phase, rawPath, candidatePath, resultsDir }) ? 0 : 1;
}

// CLI entry point - only runs when executed directly as a script, not imported
// Skip CLI execution during testing; when invoked via spawnSync, this will execute normally
if (typeof process !== 'undefined' && process.argv && process.argv.length >= 2) {
  try {
    // Check if we're being imported (module context) vs executed (script context)
    // In test environments where the module is imported, we skip CLI execution
    const isImportedInTest = (global as unknown as { it?: unknown }).it !== undefined;

    if (!isImportedInTest) {
      process.exit(runRecoveryCliFromArgs(process.argv.slice(2)));
    }
  } catch {
    // Silently ignore errors during module imports/tests
  }
}
