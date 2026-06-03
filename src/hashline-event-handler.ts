#!/usr/bin/env node
/**
 * hashline-event-handler.ts
 *
 * Processes Pi JSONL events for hashline_edit tool calls.
 * Validates anchors, applies edits, and records results.
 *
 * Usage (CLI):
 *   node src/hashline-event-handler.js <input-jsonl> <workspace-dir> [output-jsonl] [output-summary]
 *
 * Example:
 *   node src/hashline-event-handler.js /results/pi-events.raw.jsonl /workspace /results/hashline-events.jsonl /results/hashline-summary.json
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { HashlineValidator } from './hashline-validator.js';
import {
  HashlineEdit,
  HashlineEventResult,
  HashlineSummary,
} from './lib/hashline-types.js';

/**
 * PiEvent: Minimal Pi JSONL event structure
 * (Only fields relevant to hashline processing)
 */
interface PiEvent {
  type?: string;
  event?: string;
  tool_name?: string;
  [key: string]: any;
}

/**
 * Process all hashline_edit events from a Pi JSONL file
 */
export async function processHashlineEventsFromFile(
  inputJsonlPath: string,
  workspaceDir: string
): Promise<{ results: HashlineEventResult[]; summary: HashlineSummary }> {
  const results: HashlineEventResult[] = [];
  const summary: HashlineSummary = {
    applied: 0,
    rejected: 0,
    errors: 0,
    totalLinesModified: 0,
  };

  const validator = new HashlineValidator();

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(inputJsonlPath),
      crlfDelay: Infinity,
    });

    let eventCount = 0;

    rl.on('line', (line: string) => {
      if (!line.trim()) {
        return;
      }

      eventCount++;
      let event: PiEvent;

      try {
        event = JSON.parse(line);
      } catch {
        // Silently skip invalid JSON lines
        return;
      }

      // Look for tool_call events with hashline_edit
      if (event.type === 'tool_call' && isHashlineEditCall(event)) {
        const result = processHashlineEditEvent(event, validator, workspaceDir, eventCount);
        results.push(result);

        // Update summary
        if (result.status === 'applied') {
          summary.applied++;
          summary.totalLinesModified += result.linesModified || 0;
        } else if (result.status === 'rejected') {
          summary.rejected++;
        } else {
          summary.errors++;
        }
      }
    });

    rl.on('error', (error) => {
      reject(error);
    });

    rl.on('close', () => {
      resolve({ results, summary });
    });
  });
}

/**
 * Check if an event is a hashline_edit tool call
 */
function isHashlineEditCall(event: PiEvent): boolean {
  // Check for hashline_edit in various field positions
  // (Pi might structure it differently depending on model/API)
  const toolName =
    event.tool_name ||
    (event as any).call?.name ||
    (event as any).tool?.name ||
    '';

  return toolName === 'hashline_edit' || (event as any).name === 'hashline_edit';
}

/**
 * Extract hashline_edit call details from a Pi tool_call event
 */
function extractHashlineEditCall(event: PiEvent): HashlineEdit | null {
  try {
    // Try to extract edit details from various Pi event structures
    const callData = (event as any).call || (event as any).input || event;

    if (!callData) {
      return null;
    }

    const file = callData.file || (event as any).arguments?.file;
    const replacement = callData.replacement || (event as any).arguments?.replacement;
    const anchor = callData.anchor || (event as any).arguments?.anchor;

    if (!file || !replacement || !anchor) {
      return null;
    }

    return {
      type: 'hashline_edit',
      file,
      anchor,
      replacement,
    };
  } catch {
    return null;
  }
}

/**
 * Process a single hashline_edit tool call event
 */
function processHashlineEditEvent(
  event: PiEvent,
  validator: HashlineValidator,
  workspaceDir: string,
  eventIndex: number
): HashlineEventResult {
  const timestamp = new Date().toISOString();
  const eventId = `hashline_${eventIndex}`;

  try {
    // Extract edit details
    const edit = extractHashlineEditCall(event);
    if (!edit) {
      return {
        eventId,
        file: 'unknown',
        status: 'error',
        reason: 'Could not extract hashline_edit details from Pi event',
        timestamp,
      };
    }

    // Resolve absolute path
    const filePath = path.resolve(workspaceDir, edit.file);

    // Validate anchor
    const absoluteEdit = { ...edit, file: filePath };
    const validation = validator.validateAnchor(absoluteEdit);

    if (!validation.valid) {
      return {
        eventId,
        file: edit.file,
        status: 'rejected',
        reason: validation.reason || 'Anchor validation failed',
        timestamp,
      };
    }

    // Apply edit
    validator.applyEdit(absoluteEdit, validation.lineStart!, validation.lineEnd!);

    const linesModified = validation.lineEnd! - validation.lineStart!;
    return {
      eventId,
      file: edit.file,
      status: 'applied',
      reason: 'Successfully applied',
      linesModified,
      timestamp,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      eventId,
      file: 'unknown',
      status: 'error',
      reason: message,
      timestamp,
    };
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const inputJsonl = process.argv[2] || '/results/pi-events.raw.jsonl';
  const workspaceDir = process.argv[3] || '/workspace';
  const outputJsonl = process.argv[4] || '/results/hashline-events.jsonl';
  const outputSummary = process.argv[5] || '/results/hashline-summary.json';

  try {
    // Check input file exists
    if (!fs.existsSync(inputJsonl)) {
      console.error(`Error: Input JSONL not found: ${inputJsonl}`);
      process.exit(1);
    }

    // Check workspace directory exists
    if (!fs.existsSync(workspaceDir)) {
      console.error(`Error: Workspace directory not found: ${workspaceDir}`);
      process.exit(1);
    }

    // Process events
    const { results, summary } = await processHashlineEventsFromFile(inputJsonl, workspaceDir);

    // Write results
    if (results.length > 0) {
      const resultsJsonl = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(outputJsonl, resultsJsonl, 'utf-8');
      console.log(`Wrote ${results.length} hashline event results to ${outputJsonl}`);
    }

    // Write summary
    fs.writeFileSync(outputSummary, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`Wrote hashline summary to ${outputSummary}`);

    // Exit with appropriate code
    // Non-fatal: record rejections but don't fail overall pipeline
    if (summary.errors > 0) {
      console.warn(`Warning: ${summary.errors} hashline processing errors`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  }
}

// Run if called directly

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
