#!/usr/bin/env node
/**
 * generate-inspect-report.js
 *
 * Generates a human-readable inspect-report.md from inspect mode artifacts.
 * Extracts findings from pi-events.jsonl and pi-summary.json to create
 * a structured markdown report with Summary, Statistics, Findings, and Recommendations.
 *
 * Usage:
 *   node generate-inspect-report.js <results-dir>
 *
 * Writes to: <results-dir>/inspect-report.md
 */
import fs from 'node:fs';
import path from 'node:path';
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  }
  catch {
    return '';
  }
}
function readJsonl(filePath) {
  const content = readFile(filePath);
  if (!content.trim())
    return [];
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      }
      catch {
        return null;
      }
    })
    .filter(Boolean);
}
function readJson(filePath) {
  const content = readFile(filePath);
  if (!content.trim())
    return {};
  try {
    return JSON.parse(content);
  }
  catch {
    return {};
  }
}
/**
 * Extract finding-like events from pi-events.jsonl
 * Looks for completion-related messages from assistant
 */
function extractFindings(events) {
  const findings = [];
  events.forEach((event) => {
    // Skip non-content events
    if (!event.content)
      return;
    const sanitized = event.content
      .replace(/\[thinking\].*?\[\/thinking\]/gs, '')
      .replace(/sk-or-[a-zA-Z0-9]+/g, '[redacted-key]')
      .trim();
    const content = sanitized.toLowerCase();
    // Extract key observations/conclusions after sanitizing private/internal blocks.
    if (content.includes('found') ||
            content.includes('identified') ||
            content.includes('discovered') ||
            content.includes('analysis') ||
            content.includes('observation') ||
            content.includes('conclusion')) {
      // Keep only substantial findings
      if (sanitized.length > 20 && sanitized.length < 500) {
        findings.push(sanitized);
      }
    }
  });
  // Deduplicate and limit to meaningful findings
  return [...new Set(findings)].slice(0, 10);
}
/**
 * Generate the markdown report
 */
function generateReport(resultsDir) {
  const piEvents = readJsonl(path.join(resultsDir, 'pi-events.jsonl'));
  const piSummary = readJson(path.join(resultsDir, 'pi-summary.json'));
  const changedFilesContent = readFile(path.join(resultsDir, 'changed-files.txt'));
  const changedFiles = changedFilesContent
    .split('\n')
    .filter((line) => line.trim())
    .slice(0, 15);
  const findings = extractFindings(piEvents);
  // Build report sections
  const lines = [];
  lines.push('# Inspect Report');
  lines.push('');
  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`Analysis completed with **${piEvents.length}** Pi CLI events.`);
  if (findings.length === 0) {
    lines.push('No significant findings detected during analysis.');
  }
  else {
    lines.push(`**${findings.length}** key findings identified.`);
  }
  lines.push('');
  // Key Statistics
  lines.push('## Statistics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Pi events | ${piEvents.length} |`);
  if (piSummary.tool_start_count !== undefined) {
    const toolExecutions = (piSummary.tool_start_count || 0) + (piSummary.tool_end_count || 0);
    lines.push(`| Tool executions | ${toolExecutions} |`);
  }
  if (piSummary.input_tokens !== undefined && piSummary.output_tokens !== undefined) {
    const totalTokens = (piSummary.input_tokens || 0) + (piSummary.output_tokens || 0);
    lines.push(`| Tokens used | ${totalTokens} |`);
  }
  if (piSummary.selected_model) {
    lines.push(`| Model | ${piSummary.selected_model} |`);
  }
  lines.push('');
  // Findings
  if (findings.length > 0) {
    lines.push('## Key Findings');
    lines.push('');
    findings.forEach((finding, idx) => {
      lines.push(`${idx + 1}. ${finding}`);
    });
    lines.push('');
  }
  // Changed Files
  if (changedFiles.length > 0) {
    lines.push('## Modified Files');
    lines.push('');
    changedFiles.forEach((file) => {
      if (file.trim()) {
        lines.push(`- ${file.trim()}`);
      }
    });
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(`*Report generated at ${new Date().toISOString()}*`);
  return lines.join('\n');
}
function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: generate-inspect-report.js <results-dir>');
    process.exit(1);
  }
  const resultsDir = args[0];
  if (!fs.existsSync(resultsDir)) {
    console.error(`Results directory not found: ${resultsDir}`);
    process.exit(1);
  }
  try {
    const report = generateReport(resultsDir);
    const outputFile = path.join(resultsDir, 'inspect-report.md');
    fs.writeFileSync(outputFile, report, 'utf-8');
    console.log(`✓ Inspect report generated: ${outputFile}`);
  }
  catch (error) {
    console.error('✗ Failed to generate report:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
//# sourceMappingURL=generate-inspect-report.js.map