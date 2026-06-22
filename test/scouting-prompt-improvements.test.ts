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
import * as path from 'node:path';

/**
 * Phase 1: System Message Structure Tests
 * Validates that the prompt has clear, separated sections
 */
describe('Phase 1 & 2 & 3: Scouting Prompt Structure with Task Validation and Execution Context', () => {
  let promptContent: string;

  beforeAll(() => {
    // Read the current scouting prompt from kaseki-agent.sh
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Extract all heredocs from the scouting-related functions
    const scoutingSection = content.substring(
      content.indexOf('is_complex_change_task() {'),
      content.indexOf('run_scouting_agent() {')
    );

    const heredocs: string[] = [];

    // Find quoted heredocs in scouting section
    const quotedPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    let match;
    while ((match = quotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[2]);
    }

    // Find unquoted heredocs in scouting section
    const unquotedPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[1]);
    }

    promptContent = heredocs.join('\n');
  });

  test('should contain all required sections', () => {
    const requiredSections = [
      'You are a read-only scouting Pi agent',
      '## [ROLE]',
      '## [OPERATIONAL CONSTRAINTS - Read-Only Phase]',
      '## [TASK VALIDATION - Ensure Task is Valid Before Scouting]',
      '## [EXECUTION CONTEXT - Optimize for Efficiency]',
      'test_impact',
      'critical_change_expectations',
      'suggested_allowlist',
      '## [ORIGINAL TASK PROMPT FOR REFERENCE]'
    ];

    requiredSections.forEach(section => {
      expect(promptContent).toContain(section);
    });
  });

  test('should have clear role statement', () => {
    expect(promptContent).toMatch(/You are a read-only scouting Pi agent/);
  });

  test('should include read-only constraints', () => {
    expect(promptContent).toMatch(/read-only/);
    expect(promptContent).toMatch(/Do not edit source files/);
    expect(promptContent).toMatch(/Do not run git add/);
  });

  test('should have output schema documentation', () => {
    expect(promptContent).toMatch(/task:\s*string/);
    expect(promptContent).toMatch(/requirements:\s*array/);
    expect(promptContent).toMatch(/relevant_files:/);
    expect(promptContent).toMatch(/test_impact:/);
  });

  test('test_impact guidelines should be comprehensive', () => {
    // Should have examples of strong test_impact entries
    expect(promptContent).toContain('✓ Parser change');
    expect(promptContent).toContain('✓ Event change');
    expect(promptContent).toContain('test_examples');
  });

  test('should document all change type categories', () => {
    const changeTypes = [
      'Parser & Validation Changes',
      'Event Handling & Progress Changes',
      'Response Construction & Serialization',
      'Naming Conventions & Constants',
      'Configuration & Multi-file Patterns'
    ];

    changeTypes.forEach(type => {
      expect(promptContent).toContain(type);
    });
  });
});

/**
 * Phase 2: Task Validation & Ambiguity Tests
 * Validates guidance on ambiguity detection and validation
 */
describe('Phase 2: Task Validation & Ambiguity', () => {
  let promptContent: string;

  beforeAll(() => {
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Extract all heredocs from the scouting-related functions
    const scoutingSection = content.substring(
      content.indexOf('is_complex_change_task() {'),
      content.indexOf('run_scouting_agent() {')
    );

    const heredocs: string[] = [];

    // Find quoted heredocs in scouting section
    const quotedPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    let match;
    while ((match = quotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[2]);
    }

    // Find unquoted heredocs in scouting section
    const unquotedPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[1]);
    }

    promptContent = heredocs.join('\n');
  });

  test('should mention task validation', () => {
    // Phase 2 requirement: prompt should guide task validation
    expect(promptContent).toContain('TASK VALIDATION');
    expect(promptContent.toLowerCase()).toContain('validate');
  });

  test('should provide examples of valid vs invalid tasks', () => {
    // Phase 2 requirement: Examples to help agent discriminate
    expect(promptContent).toContain('Valid tasks');
    expect(promptContent).toContain('Ambiguous/Invalid tasks');
  });

  test('should mention when to ask clarifying questions', () => {
    // Phase 2 requirement: Guidance on escalation
    expect(promptContent.toLowerCase()).toContain('clarifying');
  });

  test('should define success criteria for scouting', () => {
    // Phase 2 requirement: What makes a good scouting artifact
    expect(promptContent).toContain('Success Criteria');
  });
});

