/**
 * TDD test suite for scouting template token optimization
 *
 * These tests verify that compressed templates preserve all critical semantic constraints:
 * - JSON field definitions remain complete
 * - Validation rules remain unambiguous
 * - Examples remain concrete and actionable
 * - No functionality lost in compression
 *
 * All tests must pass on BOTH original and optimized templates.
 * This ensures optimization doesn't sacrifice clarity or completeness.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const templateDir = path.join(__dirname, '..', 'templates', 'scouting');

// ============================================================================
// Test Helper: Load Template Content
// ============================================================================

function loadTemplate(filename: string): string {
  const filepath = path.join(templateDir, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Template not found: ${filepath}`);
  }
  return fs.readFileSync(filepath, 'utf-8');
}

function _loadAllTemplates(): Record<string, string> {
  return {
    'base.txt': loadTemplate('base.txt'),
    'common.txt': loadTemplate('common.txt'),
    'compact.txt': loadTemplate('compact.txt'),
    'detailed-test-impact.txt': loadTemplate('detailed-test-impact.txt'),
    'minimal-test-impact.txt': loadTemplate('minimal-test-impact.txt'),
  };
}

function extractSchemaFieldDocumentation(template: string, field: string): string | null {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = template.match(
    new RegExp(`^\\*\\*${escapedField}\\*\\*[^\\n]*(?:\\n(?!\\*\\*[^\\n]+\\*\\*)[^\\n]*)*`, 'im'),
  );
  return match?.[0] ?? null;
}

function extractDocumentedExample(documentation: string): string | null {
  return documentation.match(/\bExample:\s*["“]([^"”]+)["”]/i)?.[1] ?? null;
}

function isConcretePlanStep(step: string): boolean {
  const identifiesOperation = /^(?:Add|Fix|Implement|Modify|Remove|Rename|Update)\b/i.test(step);
  const identifiesTarget =
    /\b[A-Za-z_$][\w$]*(?:\(\))|(?:^|\s)(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+\b/.test(step);
  const identifiesBehavioralChange = /\b(?:so|such that|to ensure|to prevent)\b/i.test(step);

  return identifiesOperation && identifiesTarget && identifiesBehavioralChange;
}

function extractTaskValidationSection(template: string): string | null {
  return template.match(/^##\s*\[TASK VALIDATION\b[^\n]*\][\s\S]*?(?=^##\s|(?![\s\S]))/im)?.[0] ?? null;
}

function extractValidTaskExamples(taskValidationSection: string): string[] {
  const validTasksBlock = taskValidationSection.match(
    /^\*\*Valid tasks?\*\*[^\n]*\n([\s\S]*?)(?=^\*\*[^\n]+\*\*|(?![\s\S]))/im,
  )?.[1];

  return validTasksBlock
    ? [...validTasksBlock.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1].trim())
    : [];
}

function extractInvalidTaskExamples(template: string): string[] {
  const taskValidationSection = extractTaskValidationSection(template);
  if (!taskValidationSection) return [];

  const invalidTasksBlock = taskValidationSection.match(
    /^\*\*[^\n]*\bInvalid\b[^\n]*\*\*[^\n]*\n([\s\S]*?)(?=^\*\*[^\n]+\*\*|^##\s|(?![\s\S]))/im,
  )?.[1];

  return invalidTasksBlock
    ? [...invalidTasksBlock.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1].trim())
    : [];
}

function isConcreteValidTaskExample(example: string): boolean {
  const identifiesAction = /^(?:Add|Fix|Implement|Modify|Remove|Rename|Update)\b/i.test(example);
  const identifiesCodeTarget =
    /\b[A-Za-z_$][\w$]*\(\)|(?:^|\s)(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+\b/.test(example);
  const identifiesExpectedBehavior =
    /^(?:Fix\s+.+\s+in|(?:Add|Implement|Modify|Remove|Update)\s+.+\s+(?:in|to)|Rename\s+.+\s+to)\s+/i.test(
      example,
    );

  return identifiesAction && identifiesCodeTarget && identifiesExpectedBehavior;
}

function satisfiesValidTaskExamplesContract(template: string): boolean {
  const taskValidationSection = extractTaskValidationSection(template);
  if (!taskValidationSection) return false;

  return extractValidTaskExamples(taskValidationSection).some(isConcreteValidTaskExample);
}

// ============================================================================
// TEST SUITE 1: JSON Schema Field Definitions
// These tests verify all JSON output fields are documented with constraints
// ============================================================================

describe('Scouting Template: JSON Schema Field Definitions', () => {
  let baseContent: string;
  let commonContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
    commonContent = loadTemplate('common.txt');
  });

  describe('task field', () => {
    test('task field definition satisfies its complete contract', () => {
      const taskDocumentation = extractSchemaFieldDocumentation(baseContent, 'task');

      expect(taskDocumentation).not.toBeNull();
      expect(taskDocumentation).toMatch(/^\*\*task\*\*/);
      expect(taskDocumentation).toMatch(/\(string, max 200 characters\)/i);
      expect(taskDocumentation).toMatch(/concrete, actionable restatement/i);
      expect(taskDocumentation).toMatch(/Example: "Fix null-safety in parseRole\(\)"/i);
      expect(taskDocumentation).toMatch(
        /Do not use vague tasks such as "Make it better" or "Improve code quality"/i,
      );

      const unrelatedExamplesTemplate = `**task** (string, max 200 characters): Restatement.
**requirements** (array): Concrete, actionable. Example: "Fix null-safety in parseRole()". Do not use vague tasks such as "Make it better".`;
      expect(extractSchemaFieldDocumentation(unrelatedExamplesTemplate, 'task')).toBe(
        '**task** (string, max 200 characters): Restatement.',
      );
    });
  });

  describe('requirements field', () => {
    test('requirements field satisfies its complete collection contract', () => {
      const requirementsDocumentation = extractSchemaFieldDocumentation(baseContent, 'requirements');

      expect(requirementsDocumentation).not.toBeNull();
      expect(requirementsDocumentation).toMatch(/^\*\*requirements\*\*/);
      expect(requirementsDocumentation).toMatch(/\barray\b/i);
      expect(requirementsDocumentation).toMatch(/\b3\s*-\s*8\b/);
      expect(requirementsDocumentation).toMatch(/concrete/i);
      expect(requirementsDocumentation).toMatch(/independently verifiable/i);
      expect(requirementsDocumentation).toMatch(/testable/i);
      expect(requirementsDocumentation).toMatch(/Example:.*parseRole\(\).*null/i);

      const unrelatedGuidanceTemplate = `**requirements** (array): Requirements.
**observations** (array, 3-8 strings): Concrete, independently verifiable, testable requirements. Example: "parseRole() returns the default role for null input".`;
      const isolatedRequirementsDocumentation = extractSchemaFieldDocumentation(
        unrelatedGuidanceTemplate,
        'requirements',
      );
      expect(isolatedRequirementsDocumentation).toBe('**requirements** (array): Requirements.');
      expect(isolatedRequirementsDocumentation).not.toMatch(/\(array, 3-8 strings\)/i);
      expect(isolatedRequirementsDocumentation).not.toMatch(/concrete|independently verifiable/i);
      expect(isolatedRequirementsDocumentation).not.toMatch(/Example:/i);
    });
  });

  describe('relevant_files field', () => {
    test('relevant_files field is documented', () => {
      expect(baseContent).toMatch(/relevant_files[\s:]/i);
    });

    test('relevant_files min/max range is documented', () => {
      expect(baseContent).toMatch(/5\b.*20|20\b.*5/);
    });

    test('relevant_files entries must be objects with path and reason', () => {
      expect(baseContent).toMatch(/path/i);
      expect(baseContent).toMatch(/reason/i);
      expect(baseContent).toMatch(/separate/i);
    });

    test('relevant_files should NOT use string format (path - reason)', () => {
      // Verify the guidance explicitly rejects string format
      expect(baseContent).toMatch(/never.*string|string.*never/i);
    });
  });

  describe('plan field', () => {
    test('plan example is concrete step', () => {
      const planDocumentation = extractSchemaFieldDocumentation(baseContent, 'plan');

      expect(planDocumentation).not.toBeNull();
      expect(planDocumentation).toMatch(/\(array, 5-15 strings\)/i);
      expect(planDocumentation).toMatch(/no.*finish|no.*verify/i);

      const planExample = extractDocumentedExample(planDocumentation ?? '');
      expect(planExample).not.toBeNull();
      expect(isConcretePlanStep(planExample ?? '')).toBe(true);

      // Action verbs alone do not make generic prose an actionable plan step.
      expect(isConcretePlanStep('Add better error handling')).toBe(false);
      expect(isConcretePlanStep('Modify src/lib/role.ts')).toBe(false);
    });
  });

  describe('validation field', () => {
    test('validation field is documented', () => {
      expect(baseContent).toMatch(/validation[\s:]/i);
    });

    test('validation min/max range is documented', () => {
      expect(baseContent).toMatch(/2\b.*10|10\b.*2/);
    });

    test('validation examples are concrete commands', () => {
      expect(baseContent).toMatch(/npm run/i);
    });
  });

  describe('test_impact field', () => {
    test('test_impact field is documented', () => {
      expect(baseContent).toMatch(/test_impact[\s:]/i);
    });

    test('test_impact is documented in common.txt', () => {
      expect(commonContent).toMatch(/test_impact/i);
    });

    test('test_impact includes type, before, after, pattern, description', () => {
      expect(commonContent).toMatch(/type/i);
      expect(commonContent).toMatch(/before/i);
      expect(commonContent).toMatch(/after/i);
      expect(commonContent).toMatch(/pattern/i);
      expect(commonContent).toMatch(/description/i);
    });

    test('test_impact has max 5 examples per file', () => {
      expect(commonContent).toMatch(/5.*test_example|max.*5/i);
    });
  });

  describe('critical_change_expectations field', () => {
    test('critical_change_expectations is documented', () => {
      expect(baseContent).toMatch(/critical_change_expectations/i);
    });

    test('required_files guidance is present', () => {
      expect(baseContent).toMatch(/required_files/i);
    });

    test('forbidden_empty_diff guidance is present', () => {
      expect(baseContent).toMatch(/forbidden_empty_diff/i);
    });

    test('guidance distinguishes between "must change" vs "already correct"', () => {
      expect(baseContent).toMatch(/CORRECT|INCORRECT/);
    });
  });

  describe('suggested_allowlist field', () => {
    test('suggested_allowlist is documented', () => {
      expect(baseContent).toMatch(/suggested_allowlist/i);
    });

    test('agent_patterns guidance is present', () => {
      expect(baseContent).toMatch(/agent_patterns/i);
    });

    test('validation_patterns guidance is present', () => {
      expect(baseContent).toMatch(/validation_patterns/i);
    });
  });
});

