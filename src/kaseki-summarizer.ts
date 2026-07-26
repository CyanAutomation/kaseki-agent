/**
 * kaseki-summarizer: Pre-processing utility for Feature 3 integration
 *
 * This CLI tool runs before Pi invocation to:
 * 1. Generate summaries for repository files
 * 2. Export summarization metadata for TASK_PROMPT annotation
 * 3. Collect metrics for post-run analysis
 *
 * Usage:
 *   node dist/kaseki-summarizer.js --repo-dir <dir> --results-dir <dir> [options]
 *
 * Output:
 *   - {results-dir}/summarization-metadata.json - Metrics and summary stats
 *   - {results-dir}/summarization-annotation.txt - Text for TASK_PROMPT
 */

import * as fs from 'fs';
import * as path from 'path';
import { readFileWithSummaryAndMetrics, flushSummaryCache, getSummaryCacheStats } from './summarization/read-wrapper.js';

interface SummarizationStats {
  files_processed: number;
  total_bytes_full: number;
  total_bytes_returned: number;
  total_compression_ratio: number;
  estimated_tokens_full: number;
  estimated_tokens_returned: number;
  estimated_tokens_saved: number;
  avg_parse_time_ms: number;
  cache_hits: number;
  files_by_strategy: Record<string, number>;
  files_by_language: Record<string, number>;
  timestamp: string;
  duration_ms: number;
}

interface KasekiSummarizerOptions {
  repoDir: string;
  resultsDir: string;
  filePatterns?: string[]; // Which files to summarize (default: changed files from git)
  verbose?: boolean;
  maxFiles?: number; // Limit for testing
}

async function getChangedFiles(repoDir: string): Promise<string[]> {
  try {
    // Get list of changed files from git
    const { execSync } = await import('child_process');
    const output = execSync('git diff --name-only HEAD~1..HEAD', {
      cwd: repoDir,
      encoding: 'utf-8',
    });
    return output.split('\n').filter((f) => f.trim().length > 0);
  } catch {
    // If git fails, return empty list
    return [];
  }
}

export async function summarizeFiles(
  repoDir: string,
  filePaths: string[],
  maxFiles?: number
): Promise<SummarizationStats> {
  const startTime = Date.now();
  const stats: SummarizationStats = {
    files_processed: 0,
    total_bytes_full: 0,
    total_bytes_returned: 0,
    total_compression_ratio: 0,
    estimated_tokens_full: 0,
    estimated_tokens_returned: 0,
    estimated_tokens_saved: 0,
    avg_parse_time_ms: 0,
    cache_hits: 0,
    files_by_strategy: {},
    files_by_language: {},
    timestamp: new Date().toISOString(),
    duration_ms: 0,
  };

  const filesToProcess = maxFiles ? filePaths.slice(0, maxFiles) : filePaths;
  const parseTimes: number[] = [];

  for (const filePath of filesToProcess) {
    const fullPath = path.join(repoDir, filePath);

    // Skip non-existent files
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const result = await readFileWithSummaryAndMetrics(fullPath);
      if (!result || !result.metrics) {
        continue;
      }

      const metrics = result.metrics;
      stats.files_processed++;
      stats.total_bytes_full += metrics.fullSizeBytes;
      stats.total_bytes_returned += metrics.returnedSizeBytes;
      stats.estimated_tokens_full += metrics.estimatedTokensFull;
      stats.estimated_tokens_returned += metrics.estimatedTokensReturned;
      stats.estimated_tokens_saved += metrics.estimatedTokensSaved;

      // Track strategy usage
      stats.files_by_strategy[metrics.strategy] = (stats.files_by_strategy[metrics.strategy] || 0) + 1;

      // Track language usage
      stats.files_by_language[metrics.language] = (stats.files_by_language[metrics.language] || 0) + 1;

      // Track cache hits
      if (metrics.cacheHit) {
        stats.cache_hits++;
      }

      // Track parse times
      if (metrics.parseTimeMs > 0) {
        parseTimes.push(metrics.parseTimeMs);
      }
    } catch (error) {
      if (process.env.KASEKI_SUMMARIZER_VERBOSE === '1') {
        console.error(`Error summarizing ${filePath}:`, error);
      }
    }
  }

  // Calculate averages
  if (stats.files_processed > 0) {
    stats.total_compression_ratio = stats.total_bytes_full > 0 ? stats.total_bytes_returned / stats.total_bytes_full : 1;
    stats.avg_parse_time_ms = parseTimes.length > 0 ? parseTimes.reduce((a, b) => a + b, 0) / parseTimes.length : 0;
  }

  stats.duration_ms = Date.now() - startTime;

  return stats;
}

