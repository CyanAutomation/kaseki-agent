/**
 * CLI Utility: Read file with optional summarization
 *
 * Usage: node dist/file-reader.js <filePath> [--metrics] [--full]
 *
 * Options:
 *   --metrics    Include metrics in output (JSON object with content + metrics)
 *   --full       Force full read (no summarization)
 *
 * Output: JSON object with { content, metrics? } or plain text
 */

import * as fs from 'fs';
import { readFileWithSummary, readFileWithSummaryAndMetrics } from './summarization/read-wrapper.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: file-reader <filePath> [--metrics] [--full]');
    process.exit(1);
  }

  const filePath = args[0];
  const withMetrics = args.includes('--metrics');
  const full = args.includes('--full');

  if (!fs.existsSync(filePath)) {
    if (withMetrics) {
      console.log(JSON.stringify({ content: null, error: 'File not found' }));
    } else {
      process.stdout.write('');
    }
    process.exit(0);
  }

  try {
    if (withMetrics) {
      try {
        const result = await readFileWithSummaryAndMetrics(filePath, { full });
        if (result) {
          console.log(JSON.stringify(result));
        } else {
          console.log(JSON.stringify({ content: null, error: 'Failed to read file' }));
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(JSON.stringify({ content: null, error: errorMsg, stack: error instanceof Error ? error.stack : undefined }));
      }
    } else {
      const content = await readFileWithSummary(filePath, { full });
      if (content) {
        process.stdout.write(content);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (withMetrics) {
      console.log(JSON.stringify({ content: null, error: errorMsg }));
    } else {
      console.error(`Error reading file: ${errorMsg}`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
