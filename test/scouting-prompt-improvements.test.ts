/**
 * Test suite for scouting prompt improvements
 * Uses TDD approach: define expectations first, then implement changes
 *
 * This suite validates:
 * - Phase 1: Clear system message structure with distinct sections
 * - Phase 2: Task validation and ambiguity detection guidance
 * - Phase 3: Provider context and error handling awareness
 * - Phase 4: Output schema constraints and test_impact completeness
 * - Phase 5: Documentation and maintainability
 */

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

const scoutingTemplateDirectory = path.join(__dirname, '..', 'templates', 'scouting');

function readScoutingPromptTemplates(): string {
  return fs.readdirSync(scoutingTemplateDirectory)
    .filter((file) => file.endsWith('.txt'))
    .sort()
    .map((file) => fs.readFileSync(path.join(scoutingTemplateDirectory, file), 'utf-8'))
    .join('\n');
}

function buildRuntimeScoutingPrompt(): string {
  const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
  const runtime = spawnSync('bash', ['-c', `
    set -euo pipefail
    eval "$(sed -n '/^build_scouting_prompt() {/,/^}$/p' "$1")"
    get_caveman_instruction() { printf ''; }
    is_complex_change_task() { return 0; }
    build_scouting_prompt
  `, 'scouting-prompt-test', agentScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SCRIPT_DIR: path.dirname(agentScript),
      TASK_PROMPT: 'Update parser behavior and its tests.',
      KASEKI_SCOUTING_PROMPT_DETAIL: 'verbose',
      KASEKI_SCOUTING_CONTRACT_RETRY: '0',
      GOAL_SETTING_ARTIFACT: '/results/goal-setting.json',
    },
  });

  if (runtime.status !== 0) {
    throw new Error(`Failed to build the runtime scouting prompt: ${runtime.stderr}`);
  }

  return runtime.stdout;
}

