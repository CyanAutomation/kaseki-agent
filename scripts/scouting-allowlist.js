#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CHANGED_FILES_ALLOWLIST = 'src/lib/parser.ts tests/parser.validation.ts';
const DEFAULT_VALIDATION_ALLOWLIST = '';

function actualType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Validates scouting artifact for artifact recovery scenarios.
 * More lenient than strict validation - only requires task field.
 * Used when recovering artifacts from incomplete event streams.
 */
function validateScoutingArtifactForRecovery(artifact) {
  const errors = [];

  if (!artifact || Array.isArray(artifact) || typeof artifact !== 'object') {
    errors.push({
      field: 'root',
      severity: 'critical',
      message: 'root must be an object',
    });
    return { status: 'rejected', errors, recovery_attempted: true };
  }

  // Recovery mode: only task field is required
  if (typeof artifact.task !== 'string' || !artifact.task.trim()) {
    errors.push({
      field: 'task',
      severity: 'critical',
      message: 'task must be a non-empty string',
    });
    return { status: 'rejected', errors, recovery_attempted: true };
  }

  return {
    status: 'ok',
    errors: [],
    recovery_attempted: true,
    fields_present: Object.keys(artifact).length,
  };
}

function summarize(errors) {
  const critical = errors.filter((error) => error.severity === 'critical').length;
  const warning = errors.filter((error) => error.severity === 'warning').length;
  const counts = [];
  if (critical) counts.push(`${critical} critical`);
  if (warning) counts.push(`${warning} warning`);
  const fields = errors.slice(0, 2).map((error) => error.field).join(', ');
  const suffix = errors.length > 2 ? `, +${errors.length - 2} more` : '';
  return `${counts.join(', ')} scouting validation ${errors.length === 1 ? 'error' : 'errors'}: ${fields}${suffix}`;
}

function appendJsonl(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

function readArtifact(inputPath) {
  return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

function validateScoutingArtifactObject(artifact) {
  const errors = [];
  const addError = (field, expected, actual, severity, suggestion) => {
    errors.push({ field, expected, actual, severity, suggestion });
  };
  const arrayKeys = ['requirements', 'relevant_files', 'observations', 'plan', 'validation', 'risks', 'test_impact'];

  if (!artifact || Array.isArray(artifact) || typeof artifact !== 'object') {
    addError('root', 'object', actualType(artifact), 'critical', 'Scouting artifact must be a JSON object, not an array/null/primitive');
  } else {
    if (typeof artifact.task !== 'string' || !artifact.task.trim()) {
      addError('task', 'non-empty string', typeof artifact.task === 'string' ? 'empty string' : actualType(artifact.task), 'critical', 'task must be a non-empty string describing the requested work');
    }
    for (const key of arrayKeys) {
      if (!Array.isArray(artifact[key])) {
        addError(key, 'array', actualType(artifact[key]), 'critical', `${key} must be an array in the scouting handoff`);
      }
    }
    if (Array.isArray(artifact.relevant_files)) {
      artifact.relevant_files.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || typeof item.reason !== 'string') {
          addError(`relevant_files[${index}]`, 'object with string path and string reason', actualType(item), 'warning', 'Each relevant_files entry must include path and reason strings');
        }
      });
    }
    if (Array.isArray(artifact.test_impact)) {
      artifact.test_impact.forEach((item, index) => {
        if (!item || typeof item.path !== 'string' || !item.path.trim() || typeof item.reason !== 'string' || !item.reason.trim()) {
          addError(`test_impact[${index}]`, 'object with non-empty string path and non-empty string reason', actualType(item), 'critical', 'Each test_impact entry must include the impacted test path and expectation reason strings');
        }
        if (item && typeof item === 'object' && item.test_examples !== undefined) {
          if (!Array.isArray(item.test_examples)) {
            addError(`test_impact[${index}].test_examples`, 'array of example objects or undefined', actualType(item.test_examples), 'warning', 'test_examples must be an array of objects with type, pattern, description, before, and after fields');
          } else {
            item.test_examples.forEach((example, exIdx) => {
              if (!example || typeof example !== 'object' || !['added_assertion', 'modified_assertion', 'added_test_case', 'added_pattern'].includes(example.type)) {
                addError(`test_impact[${index}].test_examples[${exIdx}].type`, 'added_assertion|modified_assertion|added_test_case|added_pattern', actualType(example && example.type), 'warning', 'Each test_example must have a valid type');
              }
              if (!example || typeof example.pattern !== 'string') {
                addError(`test_impact[${index}].test_examples[${exIdx}].pattern`, 'string', actualType(example && example.pattern), 'warning', 'Each test_example must have a pattern string');
              }
              if (!example || typeof example.before !== 'string' || typeof example.after !== 'string') {
                addError(`test_impact[${index}].test_examples[${exIdx}]`, 'before and after strings', 'missing or invalid', 'warning', 'Each test_example must have before and after code snippets');
              }
            });
          }
        }
      });
    }

    if (artifact.suggested_allowlist) {
      if (typeof artifact.suggested_allowlist !== 'object' || Array.isArray(artifact.suggested_allowlist)) {
        addError('suggested_allowlist', 'object', actualType(artifact.suggested_allowlist), 'warning', 'suggested_allowlist must be an object with agent_patterns and validation_patterns arrays');
      } else {
        if (!Array.isArray(artifact.suggested_allowlist.agent_patterns)) {
          addError('suggested_allowlist.agent_patterns', 'array of strings', actualType(artifact.suggested_allowlist.agent_patterns), 'warning', 'agent_patterns must be an array of glob pattern strings');
        } else if (!artifact.suggested_allowlist.agent_patterns.every((p) => typeof p === 'string')) {
          addError('suggested_allowlist.agent_patterns', 'array of strings', 'array with non-strings', 'warning', 'All agent_patterns entries must be strings');
        }
        if (!Array.isArray(artifact.suggested_allowlist.validation_patterns)) {
          addError('suggested_allowlist.validation_patterns', 'array of strings', actualType(artifact.suggested_allowlist.validation_patterns), 'warning', 'validation_patterns must be an array of glob pattern strings');
        } else if (!artifact.suggested_allowlist.validation_patterns.every((p) => typeof p === 'string')) {
          addError('suggested_allowlist.validation_patterns', 'array of strings', 'array with non-strings', 'warning', 'All validation_patterns entries must be strings');
        }
      }
    }
  }

  if (errors.length) {
    const onlyTaskMissing = errors.length === 1 && errors[0].field === 'task';
    return {
      status: 'rejected',
      reason_code: onlyTaskMissing ? 'missing_required_fields' : 'schema_mismatch',
      details: summarize(errors),
      errors,
    };
  }

  return { status: 'ok', reason_code: 'valid', details: 'artifact validation passed', errors: [] };
}