export function generateTaskPromptAnnotation(stats: SummarizationStats): string {
  const lines = [
    'Code Summary Metadata:',
    `- Files analyzed: ${stats.files_processed}`,
    `- Full context: ${stats.estimated_tokens_full} tokens`,
    `- Summarized context: ${stats.estimated_tokens_returned} tokens`,
    `- Tokens saved: ~${Math.round(stats.estimated_tokens_saved)} (${((stats.estimated_tokens_saved / stats.estimated_tokens_full) * 100).toFixed(1)}% reduction)`,
    `- Processing time: ${stats.duration_ms}ms`,
  ];

  if (stats.cache_hits > 0) {
    lines.push(`- Cache hits: ${stats.cache_hits}/${stats.files_processed}`);
  }

  const strategyBreakdown = Object.entries(stats.files_by_strategy)
    .map(([strategy, count]) => `${strategy}:${count}`)
    .join(', ');
  if (strategyBreakdown) {
    lines.push(`- Read strategies: [${strategyBreakdown}]`);
  }

  return lines.join('\n');
}

async function main() {
  const options = parseSummarizerArgs(process.argv.slice(2));

  if (!options.repoDir || !options.resultsDir) {
    console.error('Error: --repo-dir and --results-dir are required');
    process.exit(1);
  }

  logSummarizerStart(options);

  // Ensure results directory exists
  fs.mkdirSync(options.resultsDir, { recursive: true });

  try {
    const filePaths = await resolveFilesToSummarize(options);
    if (options.verbose) console.log('Processing files...');

    const stats = await summarizeFiles(options.repoDir, filePaths, options.maxFiles);
    logSummarizerStats(options, stats);
    writeSummarizerOutputs(options, stats);
    flushSummaryCache();
    writeSummaryCacheStats(options.resultsDir);

    if (options.verbose) console.log('kaseki-summarizer: Complete');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function parseSummarizerArgs(args: string[]): KasekiSummarizerOptions {
  const options: KasekiSummarizerOptions = {
    repoDir: '',
    resultsDir: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
    case '--repo-dir':
      options.repoDir = args[++i];
      break;
    case '--results-dir':
      options.resultsDir = args[++i];
      break;
    case '--verbose':
      options.verbose = true;
      break;
    case '--max-files':
      options.maxFiles = parseInt(args[++i], 10);
      break;
    case '--help':
      printUsageAndExit();
      break;
    }
  }

  return options;
}

function printUsageAndExit(): never {
  console.log(`
Usage: kaseki-summarizer [options]

Options:
  --repo-dir <path>     Repository directory (required)
  --results-dir <path>  Results directory for output (required)
  --verbose            Verbose logging
  --max-files <n>      Process only first n files (for testing)
  --help               Show this help message
`);
  process.exit(0);
}

function logSummarizerStart(options: KasekiSummarizerOptions): void {
  if (!options.verbose) return;
  console.log('kaseki-summarizer: Starting');
  console.log('  Repo directory:', options.repoDir);
  console.log('  Results directory:', options.resultsDir);
}

async function resolveFilesToSummarize(options: KasekiSummarizerOptions): Promise<string[]> {
  const changedFiles = await getChangedFiles(options.repoDir);
  if (changedFiles.length > 0) {
    if (options.verbose) console.log(`Found ${changedFiles.length} changed files`);
    return changedFiles;
  }

  const sourceFiles = listSourceFiles(options.repoDir);
  if (options.verbose) console.log(`Using ${sourceFiles.length} source files from src/`);
  return sourceFiles;
}

function listSourceFiles(repoDir: string): string[] {
  const filePaths: string[] = [];
  const srcDir = path.join(repoDir, 'src');
  if (!fs.existsSync(srcDir)) return filePaths;

  for (const file of fs.readdirSync(srcDir, { recursive: true })) {
    const filePath = path.join(srcDir, file as string);
    if (fs.statSync(filePath).isFile() && /\.(ts|js|tsx|jsx|go)$/.test(filePath)) {
      filePaths.push(path.relative(repoDir, filePath));
    }
  }
  return filePaths;
}

function logSummarizerStats(options: KasekiSummarizerOptions, stats: SummarizationStats): void {
  if (!options.verbose) return;
  console.log(`Processed ${stats.files_processed} files`);
  console.log(`  Tokens full: ${stats.estimated_tokens_full}`);
  console.log(`  Tokens returned: ${stats.estimated_tokens_returned}`);
  console.log(`  Tokens saved: ${Math.round(stats.estimated_tokens_saved)}`);
}

function writeSummarizerOutputs(options: KasekiSummarizerOptions, stats: SummarizationStats): void {
  const metricsPath = path.join(options.resultsDir, 'summarization-metadata.json');
  fs.writeFileSync(metricsPath, JSON.stringify(stats, null, 2) + '\n');
  if (options.verbose) console.log(`Wrote metrics to ${metricsPath}`);

  const annotation = generateTaskPromptAnnotation(stats);
  const annotationPath = path.join(options.resultsDir, 'summarization-annotation.txt');
  fs.writeFileSync(annotationPath, annotation + '\n');
  if (options.verbose) console.log(`Wrote TASK_PROMPT annotation to ${annotationPath}`);
}

function writeSummaryCacheStats(resultsDir: string): void {
  const cacheStats = getSummaryCacheStats();
  if (!cacheStats) return;

  const cacheStatsPath = path.join(resultsDir, 'summarization-cache-stats.json');
  fs.writeFileSync(cacheStatsPath, JSON.stringify(cacheStats, null, 2) + '\n');
}

// Only run main if this is being executed directly (not imported as a module)
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
