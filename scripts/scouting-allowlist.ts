#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CHANGED_FILES_ALLOWLIST = 'src/lib/parser.ts tests/parser.validation.ts';
const DEFAULT_VALIDATION_ALLOWLIST = '';

interface ValidationError {
  field: string;
  expected: string;
  actual: string;
  severity: 'critical' | 'warning';
  suggestion: string;
}

interface ValidationResult {
  status: 'ok' | 'rejected';
  reason_code: string;
  details: string;
  errors: ValidationError[];
}

interface AllowlistResult {
  agentAllowlist: string;
  validationAllowlist: string;
}

interface DeriveScoutingResult {
  validation: ValidationResult;
  agentAllowlist: string;
  validationAllowlist: string;
  source: string;
}

/**
 * Keep scouting paths machine-actionable.  These values are fed directly into
 * the coding allowlist, so prose such as "inspect package.json" must never be
 * accepted as a pattern.
 */
function isRepoRelativePattern(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const pattern = value.trim();
  if (!pattern || pattern !== value || pattern.startsWith('/') || pattern.includes('\\') || /\s/.test(pattern)) return false;
  if (pattern.split('/').some((segment) => segment === '..' || segment === '.')) return false;
  return /^[!A-Za-z0-9_@.+,*?\[\]{}\-/]+$/.test(pattern);
}

function isRepoRelativeFilePath(value: unknown): value is string {
  return isRepoRelativePattern(value) && !/[?*\[\]{}]/.test(value);
}

function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function summarize(errors: ValidationError[]): string {
  const critical = errors.filter((error) => error.severity === 'critical').length;
  const warning = errors.filter((error) => error.severity === 'warning').length;
  const counts: string[] = [];
  if (critical) counts.push(`${critical} critical`);
  if (warning) counts.push(`${warning} warning`);
  const fields = errors.slice(0, 2).map((error) => error.field).join(', ');
  const suffix = errors.length > 2 ? `, +${errors.length - 2} more` : '';
  return `${counts.join(', ')} scouting validation ${errors.length === 1 ? 'error' : 'errors'}: ${fields}${suffix}`;
}

