#!/usr/bin/env node
/**
 * hashline-validator.ts
 *
 * Core validator for hashline edit operations.
 * Validates SHA-256 content anchors and applies edits to files.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HashlineEdit, HashlineValidationResult, HashlineEventResult, HashlineSummary } from './lib/hashline-types.js';

/**
 * HashlineValidator: Validates and applies hashline edit operations
 *
 * Usage:
 *   const validator = new HashlineValidator();
 *   const result = validator.validateAnchor(edit);
 *   if (result.valid) {
 *     validator.applyEdit(edit, result.lineStart!, result.lineEnd!);
 *   }
 */
export class HashlineValidator {
  /**
   * Get SHA-256 hash of a line, returning first 8 characters
   * @param line Line content (with or without trailing newline)
   * @returns 8-character SHA-256 hash prefix
   */
  private getLineHash(line: string): string {
    // Remove trailing newline for consistent hashing
    const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
    return crypto
      .createHash('sha256')
      .update(normalized, 'utf-8')
      .digest('hex')
      .slice(0, 8);
  }

  /**
   * Pre-compute and cache hashes for all lines in a file
   * @param lines Array of line strings
   * @returns Map of line number to 8-char hash
   */
  private computeLineHashes(lines: string[]): Map<number, string> {
    const hashes = new Map<number, string>();
    for (let i = 0; i < lines.length; i++) {
      hashes.set(i, this.getLineHash(lines[i]));
    }
    return hashes;
  }

  /**
   * Validate that anchor hashes match the file's current content
   * @param edit Hashline edit to validate
   * @returns Validation result with line numbers if valid, reason if invalid
   */
  validateAnchor(edit: HashlineEdit): HashlineValidationResult {
    try {
      // Read file content
      if (!fs.existsSync(edit.file)) {
        return {
          valid: false,
          reason: `File not found: ${edit.file}`,
        };
      }

      const fileContent = fs.readFileSync(edit.file, 'utf-8');
      const lines = fileContent.split('\n');

      // Pre-compute all line hashes for performance
      const hashes = this.computeLineHashes(lines);

      // Find line that starts with start_hash
      let startLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (hashes.get(i)?.startsWith(edit.anchor.start_hash)) {
          startLine = i;
          break;
        }
      }

      if (startLine === -1) {
        return {
          valid: false,
          reason: `Start anchor ${edit.anchor.start_hash} not found in ${edit.file}`,
        };
      }

      // Find line that ends with end_hash (within contextLines distance from start)
      // For single-line edits, endLine can equal startLine
      const searchStart = startLine;
      const searchEnd = Math.min(startLine + edit.anchor.context_lines + 15, lines.length);

      let endLine = -1;
      for (let i = searchStart; i < searchEnd; i++) {
        if (hashes.get(i)?.startsWith(edit.anchor.end_hash)) {
          endLine = i;
          break;
        }
      }

      if (endLine === -1) {
        return {
          valid: false,
          reason: `End anchor ${edit.anchor.end_hash} not found within context (searched lines ${searchStart}–${searchEnd - 1})`,
        };
      }

      // Ensure end_line is not before start_line
      if (endLine < startLine) {
        return {
          valid: false,
          reason: `End anchor found before start anchor (line ${endLine} < ${startLine})`,
        };
      }

      // Return valid with line numbers (endLine is inclusive, so we add 1 for the slice end)
      return {
        valid: true,
        lineStart: startLine,
        lineEnd: endLine + 1, // +1 because lineEnd is exclusive (for array slicing)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        valid: false,
        reason: `Error validating anchor: ${message}`,
      };
    }
  }

  /**
   * Apply a validated hashline edit to a file
   * Assumes lineStart and lineEnd are valid (call validateAnchor first)
   * @param edit Hashline edit to apply
   * @param lineStart 0-based line number of first line to replace
   * @param lineEnd 0-based line number after last line to replace (exclusive)
   * @throws If file cannot be read/written
   */
  applyEdit(edit: HashlineEdit, lineStart: number, lineEnd: number): void {
    // Read file
    const fileContent = fs.readFileSync(edit.file, 'utf-8');
    const lines = fileContent.split('\n');

    // Validate line range
    if (lineStart < 0 || lineEnd > lines.length || lineStart > lineEnd) {
      throw new Error(
        `Invalid line range for ${edit.file}: lineStart=${lineStart}, lineEnd=${lineEnd}, total lines=${lines.length}`
      );
    }

    // Build new content: lines before + replacement + lines after
    const linesBefore = lines.slice(0, lineStart);
    const replacementLines = edit.replacement.split('\n');
    const linesAfter = lines.slice(lineEnd);

    const newLines = [...linesBefore, ...replacementLines, ...linesAfter];
    const newContent = newLines.join('\n');

    // Write back to file
    fs.writeFileSync(edit.file, newContent, 'utf-8');
  }

  /**
   * Process all hashline edits in an edit list
   * Returns results for each edit (success or failure)
   * @param edits Array of hashline edits
   * @param workspaceDir Workspace root (for file paths)
   * @returns Array of event results with summary
   */
  processEdits(edits: HashlineEdit[], workspaceDir: string): { results: HashlineEventResult[]; summary: HashlineSummary } {
    const results: HashlineEventResult[] = [];
    const summary: HashlineSummary = {
      applied: 0,
      rejected: 0,
      errors: 0,
      totalLinesModified: 0,
    };

    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const eventId = `hashline_${i}`;
      const timestamp = new Date().toISOString();

      try {
        // Resolve file path relative to workspace
        const filePath = path.resolve(workspaceDir, edit.file);

        // Create a modified edit with absolute path for validation
        const absoluteEdit = { ...edit, file: filePath };

        // Validate anchor
        const validation = this.validateAnchor(absoluteEdit);

        if (!validation.valid) {
          results.push({
            eventId,
            file: edit.file,
            status: 'rejected',
            reason: validation.reason || 'Unknown validation error',
            timestamp,
          });
          summary.rejected++;
          continue;
        }

        // Apply edit
        this.applyEdit(absoluteEdit, validation.lineStart!, validation.lineEnd!);

        const linesModified = validation.lineEnd! - validation.lineStart!;
        results.push({
          eventId,
          file: edit.file,
          status: 'applied',
          reason: 'Successfully applied',
          linesModified,
          timestamp,
        });
        summary.applied++;
        summary.totalLinesModified += linesModified;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          eventId,
          file: edit.file,
          status: 'error',
          reason: message,
          timestamp,
        });
        summary.errors++;
      }
    }

    return { results, summary };
  }
}

/**
 * Standalone function: Validate a single hashline edit
 * @param edit Hashline edit to validate
 * @returns Validation result
 */
export function validateHashlineEdit(edit: HashlineEdit): HashlineValidationResult {
  const validator = new HashlineValidator();
  return validator.validateAnchor(edit);
}

/**
 * Standalone function: Apply a validated hashline edit
 * @param edit Hashline edit to apply
 * @param lineStart 0-based line number of first line to replace
 * @param lineEnd 0-based line number after last line to replace (exclusive)
 */
export function applyHashlineEdit(edit: HashlineEdit, lineStart: number, lineEnd: number): void {
  const validator = new HashlineValidator();
  validator.applyEdit(edit, lineStart, lineEnd);
}

export default HashlineValidator;
