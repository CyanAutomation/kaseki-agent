#!/usr/bin/env node
/**
 * get-caveman-prompt.ts
 *
 * CLI wrapper for caveman-compressed prompts.
 * Callable from bash scripts to get compressed prompt templates.
 *
 * Usage:
 *   node dist/get-caveman-prompt.js --type guardrails --level 2
 *   node dist/get-caveman-prompt.js --type goal-check --level 3
 */

import { getCavemanPrompt } from './caveman/caveman-prompts.js';

const args = process.argv.slice(2);

function parseArgs(): { type: 'guardrails' | 'goal-check' | 'run-eval'; level: number } {
  let type: 'guardrails' | 'goal-check' | 'run-eval' = 'guardrails';
  let level = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && i + 1 < args.length) {
      const t = args[i + 1];
      if (t === 'guardrails' || t === 'goal-check' || t === 'run-eval') {
        type = t;
      }
      i++;
    } else if (args[i] === '--level' && i + 1 < args.length) {
      level = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { type, level };
}

const { type, level } = parseArgs();
const prompt = getCavemanPrompt(level, type);

if (prompt) {
  console.log(prompt);
  process.exit(0);
} else {
  // No compression at this level
  process.exit(1);
}
