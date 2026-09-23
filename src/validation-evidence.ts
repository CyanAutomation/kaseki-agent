import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ValidationEvidence {
  text: string;
  sources: string[];
}

/**
 * Collect validation evidence across the post-agent and baseline phases.
 * A missing post-agent log must not hide timings or pre-validation output.
 */
export function collectValidationEvidence(resultsDir: string): ValidationEvidence {
  const sources: string[] = [];
  const parts: string[] = [];
  for (const file of ['validation.log', 'validation-timings.tsv', 'pre-validation.log', 'pre-validation-timings.tsv']) {
    let content = '';
    try {
      content = fs.readFileSync(path.join(resultsDir, file), 'utf8');
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    sources.push(file);
    parts.push(`--- ${file} ---\n${content.slice(-12000)}`);
  }
  return { text: parts.join('\n'), sources };
}