function validateScoutingArtifact(inputPath, outputPath, options = {}) {
  let artifact;
  try {
    artifact = readArtifact(inputPath);
  } catch (err) {
    const error = {
      field: 'root',
      expected: 'exactly one valid JSON object',
      actual: err && err.message ? String(err.message) : 'JSON parse failed',
      severity: 'critical',
      suggestion: 'ensure exactly one valid JSON object is written to /results/scouting-candidate.json',
    };
    const result = { status: 'rejected', reason_code: 'malformed_json', details: summarize([error]), errors: [error] };
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

function writeValidationArtifacts(result, options) {
  const { errorLog, jsonlLog } = options;
  if (result.status === 'ok') return;
  if (jsonlLog) {
    for (const error of result.errors) {
      appendJsonl(jsonlLog, { timestamp: new Date().toISOString(), reason_code: result.reason_code, ...error });
    }
  }
  if (errorLog) {
    fs.writeFileSync(errorLog, JSON.stringify({ reason_code: result.reason_code, details: result.details, errors: result.errors }) + '\n');
  }
}

function deriveAllowlistFromScoutingArtifact(artifact) {
  return {
    agentAllowlist: artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.agent_patterns)
      ? artifact.suggested_allowlist.agent_patterns.join(' ')
      : '',
    validationAllowlist: artifact && artifact.suggested_allowlist && Array.isArray(artifact.suggested_allowlist.validation_patterns)
      ? artifact.suggested_allowlist.validation_patterns.join(' ')
      : '',
  };
}

function deriveAllowlistFromScouting(inputPath) {
  return deriveAllowlistFromScoutingArtifact(readArtifact(inputPath));
}

function mergeAllowlists(scoutingPatterns = '', userPatterns = '') {
  if (scoutingPatterns && userPatterns) return `${scoutingPatterns} ${userPatterns}`;
  return scoutingPatterns || userPatterns || '';
}

function deriveScoutingAllowlistOrDefault(inputPath, options = {}) {
  const defaultChangedFilesAllowlist = options.defaultChangedFilesAllowlist ?? DEFAULT_CHANGED_FILES_ALLOWLIST;
  const defaultValidationAllowlist = options.defaultValidationAllowlist ?? DEFAULT_VALIDATION_ALLOWLIST;
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

function printJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function main(argv) {
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
    printJson(deriveScoutingAllowlistOrDefault(args[0], {
      defaultChangedFilesAllowlist: args[1] ?? DEFAULT_CHANGED_FILES_ALLOWLIST,
      defaultValidationAllowlist: args[2] ?? DEFAULT_VALIDATION_ALLOWLIST,
    }));
    return;
  }
  process.stderr.write('usage: scouting-allowlist.js <validate|derive|orchestrate> ...\n');
  process.exitCode = 64;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main(process.argv.slice(2));
}