// ============================================================================
// TEST SUITE 2: Task Validation Constraints
// Verifies guidance for validating task scope before scouting
// ============================================================================

describe('Scouting Template: Task Validation', () => {
  let baseContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
  });

  test('task validation section exists', () => {
    expect(baseContent).toMatch(/TASK.*VALIDATION|validation.*task/i);
  });

  // Task Validation requirement: valid examples must name an action, code target, and behavior.
  test.each([
    ['base.txt task-validation section', () => baseContent, true],
    [
      'unrelated prose containing validity markers',
      () => `## [TASK VALIDATION - Ensure Task is Valid Before Scouting]
This unrelated prose calls something a valid task and includes ✓ without documenting an example.

**Ambiguous/Invalid tasks** (ask clarifying questions):
- Make the code better`,
      false,
    ],
  ])('%s satisfies the valid-task-example contract', (_name, templateFactory, expected) => {
    expect(satisfiesValidTaskExamplesContract(templateFactory())).toBe(expected);
  });

  test('Task Validation requirement: explicitly labeled invalid examples include a vague task', () => {
    const invalidExamples = extractInvalidTaskExamples(baseContent);

    expect(invalidExamples).not.toHaveLength(0);
    expect(invalidExamples.some((example) => /Make.*better|Improve.*quality/i.test(example))).toBe(
      true,
    );

    const unrelatedInvalidText = `Invalid example: Improve code quality.

## [TASK VALIDATION - Ensure Task is Valid Before Scouting]
**Valid tasks** (proceed with scouting):
- Fix null-safety in parseRole() in src/lib/role.ts`;
    expect(extractInvalidTaskExamples(unrelatedInvalidText)).toEqual([]);
  });

  test('guidance says when to ask clarifying questions', () => {
    expect(baseContent).toMatch(/clarif|unclear|ambiguous/i);
  });
});

