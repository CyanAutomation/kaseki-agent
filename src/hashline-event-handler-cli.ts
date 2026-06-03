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
      process.exit(1);
    }

    // Check workspace directory exists
    if (!fs.existsSync(workspaceDir)) {
      console.error(`Error: Workspace directory not found: ${workspaceDir}`);
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
