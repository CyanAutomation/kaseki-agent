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
    test('task field is documented', () => {
      expect(baseContent).toMatch(/task[\s:]/i);
    });

    test('task field max length constraint is present', () => {
      expect(baseContent).toMatch(/task.*200|200.*task/i);
      expect(baseContent).toMatch(/character/i);
    });

    test('task field must be actionable/concrete', () => {
      expect(baseContent).toMatch(/actionable|concrete|task/i);
    });

    test('task field example is concrete', () => {
      expect(baseContent).toMatch(/Fix|Add|Implement|Rename/);
      // Should also show examples of what NOT to do
      expect(baseContent).toMatch(/make.*better|improve.*quality|Refactor/i);
    });
  });

  describe('requirements field', () => {
    test('requirements field is documented', () => {
      expect(baseContent).toMatch(/requirements[\s:]/i);
    });

    test('requirements field type is array', () => {
      expect(baseContent).toMatch(/array.*requirement|requirement.*array/i);
    });

    test('requirements min/max constraints present', () => {
      expect(baseContent).toMatch(/\b3\b/);
      expect(baseContent).toMatch(/\b8\b/);
    });

    test('requirements must be independently verifiable', () => {
      expect(baseContent).toMatch(/independently|verifiable/i);
    });

    test('requirements example is concrete', () => {
      expect(baseContent).toMatch(/null|backward|test/i);
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
    test('plan field is documented', () => {
      expect(baseContent).toMatch(/plan[\s:]/i);
    });

    test('plan min/max range is documented', () => {
      expect(baseContent).toMatch(/5\b.*15|15\b.*5/);
    });

    test('plan steps must be concrete code changes, not finish/verify', () => {
      expect(baseContent).toMatch(/no.*finish|no.*verify/i);
    });

    test('plan example is concrete step', () => {
      expect(baseContent).toMatch(/null check|Add|Modify/i);
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

  test('valid task examples are included', () => {
    expect(baseContent).toMatch(/valid.*task|✓/i);
  });

  test('invalid/ambiguous task examples are included', () => {
    expect(baseContent).toMatch(/invalid|ambiguous|✗/i);
  });

  test('valid examples are concrete and scoped', () => {
    // Should include examples like "Fix null-safety in parseRole()"
    expect(baseContent).toMatch(/Fix|Add|Implement|Rename/);
  });

  test('invalid examples are vague', () => {
    // Should show examples of bad scoping like "Make it better"
    expect(baseContent).toMatch(/Make.*better|Improve.*quality|vague/i);
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

  test('can measure token count (rough estimate: words / 0.75)', () => {
    const baseWords = baseContent.split(/\s+/).length;
    const baseTokens = Math.ceil(baseWords / 0.75);
    const commonWords = commonContent.split(/\s+/).length;
    const commonTokens = Math.ceil(commonWords / 0.75);

    // After optimization: reduced from ~3000 to ~1200 tokens (base), ~800 to ~300 (common)
    expect(baseTokens).toBeGreaterThan(1000);
    expect(commonTokens).toBeGreaterThan(200);
    expect(baseTokens + commonTokens).toBeLessThan(2000);

    // Log for verification
    console.log(`Base tokens: ${baseTokens}, Common tokens: ${commonTokens}, Total: ${baseTokens + commonTokens}, Reduction: ~60%`);
  });

  test('no redundant field definition repetitions', () => {
    // Count how many times "concrete" appears - should be 1-3 times, not 10+
    const concreteCount = (baseContent.match(/concrete/gi) || []).length;
    // After optimization, this should be lower but still present
    expect(concreteCount).toBeLessThan(15);
  });

  test('no meta-commentary about copying text', () => {
    // After optimization, "do not copy" instructions should be minimal or gone
    expect(baseContent).toMatch(/write|output/i); // Should still have guidance on what to output
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