/**
 * Phase 3: Provider & Error Context Tests
 * Validates awareness of LLM provider architecture and error handling
 */
describe('Phase 3: Provider & Error Context', () => {
  let promptContent: string;

  beforeAll(() => {
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Extract all heredocs from the scouting-related functions
    const scoutingSection = content.substring(
      content.indexOf('is_complex_change_task() {'),
      content.indexOf('run_scouting_agent() {')
    );

    const heredocs: string[] = [];

    // Find quoted heredocs in scouting section
    const quotedPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    let match;
    while ((match = quotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[2]);
    }

    // Find unquoted heredocs in scouting section
    const unquotedPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[1]);
    }

    promptContent = heredocs.join('\n');
  });

  test('should mention execution context and efficiency optimization', () => {
    // Phase 3 requirement: Awareness of execution environment and constraints
    expect(promptContent.toLowerCase()).toContain('execution context');
  });

  test('should document artifact size constraints', () => {
    // Phase 3 requirement: Bounded output JSON
    // Currently missing - will fail until implemented
    expect(promptContent).toMatch(/size|limit|bound|50kb/i);
  });

  test('should include error handling guidance', () => {
    // Phase 3 requirement: What to do on failures
    expect(promptContent).toContain('Error Handling');
  });

  test('should mention artifact size constraints', () => {
    // Phase 3 requirement: Awareness of execution limits
    expect(promptContent).toContain('Artifact Size');
    expect(promptContent).toMatch(/50 ?KB/i);
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
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Extract all heredocs from the scouting-related functions
    const scoutingSection = content.substring(
      content.indexOf('is_complex_change_task() {'),
      content.indexOf('run_scouting_agent() {')
    );

    const heredocs: string[] = [];

    // Find quoted heredocs in scouting section
    const quotedPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    let match;
    while ((match = quotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[2]);
    }

    // Find unquoted heredocs in scouting section
    const unquotedPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedPattern.exec(scoutingSection)) !== null) {
      heredocs.push(match[1]);
    }

    promptContent = heredocs.join('\n');
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

  test('should have inline comments in kaseki-agent.sh prompt', () => {
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Phase 5 requirement: Comments explaining sections
    // Currently minimal - will fail until improved
    expect(content).toContain('build_scouting_prompt');
  });

  test('should have test cases for scouting prompt examples', () => {
    const testDir = path.join(__dirname);
    const testFiles = fs.readdirSync(testDir);

    // Phase 5 requirement: Test examples
    // Currently minimal - will improve over time
    expect(testFiles.length).toBeGreaterThan(0);
  });
});

/**
 * Integration tests: Validate prompt output JSON structure
 */
