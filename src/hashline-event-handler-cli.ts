#!/usr/bin/env node
/**
 * hashline-event-handler-cli.ts
 *
 * CLI wrapper for processing hashline events from Pi JSONL files.
 * This file handles the CLI argument parsing and invokes the main processor.
 */

import fs from 'node:fs';
import { processHashlineEventsFromFile } from './hashline-event-handler.js';

async function main() {
  const inputJsonl = process.argv[2] || '/results/pi-events.raw.jsonl';
  const workspaceDir = process.argv[3] || '/workspace';
  const outputJsonl = process.argv[4] || '/results/hashline-events.jsonl';
  const outputSummary = process.argv[5] || '/results/hashline-summary.json';

  try {
    // Check input file exists
    if (!fs.existsSync(inputJsonl)) {
      console.error(`Error: Input JSONL not found: ${inputJsonl}`);
      // Infrastructure failure (missing input file) - fatal
      process.exit(1);
    }

    // Check workspace directory exists
    if (!fs.existsSync(workspaceDir)) {
      console.error(`Error: Workspace directory not found: ${workspaceDir}`);
      // Infrastructure failure (missing workspace) - fatal
      process.exit(1);
    }

    // Process events
    const { results, summary } = await processHashlineEventsFromFile(inputJsonl, workspaceDir);

    // Write results (always write, even if empty)
    const resultsJsonl = results.length > 0 ? results.map((r) => JSON.stringify(r)).join('\n') + '\n' : '';
    fs.writeFileSync(outputJsonl, resultsJsonl, 'utf-8');
    console.log(`Wrote ${results.length} hashline event results to ${outputJsonl}`);

    // Write summary
    fs.writeFileSync(outputSummary, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`Wrote hashline summary to ${outputSummary}`);

    // Exit with appropriate code
    // Non-fatal: Hashline validation failures (rejected edits) are recorded but do not fail the pipeline.
    // Record rejections as validation data, not pipeline failures.
    if (summary.errors > 0) {
      console.warn(`Warning: ${summary.errors} hashline processing errors (non-fatal; validation failures recorded)`);
    }
    if (summary.rejected > 0) {
      console.warn(`Note: ${summary.rejected} hashline edits were rejected due to validation failures (see hashline-events.jsonl)`);
    }

    // Always exit 0 for non-fatal validation phase
    // Failures are recorded in output artifacts for inspection, not pipeline status
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${message}`);
    // Fatal error (e.g., I/O failure) - return non-zero exit code
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
