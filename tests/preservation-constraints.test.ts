/**
 * Preservation Constraints Tests
 * 
 * Tests for prevention of kaseki-241-style failures where agents
 * remove protected content during restructuring tasks.
 * 
 * TDD approach for items 1-5:
 * - Preservation schema extensions
 * - Pre-coding checkpoint
 * - Diff-based validation
 * - Enhanced goal-check retry
 */

import {
  GoalSettingOutput,
  PreservationConstraints,
  parseGoalSettingOutput,
  isGoalSettingOutput,
  extractPreservationViolations,
  buildPreservationWarnings,
} from '../src/types/goal-setting';
import {
  validatePreservationConstraints,
  generatePreservationCheckpoint,
  analyzeDiffForViolations,
  buildTargetedRetryPrompt,
} from '../src/lib/preservation-validator';

describe('Preservation Constraints (#1-5)', () => {
  describe('Schema Extension (Item 4)', () => {
    it('should validate preservation_constraints in goal-setting output', () => {
      const goal: GoalSettingOutput = {
        original_prompt: 'Restructure TROUBLESHOOTING.md',
        upgraded_goal: 'ADD symptom-oriented structure while PRESERVING exit code tables',
        key_requirements: ['Add symptom sections', 'Keep exit tables'],
        success_criteria: ['Symptom sections added', 'Exit tables preserved'],
        reasoning: 'Augmentation not replacement',
        confidence: 'high',
        anti_patterns: {
          do_not_break: ['Exit code reference table (lines 31-58)'],
          must_preserve: ['All 77 existing section headings'],
        },
        preservation_constraints: {
          protected_sections: ['Exit Code Reference', 'See Also'],
          protected_line_ranges: [
            { start: 31, end: 58, pattern: 'exit.*code.*\\d+', description: 'Exit code reference table' },
          ],
          max_line_reduction: 150,
          structural_requirements: {
            preserve_headings: true,
            preserve_code_blocks: true,
            preserve_tables: true,
          },
        },
      };

      expect(isGoalSettingOutput(goal)).toBe(true);
      expect(goal.preservation_constraints?.protected_sections).toHaveLength(2);
      expect(goal.preservation_constraints?.max_line_reduction).toBe(150);
    });

    it('should detect when preservation constraints are violated', () => {
      const violations = extractPreservationViolations({
        originalLines: 1148,
        modifiedLines: 890,
        removedSections: ['Exit Code Reference'],
        removedLineRanges: [{ start: 31, end: 58 }],
        constraints: {
          max_line_reduction: 150,
          protected_sections: ['Exit Code Reference'],
        },
      });

      expect(violations).toHaveLength(2);
      expect(violations[0].type).toBe('section_removed');
      expect(violations[0].detail).toContain('Exit Code Reference');
      expect(violations[1].type).toBe('line_reduction_exceeded');
    });
  });

  describe('Pre-Coding Checkpoint (Item 2)', () => {
    it('should generate caveman-style preservation warnings', () => {
      const warnings = generatePreservationCheckpoint({
        protected_sections: ['Exit Code Reference (lines 31-58)'],
        protected_line_ranges: [
          { start: 31, end: 58, pattern: 'exit.*code', description: 'Exit code table' },
        ],
        max_line_reduction: 150,
        structural_requirements: {
          preserve_headings: true,
          preserve_code_blocks: true,
        },
      });

      // Caveman style: terse, no articles
      expect(warnings).toContain('⚠ PRESERVE lines 31-58: Exit code table');
      expect(warnings).toContain('DO NOT: Delete, move, restructure');
      expect(warnings).toContain('MAY: Add content before/after');
      expect(warnings).toContain('Max removal: 150 lines');
      expect(warnings).not.toContain('the '); // No articles
      expect(warnings).not.toContain('you must'); // No pleasantries
    });

    it('should inject checkpoint into Pi prompt context', () => {
      const checkpoint = buildPreservationWarnings({
        must_preserve: ['Exit code table (lines 31-58)', 'See Also section'],
        max_line_reduction: 150,
      });

      expect(checkpoint).toMatch(/^⚠ PRESERVATION CONSTRAINTS:/);
      expect(checkpoint).toContain('Exit code table');
      expect(checkpoint).toContain('lines 31-58');
      expect(checkpoint.length).toBeLessThan(300); // Token-efficient
    });
  });

  describe('Diff-Based Validation (Item 5)', () => {
    it('should detect removed protected content in diff', () => {
      const mockDiff = `
--- a/docs/TROUBLESHOOTING.md
+++ b/docs/TROUBLESHOOTING.md
@@ -31,28 +31,0 @@
-| Exit Code | Meaning |
-| --- | --- |
-| 0 | Success |
-| 1 | General failure |
+New content here
`;

      const violations = analyzeDiffForViolations(mockDiff, {
        protected_line_ranges: [
          { start: 31, end: 58, pattern: 'exit.*code', description: 'Exit table' },
        ],
      });

      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('protected_range_deleted');
      expect(violations[0].lineRange).toEqual({ start: 31, end: 58 });
    });

    it('should allow additions around protected content', () => {
      const mockDiff = `
--- a/docs/TROUBLESHOOTING.md
+++ b/docs/TROUBLESHOOTING.md
@@ -25,0 +26,5 @@
+New symptom section
+
+## Container Failures
+...
 | Exit Code | Meaning |
`;

      const violations = analyzeDiffForViolations(mockDiff, {
        protected_line_ranges: [
          { start: 31, end: 58, pattern: 'exit.*code', description: 'Exit table' },
        ],
      });

      expect(violations).toHaveLength(0); // Additions OK
    });

    it('should measure net line reduction accurately', () => {
      const diff = {
        additions: 150,
        deletions: 350,
        netReduction: 200,
      };

      const violations = analyzeDiffForViolations('', {
        max_line_reduction: 150,
      }, diff);

      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('line_reduction_exceeded');
      expect(violations[0].actual).toBe(200);
      expect(violations[0].limit).toBe(150);
    });
  });

  describe('Enhanced Goal-Check Retry (Item 3)', () => {
    it('should build targeted retry prompt for preservation violations', () => {
      const retryPrompt = buildTargetedRetryPrompt({
        violation_type: 'preservation_constraint',
        violated_constraint: 'Exit code reference table (lines 31-58) removed',
        remediation: 'Restore lines 31-58 from original. ADD new content around preserved table.',
        preservedSections: ['Exit Code Reference'],
      });

      // Caveman style
      expect(retryPrompt).toContain('PRESERVATION VIOLATION:');
      expect(retryPrompt).toContain('lines 31-58');
      expect(retryPrompt).toContain('Restore');
      expect(retryPrompt).toMatch(/ADD.*around/);
      expect(retryPrompt.length).toBeLessThan(300); // Token-efficient
      expect(retryPrompt).not.toMatch(/\b(the|a|an)\b/); // No articles
    });

    it('should include specific file restoration instructions', () => {
      const retryPrompt = buildTargetedRetryPrompt({
        violation_type: 'preservation_constraint',
        violated_constraint: 'Section removed',
        remediation: 'Restore protected content',
        file: 'docs/TROUBLESHOOTING.md',
        lineRange: { start: 31, end: 58 },
      });

      expect(retryPrompt).toContain('docs/TROUBLESHOOTING.md');
      expect(retryPrompt).toMatch(/31,58/); // Line range in command
      expect(retryPrompt).toMatch(/git show|git checkout/); // Restoration command
    });
  });

  describe('Task Prompt Templates (Item 1)', () => {
    it('should use AUGMENT/ADD language not REPLACE/RESTRUCTURE', () => {
      const goodPrompt = `
AUGMENT TROUBLESHOOTING.md by ADDING symptom-oriented sections 
WHILE PRESERVING all existing exit code tables and reference sections.
DO NOT remove existing content.
      `.trim();

      const badPrompt = `
Restructure TROUBLESHOOTING.md from exit-code-centric to symptom-oriented,
replacing old content with new organization.
      `.trim();

      expect(goodPrompt).toContain('AUGMENT');
      expect(goodPrompt).toContain('PRESERVING');
      expect(goodPrompt).toContain('DO NOT remove');
      expect(badPrompt).toContain('Restructure');
      expect(badPrompt).toContain('replacing');

      // Validate template language
      const hasPreservationLanguage = /\b(AUGMENT|ADD|PRESERV|KEEP|DO NOT.*remove)\b/.test(goodPrompt);
      const hasReplacementLanguage = /\b(restructure|replace|remove old)\b/i.test(badPrompt);

      expect(hasPreservationLanguage).toBe(true);
      expect(hasReplacementLanguage).toBe(true);
    });
  });

  describe('Integration: Full Prevention Flow', () => {
    it('should prevent kaseki-241 scenario', () => {
      // Goal-setting creates constraints
      const goal: GoalSettingOutput = {
        original_prompt: 'Restructure TROUBLESHOOTING.md',
        upgraded_goal: 'AUGMENT with symptom sections, PRESERVE exit tables',
        key_requirements: ['Add symptom index', 'Keep all exit code tables'],
        success_criteria: ['Symptom sections added', 'No protected content removed'],
        reasoning: 'Augmentation strategy prevents loss',
        confidence: 'high',
        anti_patterns: {
          must_preserve: ['Exit code reference table (lines 31-58)'],
        },
        preservation_constraints: {
          protected_line_ranges: [
            { start: 31, end: 58, pattern: 'exit.*code', description: 'Exit code table' },
          ],
          max_line_reduction: 150,
        },
      };

      // Pre-coding checkpoint generates warnings
      const checkpoint = generatePreservationCheckpoint(goal.preservation_constraints!);
      expect(checkpoint).toContain('PRESERVE lines 31-58');

      // Agent makes changes (simulated)
      const mockDiff = `
--- a/docs/TROUBLESHOOTING.md
+++ b/docs/TROUBLESHOOTING.md
@@ -31,28 +31,0 @@
-| Exit Code | Meaning |
-| 0 | Success |
`;

      // Diff validation catches violation
      const violations = analyzeDiffForViolations(mockDiff, goal.preservation_constraints!);
      expect(violations).toHaveLength(1);
      expect(violations[0].type).toBe('protected_range_deleted');

      // Enhanced retry prompt provides guidance
      const retry = buildTargetedRetryPrompt({
        violation_type: 'preservation_constraint',
        violated_constraint: violations[0].detail!,
        remediation: 'Restore protected lines, ADD new content separately',
      });

      expect(retry).toContain('Restore');
      expect(retry).toContain('lines 31-58');
    });
  });
});