function appendJsonl(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

function readArtifact(inputPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

/**
 * Validates that a field exists and is an array
 */
function validateArrayField(artifact: Record<string, unknown>, errors: ValidationError[], fieldName: string): void {
  if (!Array.isArray(artifact[fieldName])) {
    errors.push({
      field: fieldName,
      expected: 'array',
      actual: actualType(artifact[fieldName]),
      severity: 'critical',
      suggestion: `${fieldName} must be an array in the scouting handoff`,
    });
  }
}

/**
 * Validates relevant_files array entries
 */
function validateRelevantFilesArray(relevantFiles: unknown, errors: ValidationError[]): void {
  if (!Array.isArray(relevantFiles)) return;
  relevantFiles.forEach((item: unknown, index: number) => {
    const entry = item as Record<string, unknown>;
    if (!item || !isRepoRelativeFilePath(entry.path) || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push({
        field: `relevant_files[${index}]`,
        expected: 'object with a repo-relative path and non-empty reason strings',
        actual: actualType(item),
        severity: 'critical',
        suggestion: 'Each relevant_files entry must use a clean repo-relative path (for example docs/DEVELOPMENT.md) and a separate reason.',
      });
    }
  });
}

/**
 * Validates individual test examples within test_impact
 */
function validateTestExamples(examples: unknown, testImpactIndex: number, errors: ValidationError[]): void {
  if (!Array.isArray(examples)) return;
  const validTypes = ['added_assertion', 'modified_assertion', 'added_test_case', 'added_pattern'];
  examples.forEach((example: unknown, exIdx: number) => {
    const ex = example as Record<string, unknown>;
    if (!example || typeof ex !== 'object' || !validTypes.includes(String(ex.type))) {
      errors.push({
        field: `test_impact[${testImpactIndex}].test_examples[${exIdx}].type`,
        expected: validTypes.join('|'),
        actual: actualType(ex && ex.type),
        severity: 'warning',
        suggestion: 'Each test_example must have a valid type',
      });
    }
    if (!example || typeof ex.pattern !== 'string') {
      errors.push({
        field: `test_impact[${testImpactIndex}].test_examples[${exIdx}].pattern`,
        expected: 'string',
        actual: actualType(ex && ex.pattern),
        severity: 'warning',
        suggestion: 'Each test_example must have a pattern string',
      });
    }
    if (!example || typeof ex.before !== 'string' || typeof ex.after !== 'string') {
      errors.push({
        field: `test_impact[${testImpactIndex}].test_examples[${exIdx}]`,
        expected: 'before and after strings',
        actual: 'missing or invalid',
        severity: 'warning',
        suggestion: 'Each test_example must have before and after code snippets',
      });
    }
  });
}

/**
 * Validates test_impact array entries and their nested test_examples
 */
function validateTestImpactArray(testImpact: unknown, errors: ValidationError[]): void {
  if (!Array.isArray(testImpact)) return;
  testImpact.forEach((item: unknown, index: number) => {
    const ti = item as Record<string, unknown>;
    if (
      !item ||
      typeof ti.path !== 'string' ||
      !(ti.path as string).trim() ||
      typeof ti.reason !== 'string' ||
      !(ti.reason as string).trim()
    ) {
      errors.push({
        field: `test_impact[${index}]`,
        expected: 'object with non-empty string path and non-empty string reason',
        actual: actualType(item),
        severity: 'critical',
        suggestion: 'Each test_impact entry must include the impacted test path and expectation reason strings',
      });
    }
    if (item && typeof ti === 'object' && ti.test_examples !== undefined) {
      if (!Array.isArray(ti.test_examples)) {
        errors.push({
          field: `test_impact[${index}].test_examples`,
          expected: 'array of example objects or undefined',
          actual: actualType(ti.test_examples),
          severity: 'warning',
          suggestion:
            'test_examples must be an array of objects with type, pattern, description, before, and after fields',
        });
      } else {
        validateTestExamples(ti.test_examples, index, errors);
      }
    }
  });
}

/**
 * Validates suggested_allowlist object and its pattern arrays
 */
function validateSuggestedAllowlist(suggestedAllowlist: unknown, errors: ValidationError[]): void {
  if (!suggestedAllowlist) return;
  if (typeof suggestedAllowlist !== 'object' || Array.isArray(suggestedAllowlist)) {
    errors.push({
      field: 'suggested_allowlist',
      expected: 'object',
      actual: actualType(suggestedAllowlist),
      severity: 'warning',
      suggestion: 'suggested_allowlist must be an object with agent_patterns and validation_patterns arrays',
    });
    return;
  }
  const sal = suggestedAllowlist as Record<string, unknown>;
  if (!Array.isArray(sal.agent_patterns)) {
    errors.push({
      field: 'suggested_allowlist.agent_patterns',
      expected: 'array of strings',
      actual: actualType(sal.agent_patterns),
      severity: 'warning',
      suggestion: 'agent_patterns must be an array of glob pattern strings',
    });
  } else if (!(sal.agent_patterns as unknown[]).every((pattern) => typeof pattern === 'string')) {
    errors.push({
      field: 'suggested_allowlist.agent_patterns',
      expected: 'array of strings',
      actual: 'array with non-strings',
      severity: 'warning',
      suggestion: 'All agent_patterns entries must be strings',
    });
  } else if (!(sal.agent_patterns as unknown[]).every(isRepoRelativePattern)) {
    errors.push({
      field: 'suggested_allowlist.agent_patterns',
      expected: 'array of repo-relative glob strings',
      actual: 'array with invalid glob patterns',
      severity: 'warning',
      suggestion: 'All agent_patterns entries must be repo-relative globs, not prose or shell commands.',
    });
  }
  if (!Array.isArray(sal.validation_patterns)) {
    errors.push({
      field: 'suggested_allowlist.validation_patterns',
      expected: 'array of strings',
      actual: actualType(sal.validation_patterns),
      severity: 'warning',
      suggestion: 'validation_patterns must be an array of glob pattern strings',
    });
  } else if (!(sal.validation_patterns as unknown[]).every((pattern) => typeof pattern === 'string')) {
    errors.push({
      field: 'suggested_allowlist.validation_patterns',
      expected: 'array of strings',
      actual: 'array with non-strings',
      severity: 'warning',
      suggestion: 'All validation_patterns entries must be strings',
    });
  } else if (!(sal.validation_patterns as unknown[]).every(isRepoRelativePattern)) {
    errors.push({
      field: 'suggested_allowlist.validation_patterns',
      expected: 'array of repo-relative glob strings',
      actual: 'array with invalid glob patterns',
      severity: 'warning',
      suggestion: 'All validation_patterns entries must be repo-relative globs, not prose or shell commands.',
    });
  }
}

function validateScoutingArtifactObject(artifact: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const arrayKeys = ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];

  if (!artifact || Array.isArray(artifact) || typeof artifact !== 'object') {
    errors.push({
      field: 'root',
      expected: 'object',
      actual: actualType(artifact),
      severity: 'critical',
      suggestion: 'Scouting artifact must be a JSON object, not an array/null/primitive',
    });
  } else {
    const art = artifact as Record<string, unknown>;
    // Validate task field
    if (typeof art.task !== 'string' || !art.task.trim()) {
      errors.push({
        field: 'task',
        expected: 'non-empty string',
        actual: typeof art.task === 'string' ? 'empty string' : actualType(art.task),
        severity: 'critical',
        suggestion: 'task must be a non-empty string describing the requested work',
      });
    }

    // Validate all required array fields
    for (const key of arrayKeys) {
      validateArrayField(art, errors, key);
    }

    // Validate relevant_files entries
    validateRelevantFilesArray(art.relevant_files, errors);

    // Validate test_impact entries and test_examples
    validateTestImpactArray(art.test_impact, errors);

    // Validate suggested_allowlist object
    validateSuggestedAllowlist(art.suggested_allowlist, errors);

    const placeholderErrors = detectPlaceholderContent(art);
    errors.push(...placeholderErrors);
  }

  const criticalErrors = errors.filter((error) => error.severity === 'critical');
  const suggestedAllowlistErrors = errors.filter((error) => error.field.startsWith('suggested_allowlist'));
  if (criticalErrors.length || suggestedAllowlistErrors.length) {
    const onlyTaskMissing = criticalErrors.length === 1 && criticalErrors[0].field === 'task';
    return {
      status: 'rejected',
      reason_code: onlyTaskMissing ? 'missing_required_fields' : 'schema_mismatch',
      details: summarize(errors),
      errors,
    };
  }

  return {
    status: 'ok',
    reason_code: 'valid',
    details: errors.length ? `artifact validation passed with ${summarize(errors)}` : 'artifact validation passed',
    errors,
  };
}

function detectPlaceholderContent(artifact: Record<string, unknown>): ValidationError[] {
  const placeholderPatterns = [
    /\bbrief task interpretation\b/i,
    /\bimportant requirements and constraints\b/i,
    /\bwhy it matters\b/i,
    /\bordered coding steps\b/i,
    /\bfocused commands or checks to run\b/i,
    /\buncertainties, edge cases, or assumptions\b/i,
    /\brepo-relative files that must be changed to satisfy the goal; use only when certain\b/i,
    /\bliteral strings or diff hunk markers that must appear in git\.diff; use only when certain\b/i,
    /\bglob patterns for files the coding agent should modify\b/i,
    /\bglob patterns for files validation commands may touch\b/i,
  ];
  const errors: ValidationError[] = [];

  function visit(value: unknown, pathParts: string[]): void {
    if (typeof value === 'string') {
      const matched = placeholderPatterns.find((pattern) => pattern.test(value));
      if (matched) {
        errors.push({
          field: pathParts.join('.') || 'root',
          expected: 'task-specific scouting content',
          actual: value,
          severity: 'critical',
          suggestion:
            'Replace prompt-shape placeholder text with concrete analysis, or omit uncertain critical-change expectations.',
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => visit(item, [...pathParts, key]));
    }
  }

  visit(artifact, []);
  return errors;
}

function validateScoutingArtifact(
  inputPath: string,
  outputPath: string | undefined,
  options: Record<string, unknown> = {},
): ValidationResult {
  let artifact: unknown;
  try {
    artifact = readArtifact(inputPath);
  } catch (err) {
    const error: ValidationError = {
      field: 'root',
      expected: 'exactly one valid JSON object',
      actual: (err && (err as Record<string, unknown>).message ? String((err as Record<string, unknown>).message) : 'JSON parse failed'),
      severity: 'critical',
      suggestion: 'ensure exactly one valid JSON object is written to /results/scouting-candidate.json',
    };
    const result: ValidationResult = {
      status: 'rejected',
      reason_code: 'malformed_json',
      details: summarize([error]),
      errors: [error],
    };
    writeValidationArtifacts(result, options);
    return result;
  }

  const result = validateScoutingArtifactObject(artifact);
  if (result.status === 'ok' && outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2) + '\n');
  }
  writeValidationArtifacts(result, options);
  return result;
}

function writeValidationArtifacts(result: ValidationResult, options: Record<string, unknown>): void {
  const errorLog = options.errorLog as string | undefined;
  const jsonlLog = options.jsonlLog as string | undefined;
  if (result.errors.length === 0) return;
  if (jsonlLog) {
    for (const error of result.errors) {
      appendJsonl(jsonlLog, { timestamp: new Date().toISOString(), reason_code: result.reason_code, ...error });
    }
  }
  if (errorLog && result.status === 'rejected') {
    fs.writeFileSync(errorLog, JSON.stringify({ reason_code: result.reason_code, details: result.details, errors: result.errors }) + '\n');
  }
}

function deriveAllowlistFromScoutingArtifact(artifact: unknown): AllowlistResult {
  const art = artifact as Record<string, unknown>;
  return {
    agentAllowlist:
      art &&
      (art.suggested_allowlist as Record<string, unknown>)?.agent_patterns &&
      Array.isArray((art.suggested_allowlist as Record<string, unknown>).agent_patterns)
        ? (((art.suggested_allowlist as Record<string, unknown>).agent_patterns as string[]).join(' ') as string)
        : '',
    validationAllowlist:
      art &&
      (art.suggested_allowlist as Record<string, unknown>)?.validation_patterns &&
      Array.isArray((art.suggested_allowlist as Record<string, unknown>).validation_patterns)
        ? (((art.suggested_allowlist as Record<string, unknown>).validation_patterns as string[]).join(' ') as string)
        : '',
  };
}

function deriveAllowlistFromScouting(inputPath: string): AllowlistResult {
  return deriveAllowlistFromScoutingArtifact(readArtifact(inputPath));
}

function mergeAllowlists(scoutingPatterns = '', userPatterns = ''): string {
  if (scoutingPatterns && userPatterns) return `${scoutingPatterns} ${userPatterns}`;
  return scoutingPatterns || userPatterns || '';
}

function deriveScoutingAllowlistOrDefault(inputPath: string, options: Record<string, unknown> = {}): DeriveScoutingResult {
  const defaultChangedFilesAllowlist = (options.defaultChangedFilesAllowlist as string) ?? DEFAULT_CHANGED_FILES_ALLOWLIST;
  const defaultValidationAllowlist = (options.defaultValidationAllowlist as string) ?? DEFAULT_VALIDATION_ALLOWLIST;
  const validation = validateScoutingArtifact(inputPath, undefined, options);

  if (validation.status !== 'ok') {
    return {
      validation,
      agentAllowlist: defaultChangedFilesAllowlist,
      validationAllowlist: defaultValidationAllowlist,
      source: 'default_after_rejection',
    };
  }

  const derived = deriveAllowlistFromScouting(inputPath);
  return {
    validation,
    agentAllowlist: mergeAllowlists(derived.agentAllowlist, defaultChangedFilesAllowlist),
    validationAllowlist: mergeAllowlists(derived.validationAllowlist, defaultValidationAllowlist),
    source: derived.agentAllowlist || derived.validationAllowlist ? 'merged_scouting' : 'default_after_absent_suggestion',
  };
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value));
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command === 'validate') {
    const [inputPath, outputPath, errorLog, jsonlLog] = args;
    const result = validateScoutingArtifact(inputPath, outputPath, { errorLog, jsonlLog });
    printJson(result);
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }
  if (command === 'derive') {
    const result = deriveAllowlistFromScouting(args[0]);
    process.stdout.write(`${result.agentAllowlist}\n${result.validationAllowlist}\n`);
    return;
  }
  if (command === 'orchestrate') {
    printJson(
      deriveScoutingAllowlistOrDefault(args[0], {
        defaultChangedFilesAllowlist: args[1] ?? DEFAULT_CHANGED_FILES_ALLOWLIST,
        defaultValidationAllowlist: args[2] ?? DEFAULT_VALIDATION_ALLOWLIST,
      }),
    );
    return;
  }
  process.stderr.write('usage: scouting-allowlist.js <validate|derive|orchestrate> ...\n');
  process.exitCode = 64;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2));
}
