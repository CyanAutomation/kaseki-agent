/**
 * hashline-types.ts
 *
 * TypeScript interfaces for hashline editing feature.
 * Hashline editing uses SHA-256 content anchors instead of line numbers
 * or text-based string replacement.
 */

/**
 * HashlineAnchor: Content-based anchor using SHA-256 hashes
 *
 * - start_hash: First 8 characters of SHA-256 hash of the line to start replacement
 * - end_hash: First 8 characters of SHA-256 hash of the last line to replace
 * - context_lines: Number of surrounding lines to include for disambiguation
 */
export interface HashlineAnchor {
  start_hash: string;
  end_hash: string;
  context_lines: number;
}

/**
 * HashlineEdit: A single hashline edit operation
 *
 * - file: Path to file (relative to workspace root)
 * - anchor: Content-based anchors for the lines to replace
 * - replacement: New content to insert (may span multiple lines)
 */
export interface HashlineEdit {
  type: 'hashline_edit';
  file: string;
  anchor: HashlineAnchor;
  replacement: string;
}

/**
 * HashlineValidationResult: Result of validating a hashline anchor
 *
 * - valid: true if anchors were found in current file state
 * - lineStart: 0-based line number of first line to replace (if valid)
 * - lineEnd: 0-based line number after last line to replace (if valid)
 * - reason: Error reason if invalid (e.g., "Start anchor abc123 not found")
 */
export interface HashlineValidationResult {
  valid: boolean;
  lineStart?: number;
  lineEnd?: number;
  reason?: string;
}

/**
 * HashlineEventResult: Result of processing a single hashline event
 *
 * - eventId: Unique identifier for this event (from Pi event)
 * - file: Path to file edited
 * - status: 'applied' | 'rejected' | 'error'
 * - reason: Explanation (applied, anchor_not_found, stale_anchor, etc.)
 * - linesModified: Number of lines replaced
 * - timestamp: ISO timestamp
 */
export interface HashlineEventResult {
  eventId: string;
  file: string;
  status: 'applied' | 'rejected' | 'error';
  reason: string;
  linesModified?: number;
  timestamp: string;
}

/**
 * HashlineSummary: Aggregate statistics from hashline processing
 *
 * - applied: Number of edits successfully applied
 * - rejected: Number of edits rejected (stale anchors, etc.)
 * - errors: Number of unexpected errors
 * - totalLinesModified: Total lines replaced across all successful edits
 */
export interface HashlineSummary {
  applied: number;
  rejected: number;
  errors: number;
  totalLinesModified: number;
}
