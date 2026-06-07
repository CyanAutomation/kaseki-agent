#!/usr/bin/env node
/**
 * Debug script to test the Feature 3 summarization
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readFileWithSummary, readFileWithSummaryAndMetrics } from './summarization/read-wrapper.js';
import { getReadStrategy, detectLanguage } from './summarization/read-strategy.js';
import { getConfig } from './summarization/summarizer-config.js';

async function debug() {
  // Create a test file
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-'));
  const testFile = path.join(testDir, 'test.ts');

  const content = `export class User {
  id: string;
  name: string;
}
`;

  fs.writeFileSync(testFile, content);

  console.log('=== Debug Information ===');
  console.log('Test file:', testFile);
  console.log('File size:', fs.statSync(testFile).size, 'bytes');
  console.log('');

  const language = detectLanguage(testFile);
  console.log('Detected language:', language);

  const config = getConfig();
  console.log('Config minSizeBytes:', config.minSizeBytes);
  console.log('Config maxSizeBytes:', config.maxSizeBytes);
  console.log('Config supportedLanguages:', config.supportedLanguages);
  console.log('');

  const strategyResult = getReadStrategy({
    filePath: testFile,
    sizeBytes: fs.statSync(testFile).size,
    language: language as any,
    config,
  });

  console.log('Strategy result:', strategyResult);
  console.log('');

  console.log('=== Testing readFileWithSummary ===');
  const result1 = await readFileWithSummary(testFile);
  console.log('Result type:', typeof result1);
  console.log('Result length:', result1?.length || 0);
  console.log('Result:', result1?.substring(0, 100) || 'null');
  console.log('');

  console.log('=== Testing readFileWithSummaryAndMetrics ===');
  const result2 = await readFileWithSummaryAndMetrics(testFile);
  console.log('Result:', JSON.stringify(result2, null, 2));
  console.log('');

  // Cleanup
  fs.rmSync(testDir, { recursive: true });
}

debug().catch(console.error);
