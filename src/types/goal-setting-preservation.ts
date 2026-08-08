export interface PreservationViolation {
  type: 'section_removed' | 'line_reduction_exceeded' | 'protected_range_deleted' | 'structural_requirement_broken';
  detail?: string;
  lineRange?: { start: number; end: number };
  actual?: number;
  limit?: number;
}

export function extractPreservationViolations(analysis: {
  originalLines: number;
  modifiedLines: number;
  removedSections?: string[];
  removedLineRanges?: Array<{ start: number; end: number }>;
  constraints: { max_line_reduction?: number; protected_sections?: string[] };
}): PreservationViolation[] {
  const violations: PreservationViolation[] = [];
  if (analysis.removedSections && analysis.constraints.protected_sections) {
    for (const section of analysis.removedSections) {
      if (analysis.constraints.protected_sections.includes(section)) {
        violations.push({ type: 'section_removed', detail: `Protected section removed: ${section}` });
      }
    }
  }
  if (analysis.constraints.max_line_reduction !== undefined) {
    const netReduction = analysis.originalLines - analysis.modifiedLines;
    if (netReduction > analysis.constraints.max_line_reduction) {
      violations.push({
        type: 'line_reduction_exceeded',
        detail: `File reduced by ${netReduction} lines, max allowed: ${analysis.constraints.max_line_reduction}`,
        actual: netReduction,
        limit: analysis.constraints.max_line_reduction,
      });
    }
  }
  return violations;
}

export function buildPreservationWarnings(constraints: {
  must_preserve?: string[];
  max_line_reduction?: number;
}): string {
  const parts: string[] = ['⚠ PRESERVATION CONSTRAINTS:'];
  if (constraints.must_preserve?.length) {
    parts.push('', 'MUST PRESERVE:');
    for (const item of constraints.must_preserve) {
      const match = item.match(/\(lines? (\d+)-(\d+)\)/);
      if (match) {
        parts.push(`  • ${item}`, '    DO NOT: Delete, move, restructure', '    MAY: Add content before/after');
      } else {
        parts.push(`  • ${item}`);
      }
    }
  }
  if (constraints.max_line_reduction !== undefined) {
    parts.push('', `Max removal: ${constraints.max_line_reduction} lines`);
  }
  return parts.join('\n');
}
