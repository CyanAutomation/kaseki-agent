#!/usr/bin/env node
import fs from 'node:fs';
import { formatRunScorecardMarkdown } from './run-scorecard-markdown-renderer';

export { formatRunScorecardMarkdown } from './run-scorecard-markdown-renderer';

export { sanitizeScorecardText } from './run-scorecard-markdown-sanitize';

export function formatRunScorecardFile(file: string): string { try { return formatRunScorecardMarkdown(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown); } catch { return formatRunScorecardMarkdown(undefined); } }
if (process.argv[1] && /run-scorecard-markdown\.(?:js|ts)$/.test(process.argv[1])) { const file = process.argv[2]; if (!file) { process.stderr.write('Error: Missing required file path argument\n'); process.exitCode = 1; } else process.stdout.write(`${formatRunScorecardFile(file)}\n`); }