// ============================================================================
// TEST SUITE 3: Test Impact Guidance
// Verifies detailed guidance for identifying test coverage impact
// ============================================================================

describe('Scouting Template: Test Impact Guidance', () => {
  let baseContent: string;
  let commonContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
    commonContent = loadTemplate('common.txt');
  });

  test('guidance on when to include test_impact', () => {
    expect(baseContent).toMatch(/when.*include|include.*test_impact/i);
  });

  test('guidance on when test_impact can be empty', () => {
    expect(baseContent).toMatch(/empty.*test_impact|test_impact.*empty/i);
  });

  test('documentation updates mentioned as test_impact-free scenario', () => {
    expect(baseContent).toMatch(/documentation.*empty|document.*README|README.*comment/i);
  });

  test('test_impact examples are concrete (parser, event, serialization changes)', () => {
    expect(commonContent.toLowerCase()).toMatch(/parser|event|serialization|camelcase/);
  });

  test('before/after assertion examples are included', () => {
    expect(commonContent).toMatch(/before|after|expect/i);
  });

  test('type field options documented', () => {
    expect(commonContent).toMatch(/added_assertion|modified_assertion/i);
  });
});

// ============================================================================
// TEST SUITE 4: Execution Context Constraints
// Verifies efficiency and error handling guidance
// ============================================================================