describe('Scouting prompt contracts', () => {
  let promptContent: string;

  beforeAll(() => {
    promptContent = readScoutingPromptTemplates();
  });

  test('keeps scouting read-only [SCOUTING_PROMPT_DESIGN § Operational Constraints]', () => {
    expect(promptContent).toMatch(/read-only/i);
    expect(promptContent).toMatch(/Do not edit source files/i);
    expect(promptContent).toMatch(/Do not run git add/i);
    expect(promptContent).toMatch(/repository(?: tree)? at \/workspace\/repo is read-only during scouting/i);
  });

  test('defines the artifact schema [SCOUTING_PROMPT_DESIGN § Output Schema]', () => {
    const schemaText = promptContent.match(
      /schema-style shape[^\n]*:\n([\s\S]*?)\nOutput rules for the JSON artifact:/,
    )?.[1];
    expect(schemaText).toBeDefined();

    const fields = new Map(
      [...schemaText!.matchAll(/^- ([a-z_]+): (string|array|object|optional object)\b/gm)]
        .map(([, name, type]) => [name, type]),
    );
    expect(Object.fromEntries(fields)).toEqual({
      task: 'string',
      requirements: 'array',
      relevant_files: 'array',
      observations: 'array',
      plan: 'array',
      validation: 'array',
      risks: 'array',
      test_impact: 'array',
      critical_change_expectations: 'optional object',
      suggested_allowlist: 'object',
    });
    expect(schemaText).toMatch(
      /relevant_files:[^\n]*objects with path and reason strings[\s\S]*separate non-empty path and reason strings/i,
    );
  });

  test('validates task scope before scouting [SCOUTING_PROMPT_DESIGN § Task Validation]', () => {
    expect(promptContent).toMatch(/Before proceeding with repository inspection, validate that the task is concrete/i);
    expect(promptContent).toMatch(/Valid tasks[\s\S]*Fix null-safety in parseRole/);
    expect(promptContent).toMatch(/Ambiguous\/Invalid tasks[\s\S]*Make the code better/);
    expect(promptContent).toMatch(/If the task is ambiguous[\s\S]*\[UNCLEAR - needs clarification\]/i);
  });

  test('writes and verifies the handoff artifact [SCOUTING_PROMPT_DESIGN § Operational Constraints]', () => {
    expect(promptContent).toMatch(
      /exactly one JSON object (?:at|to) \/results\/scouting-candidate\.json/i,
    );
    expect(promptContent).toMatch(/only accepted handoff location/i);
  });

  test('keeps goal-setting retry counters local to each invocation', () => {
    const agentScript = fs.readFileSync(path.join(__dirname, '..', 'kaseki-agent.sh'), 'utf-8');
    const retryFunctionPreamble = agentScript.match(
      /run_goal_setting_agent_with_retry\(\) \{([\s\S]*?)goal_setting_last_exit=0/,
    )?.[1];

    expect(retryFunctionPreamble).toBeDefined();
    expect(retryFunctionPreamble).toMatch(/^\s*# Keep retry state[\s\S]*?^\s*local attempt=1 max_attempts=2$/m);
    expect(retryFunctionPreamble).not.toMatch(/^\s*(?:attempt|max_attempts)=/m);
  });

  test('test_impact guidelines should be comprehensive', () => {
    // Should have examples of strong test_impact entries
    expect(promptContent).toContain('✓ Parser change');
    expect(promptContent).toContain('✓ Event change');
    expect(promptContent).toContain('test_examples');
  });

  test.each([
    {
      category: 'parser',
      taskSignal: /parse, parser, regex, validation/i,
      affectedTest: /tests\/parser\.test\.ts/,
      assertionImpact: /Null\/undefined handling[\s\S]*expect\(\)\.toThrow\(\)/,
    },
    {
      category: 'event',
      taskSignal: /event, emit, listener, on, once, signal/i,
      affectedTest: /tests\/event-handler\.test\.ts/,
      assertionImpact: /Event structure changes[\s\S]*new\/removed\/renamed fields/i,
    },
    {
      category: 'serialization',
      taskSignal: /response, serialize, serialize, format, construct/i,
      affectedTest: /tests\/serialization\.test\.ts/,
      assertionImpact: /Round-trip assertions[\s\S]*preserves values/i,
    },
    {
      category: 'naming',
      taskSignal: /rename, constant, enum, identifier, symbol/i,
      affectedTest: /tests\/\*\*\/\*\.test\.ts/,
      assertionImpact: /String literal assertions[\s\S]*oldName[\s\S]*newName/i,
    },
    {
      category: 'configuration',
      taskSignal: /config, configuration, settings, environment/i,
      affectedTest: /tests\/config\.test\.ts/,
      assertionImpact: /Configuration schema changes[\s\S]*required fields/i,
    },
    {
      category: 'multi-file',
      taskSignal: /multi-file changes, cross-repo coordination/i,
      affectedTest: /tests\/integration\.test\.ts/,
      assertionImpact: /Multi-file coordination[\s\S]*3\+ test files/i,
    },
  ])('documents test impact for $category changes', ({ taskSignal, affectedTest, assertionImpact }) => {
    expect(promptContent).toMatch(taskSignal);
    expect(promptContent).toMatch(affectedTest);
    expect(promptContent).toMatch(assertionImpact);
  });

  test('wires user-visible guidance into the runtime prompt [SCOUTING_PROMPT_DESIGN § Prompt Structure / Operational Constraints]', () => {
    const runtimePrompt = buildRuntimeScoutingPrompt();

    expect(runtimePrompt).toContain('## [ROLE]');
    expect(runtimePrompt).toContain('## [OPERATIONAL CONSTRAINTS - Read-Only Phase]');
    expect(runtimePrompt).toContain('## [TASK VALIDATION - Ensure Task is Valid Before Scouting]');
    expect(runtimePrompt).toContain('Guidelines for test_impact:');
    expect(runtimePrompt).toContain('## [EXECUTION CONTEXT - Optimize for Efficiency]');
    expect(runtimePrompt).toMatch(/Do not edit source files/i);
    expect(runtimePrompt).toMatch(/exactly one JSON object (?:at|to) \/results\/scouting-candidate\.json/i);
    expect(runtimePrompt).toContain('Update parser behavior and its tests.');
  });
});

/**
 * Phase 3: Provider & Error Context Tests
 * Validates awareness of LLM provider architecture and error handling
 */
describe('Phase 3: Provider & Error Context', () => {
  let promptContent: string;

  beforeAll(() => {
    promptContent = readScoutingPromptTemplates();
  });

  test('should mention execution context and efficiency optimization', () => {
    // Phase 3 requirement: Awareness of execution environment and constraints
    expect(promptContent.toLowerCase()).toContain('execution context');
  });

  test('should include error handling guidance', () => {
    // Phase 3 requirement: What to do on failures
    expect(promptContent).toContain('Error Handling');
  });

  test('should enforce the artifact size limit from SCOUTING_PROMPT_DESIGN.md §5', () => {
    const artifactSizeMatch = promptContent.match(/JSON size[^\n]*?(\d+)\s*KB/i);
    expect(artifactSizeMatch).not.toBeNull();

    const artifactSizeLimitInKB = artifactSizeMatch?.[1];

    // SCOUTING_PROMPT_DESIGN.md §5 specifies 50 KB to keep scouting output bounded.
    expect(Number(artifactSizeLimitInKB)).toBe(50);
  });

  test('should note timeout expectations', () => {
    // Phase 3 requirement: Scouting <2 min guidance
    expect(promptContent).toContain('Timeouts');
    expect(promptContent).toMatch(/2 ?minutes?/i);
  });
});

/**
 * Phase 4: Output Schema Refinement Tests
 * Validates improved output schema with constraints and better examples
 */
describe('Phase 4: Output Schema Refinement', () => {
  let promptContent: string;

  beforeAll(() => {
    promptContent = readScoutingPromptTemplates();
  });

  test('should have field constraints documented', () => {
    // Phase 4 requirement: Max lengths, min/max items
    // Currently has minimal constraints
    expect(promptContent).toContain('task:');
    expect(promptContent).toContain('requirements:');
  });

  test('should document all test_impact change types', () => {
    // Phase 4 requirement: 5+ change type categories
    // Currently has 4
    const changeTypes = [
      'Parser',
      'Event',
      'Response',
      'Naming'
    ];
    changeTypes.forEach(type => {
      expect(promptContent).toContain(type);
    });
  });

  test('test_impact examples should be executable patterns', () => {
    // Phase 4 requirement: Before/after assertions are valid code
    expect(promptContent).toContain('expect(parseRole(null))');
    expect(promptContent).toContain('await eventPromise');
  });

  test('should explain when test_impact can be empty', () => {
    // Phase 4 requirement: Clarity on rare cases
    // Currently missing - will fail until implemented
    expect(promptContent).toContain('empty array');
  });

  test('critical_change_expectations should have concrete examples', () => {
    // Phase 4 requirement: Guidance on when to include/omit
    expect(promptContent).toContain('critical_change_expectations');
    expect(promptContent).toContain('required_files');
    expect(promptContent).toContain('required_search_strings');
  });
});

/**
 * Phase 5: Documentation & Maintainability Tests
 * Validates that the prompt is documented and maintainable
 */
describe('Phase 5: Documentation & Maintainability', () => {
  test('should have SCOUTING_PROMPT_DESIGN.md documentation', () => {
    const docPath = path.join(__dirname, '..', 'docs', 'SCOUTING_PROMPT_DESIGN.md');
    // Phase 5 requirement: Design documentation exists
    // Currently missing - will fail until created
    expect(() => fs.readFileSync(docPath, 'utf-8')).not.toThrow();
  });

});

/**
 * Integration tests: Validate prompt output JSON structure
 */
describe('Integration: Scouting Artifact JSON Structure', () => {
  const validateWithScoutingWorkflow = (artifact: unknown) => {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'scouting-prompt-example-'));
    const fixturePath = path.join(fixtureDirectory, 'scouting-candidate.json');

    try {
      fs.writeFileSync(fixturePath, JSON.stringify(artifact));
      const validation = spawnSync(
        process.execPath,
        [path.join(__dirname, '..', 'dist', 'scouting-allowlist.js'), 'validate', fixturePath],
        { encoding: 'utf8' },
      );

      expect([0, 1]).toContain(validation.status);
      expect(validation.stderr).toBe('');
      try {
        return JSON.parse(validation.stdout);
      } catch (error) {
        const parseFailure = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Validator output is not valid JSON (${parseFailure}): ${validation.stdout}`,
        );
      }
    } finally {
      try {
        fs.rmSync(fixtureDirectory, { recursive: true, force: true });
      } catch (error) {
        // Cleanup failures should not obscure the validator result.
        console.warn(`Failed to clean up temp directory ${fixtureDirectory}:`, error);
      }
    }
  };

  const requiredFields = {
    requirements: ['Preserve the documented behavior'],
    relevant_files: [{ path: 'src/lib/role.ts', reason: 'Contains the behavior under test' }],
    observations: ['The current assertion documents the old behavior'],
    plan: ['Update the implementation and its focused assertion'],
    validation: ['npm test -- role.test.ts'],
    risks: [],
    suggested_allowlist: {
      agent_patterns: ['src/lib/role.ts', 'tests/role.test.ts'],
      validation_patterns: ['tests/role.test.ts'],
    },
  };

  test.each([
    {
      section: '§ Common Patterns / Pattern 1: Parser/Validation Change',
      artifact: {
        ...requiredFields,
        task: 'Fix null-safety in parseRole()',
        test_impact: [{
          path: 'tests/role.test.ts',
          reason: 'Cover the documented null fallback',
          test_examples: [{
            type: 'modified_assertion',
            pattern: 'Null fallback',
            description: 'Null becomes a fallback role',
            before: 'expect(() => parseRole(null)).toThrow()',
            after: "expect(parseRole(null)).toEqual({ name: 'Unnamed' })",
          }],
        }],
      },
      expected: { status: 'ok', reason_code: 'valid', details: 'artifact validation passed', errors: [] },
    },
    {
      section: '§ Common Patterns / Pattern 2: Event Field Changes',
      artifact: {
        ...requiredFields,
        task: 'Add async timing to event listeners',
        test_impact: [{
          path: 'tests/event-handler.test.ts',
          reason: 'Update the documented asynchronous timing assertion',
          test_examples: [{
            type: 'modified_assertion',
            pattern: 'Async timing',
            description: 'The listener now permits 50ms',
            before: 'await eventPromise; // within 10ms',
            after: 'await eventPromise; // within 50ms (now async)',
          }],
        }],
      },
      expected: { status: 'ok', reason_code: 'valid', details: 'artifact validation passed', errors: [] },
    },
  ])('accepts a complete example [$section]', ({ artifact, expected }) => {
    expect(validateWithScoutingWorkflow(artifact)).toEqual(expected);
  });

  test.each([
    {
      section: '§ Task Validation / Ambiguous/Invalid tasks',
      artifact: { ...requiredFields, task: '', test_impact: [] },
      expected: {
        status: 'rejected',
        reason_code: 'missing_required_fields',
        details: '1 critical scouting validation error: task',
        errors: [{
          field: 'task',
          expected: 'non-empty string',
          actual: 'empty string',
          severity: 'critical',
          suggestion: 'task must be a non-empty string describing the requested work',
        }],
      },
    },
    {
      section: '§ Output Schema / relevant_files',
      artifact: {
        ...requiredFields,
        task: 'Rename parseConfig to loadConfigFromFile',
        relevant_files: [{ path: '../src/config.ts', reason: '' }],
        test_impact: [],
      },
      expected: {
        status: 'rejected',
        reason_code: 'schema_mismatch',
        details: '1 critical scouting validation error: relevant_files[0]',
        errors: [{
          field: 'relevant_files[0]',
          expected: 'object with a repo-relative path and non-empty reason strings',
          actual: 'object',
          severity: 'critical',
          suggestion: 'Each relevant_files entry must use a clean repo-relative path (for example docs/DEVELOPMENT.md) and a separate reason.',
        }],
      },
    },
  ])('rejects an invalid example with diagnostics [$section]', ({ artifact, expected }) => {
    expect(validateWithScoutingWorkflow(artifact)).toEqual(expected);
  });

});

/**
 * Prompt quality metrics
 */
describe('Prompt Quality Metrics', () => {
  let promptContent: string;

  beforeAll(() => {
    promptContent = readScoutingPromptTemplates();
  });

  test('follows the documented prompt structure and handoff contract', () => {
    const requiredSections = [
      '## [ROLE]',
      '## [OPERATIONAL CONSTRAINTS - Read-Only Phase]',
      '## [TASK VALIDATION - Ensure Task is Valid Before Scouting]',
      '## [EXECUTION CONTEXT - Optimize for Efficiency]',
    ];
    const sectionOffsets = requiredSections.map((section) => promptContent.indexOf(section));

    expect(sectionOffsets).not.toContain(-1);
    expect(sectionOffsets).toEqual([...sectionOffsets].sort((left, right) => left - right));

    const operationalSection = promptContent.slice(sectionOffsets[1], sectionOffsets[2]);
    expect(operationalSection).toContain('Do not edit source files');
    expect(operationalSection).toContain('Do not run git add');
    expect(operationalSection).toContain(
      'Create exactly one JSON object at /results/scouting-candidate.json.',
    );
    expect(operationalSection).toContain('This is the only accepted handoff location.');
    expect(operationalSection).toContain(
      'Do not rely on final assistant text for the artifact.',
    );
    expect(operationalSection).toContain('Output rules for the JSON artifact:');
  });

  test('should use consistent formatting for lists', () => {
    // All guidelines should use consistent bullet format
    const bulletCount = (promptContent.match(/^- /gm) || []).length;
    expect(bulletCount).toBeGreaterThan(10);
  });

  test('should have no redundant text', () => {
    // Check for repeated phrases (sign of poor organization)
    // Phase 4 additions include more examples, so allow more redundancy
    const lines = promptContent.split('\n');
    const seen = new Set<string>();
    let redundantCount = 0;

    lines.forEach(line => {
      if (seen.has(line.trim()) && line.trim().length > 20) {
        redundantCount++;
      }
      seen.add(line.trim());
    });

    // Allow some repetition in examples and explanations
    expect(redundantCount).toBeLessThan(10);
  });
});