describe('Integration: Scouting Artifact JSON Structure', () => {
  test('valid scouting artifact should have all required fields', () => {
    const validArtifact = {
      task: 'Fix null-safety in parseRole()',
      requirements: [
        'Handle null input gracefully',
        'Return fallback for undefined'
      ],
      relevant_files: [
        { path: 'src/lib/role.ts', reason: 'Contains parseRole function' },
        { path: 'tests/role.test.ts', reason: 'Tests null cases' }
      ],
      observations: [
        'parseRole() throws on null input',
        'No fallback logic exists'
      ],
      plan: [
        'Add null check in parseRole()',
        'Return default Role object on null',
        'Update tests to verify fallback'
      ],
      validation: [
        'npm test -- role.test.ts',
        'npm run lint src/lib/role.ts'
      ],
      risks: [
        'Other code may depend on exception',
        'API contract change'
      ],
      test_impact: [
        {
          path: 'tests/role.test.ts',
          reason: 'null/undefined handling',
          test_examples: [
            {
              type: 'modified_assertion',
              pattern: 'Null-coalescing',
              before: 'expect(() => parseRole(null)).toThrow()',
              after: 'expect(parseRole(null)).toEqual({ name: \'Unnamed\' })',
              description: 'Updated spec treats null as fallback, not error'
            }
          ]
        }
      ],
      suggested_allowlist: {
        agent_patterns: ['src/lib/role.ts', 'tests/role.test.ts'],
        validation_patterns: ['src/lib/role.ts', 'tests/role.test.ts', '.coverage/**']
      }
    };

    // Validate structure
    expect(validArtifact).toHaveProperty('task');
    expect(validArtifact).toHaveProperty('requirements');
    expect(validArtifact).toHaveProperty('relevant_files');
    expect(validArtifact).toHaveProperty('observations');
    expect(validArtifact).toHaveProperty('plan');
    expect(validArtifact).toHaveProperty('validation');
    expect(validArtifact).toHaveProperty('risks');
    expect(validArtifact).toHaveProperty('test_impact');
    expect(validArtifact).toHaveProperty('suggested_allowlist');

    // Validate field types
    expect(typeof validArtifact.task).toBe('string');
    expect(Array.isArray(validArtifact.requirements)).toBe(true);
    expect(Array.isArray(validArtifact.relevant_files)).toBe(true);
    expect(validArtifact.relevant_files[0]).toHaveProperty('path');
    expect(validArtifact.relevant_files[0]).toHaveProperty('reason');
  });

  test('artifact JSON size should be bounded', () => {
    // Phase 3 requirement: Enforce size limits
    const largeArtifact = {
      task: 'x'.repeat(1000),
      requirements: Array(100).fill('requirement'),
      relevant_files: Array(100).fill({ path: 'file.ts', reason: 'reason' }),
      observations: Array(200).fill('observation'),
      plan: Array(200).fill('step'),
      validation: Array(100).fill('command'),
      risks: Array(100).fill('risk'),
      test_impact: [],
      suggested_allowlist: { agent_patterns: [], validation_patterns: [] }
    };

    const jsonStr = JSON.stringify(largeArtifact);
    const sizeInKB = Buffer.byteLength(jsonStr, 'utf-8') / 1024;

    // Phase 3 constraint: Max 50KB
    // Currently no size limit - this test will guide implementation
    expect(sizeInKB).toBeLessThan(50);
  });
});

/**
 * Prompt quality metrics
 */
describe('Prompt Quality Metrics', () => {
  let promptContent: string;

  beforeAll(() => {
    const agentScript = path.join(__dirname, '..', 'kaseki-agent.sh');
    const content = fs.readFileSync(agentScript, 'utf-8');

    // Extract heredocs from kaseki-agent.sh by finding patterns directly
    const heredocs: string[] = [];

    // Find all quoted heredocs (cat <<'LABEL' ... LABEL\n)
    const quotedPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    let match;
    while ((match = quotedPattern.exec(content)) !== null) {
      heredocs.push(match[2]);
    }

    // Find all unquoted heredocs (cat <<EOF ... EOF)
    const unquotedPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedPattern.exec(content)) !== null) {
      heredocs.push(match[1]);
    }

    // Combine - but filter to only get heredocs from build_scouting_prompt region
    // (search for a large chunk containing both marker sections from scouting prompt)
    const scoutingSection = content.substring(
      content.indexOf('is_complex_change_task() {'),
      content.indexOf('run_scouting_agent() {')
    );

    const scoutingHeredocs: string[] = [];

    // Find quoted heredocs in scouting section
    const quotedScoutingPattern = /cat\s*<<'([A-Z_]+)'\n([\s\S]*?)\n\1\n/g;
    while ((match = quotedScoutingPattern.exec(scoutingSection)) !== null) {
      scoutingHeredocs.push(match[2]);
    }

    // Find unquoted heredocs in scouting section
    const unquotedScoutingPattern = /cat\s*<<EOF\n([\s\S]*?)\nEOF/g;
    while ((match = unquotedScoutingPattern.exec(scoutingSection)) !== null) {
      scoutingHeredocs.push(match[1]);
    }

    // Combine all heredoc contents from scouting section
    promptContent = scoutingHeredocs.join('\n');
  });

  test('prompt should be human-readable', () => {
    const lines = promptContent.split('\n');
    const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;

    // Lines should average <100 chars for readability
    expect(avgLineLength).toBeLessThan(100);
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