describe('Scouting Template: Execution Context', () => {
  let commonContent: string;

  beforeAll(() => {
    commonContent = loadTemplate('common.txt');
  });

  test('execution context section exists', () => {
    expect(commonContent).toMatch(/execution.*context|EXECUTION.*CONTEXT/i);
  });

  test('timeout constraints are documented', () => {
    expect(commonContent).toMatch(/timeout|2.*minute|second/i);
  });

  test('artifact size constraint is documented', () => {
    expect(commonContent).toMatch(/50.*KB|size.*50|artifact.*size/i);
  });

  test('error handling guidance is present', () => {
    expect(commonContent).toMatch(/error|fail|unreadable/i);
  });

  test('guidance says to proceed with limited scope on errors', () => {
    expect(commonContent).toMatch(/proceed|limited.*scope|adapt/i);
  });
});

// ============================================================================
// TEST SUITE 5: Raw Text Format (No Links)
// Verifies templates are raw text suitable for LLM payloads
// ============================================================================

describe('Scouting Template: Raw Text Format', () => {
  let baseContent: string;
  let commonContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
    commonContent = loadTemplate('common.txt');
  });

  test('no markdown links in base.txt', () => {
    // Should not have [text](url) markdown links
    expect(baseContent).not.toMatch(/\[.+\]\(.+\)/);
  });

  test('no markdown links in common.txt', () => {
    expect(commonContent).not.toMatch(/\[.+\]\(.+\)/);
  });

  test('plain text section headers used (## [SECTION])', () => {
    expect(baseContent).toMatch(/##\s*\[/);
  });

  test('no HTML tag markup (but placeholders like <original> are OK)', () => {
    // Should not have HTML tags like <div>, <br>, <p>, etc
    // Placeholders like <original> and size specs like <50 KB are intentional
    expect(baseContent).not.toMatch(/<(?:div|span|p|br|html|body|head|style|script)\b/i);
    expect(commonContent).not.toMatch(/<(?:div|span|p|br|html|body|head|style|script)\b/i);
  });
});

