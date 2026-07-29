/**
 * Preservation Validator
 *
 * Prevents kaseki-241-style failures where agents remove protected content.
 * Implements items 2, 3, 5 from prevention plan.
 */

import { PreservationConstraints, PreservationViolation } from '../types/goal-setting';

/**
 * Generate caveman-style pre-coding preservation checkpoint
 * Injected into Pi prompt before coding phase
 *
 * Caveman principles:
 * - No articles (a/an/the)
 * - Direct imperatives
 * - Pattern: [thing] [action] [reason]
 * - Token-efficient (<300 tokens)
 */
export function generatePreservationCheckpoint(constraints: PreservationConstraints): string {
  const lines: string[] = ['⚠ PRESERVATION CONSTRAINTS:'];

  if (constraints.protected_line_ranges && constraints.protected_line_ranges.length > 0) {
    lines.push('');
    lines.push('PROTECTED RANGES:');
    for (const range of constraints.protected_line_ranges) {
      const desc = range.description || `lines ${range.start}-${range.end}`;
      lines.push(`  ⚠ PRESERVE lines ${range.start}-${range.end}: ${desc}`);
      lines.push('     DO NOT: Delete, move, restructure');
      lines.push('     MAY: Add content before/after');
    }
  }

  if (constraints.protected_sections && constraints.protected_sections.length > 0) {
    lines.push('');
    lines.push('PROTECTED SECTIONS:');
    for (const section of constraints.protected_sections) {
      lines.push(`  ⚠ ${section}`);
    }
  }

  if (constraints.max_line_reduction !== undefined) {
    lines.push('');
    lines.push(`Max removal: ${constraints.max_line_reduction} lines`);
    lines.push('AUGMENT, not replace. ADD around protected content.');
  }

  if (constraints.structural_requirements) {
    const reqs = constraints.structural_requirements;
    const requirements = [];
    if (reqs.preserve_headings) requirements.push('headings');
    if (reqs.preserve_code_blocks) requirements.push('code blocks');
    if (reqs.preserve_tables) requirements.push('tables');
    if (requirements.length > 0) {
      lines.push('');
      lines.push(`Preserve: ${requirements.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Validate preservation constraints are met
 * Used in pre-quality-gate diff scanner
 */
export function validatePreservationConstraints(
  diff: string,
  _originalContent: string,
  constraints: PreservationConstraints,
): PreservationViolation[] {
  return analyzeDiffForViolations(diff, constraints);
}

/**
 * Analyze git diff for preservation violations
 * Detects: protected range deletions, excessive line reduction
 */
export function analyzeDiffForViolations(
  diff: string,
  constraints: PreservationConstraints,
  stats?: { additions: number; deletions: number; netReduction: number },
): PreservationViolation[] {
  const violations: PreservationViolation[] = [];

  // Check line reduction
  if (constraints.max_line_reduction !== undefined && stats) {
    if (stats.netReduction > constraints.max_line_reduction) {
      violations.push({
        type: 'line_reduction_exceeded',
        detail: `Removed ${stats.netReduction} lines, max: ${constraints.max_line_reduction}`,
        actual: stats.netReduction,
        limit: constraints.max_line_reduction,
      });
    }
  }

  // Check protected line ranges
  if (constraints.protected_line_ranges) {
    for (const range of constraints.protected_line_ranges) {
      if (isDeletingProtectedRange(diff, range.start, range.end)) {
        violations.push({
          type: 'protected_range_deleted',
          detail: `Protected lines ${range.start}-${range.end} deleted: ${range.description || 'protected content'}`,
          lineRange: { start: range.start, end: range.end },
        });
      }
    }
  }

  return violations;
}

/**
 * Check if diff deletes lines in protected range
 */
function isDeletingProtectedRange(diff: string, start: number, end: number): boolean {
  // Look for deletion hunks that overlap with protected range
  const hunkRegex = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/g;
  let match;

  while ((match = hunkRegex.exec(diff)) !== null) {
    const oldStart = parseInt(match[1], 10);
    const oldLines = match[2] ? parseInt(match[2], 10) : 1;
    const newLines = match[4] ? parseInt(match[4], 10) : 1;

    // Deletion: old lines > new lines
    if (oldLines > newLines) {
      const oldEnd = oldStart + oldLines - 1;
      // Check overlap with protected range
      if (oldStart <= end && oldEnd >= start) {
        // Find deletion lines in this hunk
        const hunkStartIndex = match.index;
        const nextHunkMatch = /@@ -/g;
        nextHunkMatch.lastIndex = hunkStartIndex + 4;
        const nextMatch = nextHunkMatch.exec(diff);
        const hunkEndIndex = nextMatch ? nextMatch.index : diff.length;
        const hunkContent = diff.slice(hunkStartIndex, hunkEndIndex);

        // Count deletion lines (lines starting with -)
        const deletions = (hunkContent.match(/^-[^-]/gm) || []).length;
        if (deletions > 0) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Build targeted retry prompt for preservation violations
 * Caveman style: terse, actionable, token-efficient
 */
export function buildTargetedRetryPrompt(params: {
  violation_type: string;
  violated_constraint: string;
  remediation: string;
  preservedSections?: string[];
  file?: string;
  lineRange?: { start: number; end: number };
}): string {
  const lines: string[] = [];

  lines.push('⚠ PRESERVATION VIOLATION:');
  lines.push(params.violated_constraint);
  lines.push('');
  lines.push('FIX:');
  lines.push(params.remediation);

  if (params.file && params.lineRange) {
    lines.push('');
    lines.push('RESTORE COMMAND:');
    lines.push(`git show HEAD:${params.file} | sed -n '${params.lineRange.start},${params.lineRange.end}p'`);
    lines.push('Copy protected content back. ADD around, not replace.');
  }

  if (params.preservedSections && params.preservedSections.length > 0) {
    lines.push('');
    lines.push(`Protected: ${params.preservedSections.join(', ')}`);
  }

  return lines.join('\n');
}