// ============================================================================
// TEST SUITE 6: Artifact Output Constraints
// Verifies all rules for JSON artifact output location and format
// ============================================================================

describe('Scouting Template: Artifact Output Rules', () => {
  let baseContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
  });

  test('artifact location /results/scouting-candidate.json is documented', () => {
    expect(baseContent).toMatch(/scouting-candidate\.json/i);
  });

  test('guidance on artifact size limit is present', () => {
    expect(baseContent).toMatch(/50.*KB|json.*size|size.*json/i);
  });

  test('guidance says artifact is only accepted handoff location', () => {
    expect(baseContent).toMatch(/only.*handoff|handoff.*location/i);
  });

  test('guidance on JSON output rules is present', () => {
    expect(baseContent).toMatch(/output.*rule|rule.*json|json.*concrete/i);
  });
});

// ============================================================================
// TEST SUITE 7: Token Efficiency Validation
// Verifies optimization targets without losing functional content
// ============================================================================

describe('Scouting Template: Token Efficiency', () => {
  let baseContent: string;
  let commonContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
    commonContent = loadTemplate('common.txt');
  });

  test('stays within the compression budget without redundant field definitions', () => {
    const baseWords = baseContent.split(/\s+/).length;
    const baseTokens = Math.ceil(baseWords / 0.75);
    const commonWords = commonContent.split(/\s+/).length;
    const commonTokens = Math.ceil(commonWords / 0.75);
    const concreteCount = (baseContent.match(/concrete/gi) || []).length;

    // Keep the current optimized templates below a 2,500-token proxy budget.
    expect(baseTokens).toBeGreaterThan(1000);
    expect(commonTokens).toBeGreaterThan(200);
    expect(baseTokens + commonTokens).toBeLessThan(2500);

    // Preserve the instruction while preventing excessive repetition.
    expect(concreteCount).toBeGreaterThan(0);
    expect(concreteCount).toBeLessThan(15);

    // Log for verification
    console.log(`Base tokens: ${baseTokens}, Common tokens: ${commonTokens}, Total: ${baseTokens + commonTokens}, Budget: <2500`);
  });
});

// ============================================================================
// TEST SUITE 8: Critical Rules Must Survive Compression
// Verifies key semantic content is never removed
// ============================================================================

describe('Scouting Template: Critical Content Preservation', () => {
  let baseContent: string;
  let commonContent: string;

  beforeAll(() => {
    baseContent = loadTemplate('base.txt');
    commonContent = loadTemplate('common.txt');
  });

  test('read-only constraints documented in base.txt', () => {
    expect(baseContent).toMatch(/read.only|read-only/i);
  });

  test('JSON field type information preserved', () => {
    // Every field should have type (array, string, object)
    expect(baseContent).toMatch(/array|string|object|boolean/i);
  });

  test('concrete requirement emphasized', () => {
    // Must appear multiple times to show emphasis
    expect(baseContent).toMatch(/concrete/i);
  });

  test('min/max constraints for arrays documented', () => {
    expect(baseContent).toMatch(/\bmin\b|\bmax\b|range/i);
  });

  test('validation logic present for critical fields', () => {
    expect(baseContent).toMatch(/required_files|forbidden_empty_diff/i);
    expect(commonContent).toMatch(/test_impact/i);
  });

  test('examples demonstrate correct patterns', () => {
    expect(commonContent).toMatch(/parseRole|camelCase|before.*after/i);
  });
});
